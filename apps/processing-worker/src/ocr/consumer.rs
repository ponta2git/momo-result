use std::{future::Future, pin::Pin, time::Duration};

use redis::aio::ConnectionManager;
use thiserror::Error;
use tokio::{sync::watch, time};
use tracing::{info, warn};

use crate::{
    outbox::{PostCommitSink, PostCommitSinkClosed},
    postgres,
};

use super::{
    contract::{OcrHints, RequestedScreenType, ValidatedOcrDelivery},
    control::{
        ClaimedOcrJob, OcrClaimResult, OcrControlConfig, OcrControlError, OcrDraftCompletion,
        OcrFailureCode, OcrHeartbeatResult, claim_job, finish_failure, finish_success, heartbeat,
        record_queue_failure, requeue_transient,
    },
    object_store::{OcrObjectStoreError, R2ObjectStore, R2ObjectStoreConfig, VerifiedSourceImage},
    queue::{
        OcrQueueConfig, OcrQueueDelivery, OcrQueueDeliveryBody, OcrQueueError,
        dead_letter_and_acknowledge, ensure_consumer_group,
    },
};

#[path = "consumer_claim_wait.rs"]
mod claim_wait;
#[path = "consumer_loop.rs"]
mod consumer_loop;

use claim_wait::{ClaimDecision, wait_for_claim};

pub(crate) type OcrChildWaitFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<Result<OcrOutput, OcrFailure>, OcrChildProcessFailure>>
            + Send
            + 'a,
    >,
>;

pub(crate) type OcrChildTerminationFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), &'static str>> + Send + 'a>>;

use momo_ocr::{OcrFailure, OcrOutput};

/// Failure observed by the parent supervisor rather than returned by OCR domain logic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OcrChildProcessFailure {
    ProcessBoundary(&'static str),
    ResourceExhausted,
}

pub(crate) trait OcrChildLiveness: Send {
    /// Extends the child watchdog only after the fenced database heartbeat succeeds.
    ///
    /// # Errors
    ///
    /// Returns an opaque process-boundary category when the watchdog channel is unusable.
    fn refresh(&mut self) -> Result<(), &'static str>;
}

pub(crate) trait OcrChildHandle: Send {
    /// Creates a parent-owned watchdog handle independent from the borrowed wait future.
    ///
    /// # Errors
    ///
    /// Returns an opaque process-boundary category when the handle cannot be duplicated.
    fn liveness(&self) -> Result<Box<dyn OcrChildLiveness>, &'static str>;

    /// Waits until the isolated OCR child is reaped and returns its closed domain outcome.
    fn wait(&mut self) -> OcrChildWaitFuture<'_>;

    /// Stops and reaps the isolated OCR child before control-plane ownership is released.
    fn terminate(&mut self) -> OcrChildTerminationFuture<'_>;
}

pub(crate) trait OcrChildLauncher: Send + Sync {
    /// Starts one OCR child behind the shared attach barrier.
    ///
    /// # Errors
    ///
    /// Returns an opaque runtime category when the process cannot be created safely.
    fn launch(
        &self,
        image: &VerifiedSourceImage,
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
    ) -> Result<Box<dyn OcrChildHandle>, &'static str>;
}

pub(crate) const fn domain_failure_control_code(failure: OcrFailure) -> OcrFailureCode {
    match failure {
        OcrFailure::InvalidImage => OcrFailureCode::InvalidImage,
        OcrFailure::UnsupportedImageFormat => OcrFailureCode::UnsupportedImageFormat,
        OcrFailure::DecodeFailed => OcrFailureCode::DecodeFailed,
        OcrFailure::CategoryUndetected => OcrFailureCode::CategoryUndetected,
        OcrFailure::LayoutUnsupported => OcrFailureCode::LayoutUnsupported,
        OcrFailure::EngineUnavailable => OcrFailureCode::OcrEngineUnavailable,
        OcrFailure::ParserFailed => OcrFailureCode::ParserFailed,
    }
}

pub(crate) const fn domain_failure_is_retryable(failure: OcrFailure) -> bool {
    matches!(failure, OcrFailure::EngineUnavailable)
}

#[derive(Clone)]
pub(crate) struct OcrConsumerConfig {
    database_url: String,
    redis_url: String,
    queue: OcrQueueConfig,
    control: OcrControlConfig,
    object_store: R2ObjectStoreConfig,
    heartbeat_interval: Duration,
    pel_recovery_interval: Duration,
    object_download_timeout: Duration,
    ocr_timeout: Duration,
    child_liveness_timeout: Duration,
}

impl std::fmt::Debug for OcrConsumerConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("OcrConsumerConfig([REDACTED])")
    }
}

impl OcrConsumerConfig {
    /// Builds a bounded Rust OCR v2 runtime with closed topology and timing bounds.
    ///
    /// # Errors
    ///
    /// Returns an error when an identifier, timeout, retry, lease, or delivery bound could permit
    /// concurrent ownership or unbounded dependency work.
    pub(crate) fn new(
        database_url: String,
        redis_url: String,
        queue: OcrQueueConfig,
        control: OcrControlConfig,
        object_store: R2ObjectStoreConfig,
        timing: OcrConsumerTiming,
    ) -> Result<Self, OcrConsumerError> {
        let worker_identity_matches = queue.consumer() == control.worker_id();
        if database_url.trim().is_empty()
            || redis_url.trim().is_empty()
            || !worker_identity_matches
            || queue.block() > timing.heartbeat_interval
        {
            return Err(OcrConsumerError::InvalidConfiguration);
        }
        let required_lease_margin = timing
            .heartbeat_interval
            .checked_mul(3)
            .and_then(|duration| duration.checked_add(timing.child_stop_grace))
            .and_then(|duration| duration.checked_add(control.finalization_timeout()));
        let child_liveness_timeout = timing
            .heartbeat_interval
            .checked_mul(2)
            .ok_or(OcrConsumerError::InvalidConfiguration)?;
        let object_download_timeout = object_store
            .operation_timeout()
            .checked_add(timing.heartbeat_interval)
            .ok_or(OcrConsumerError::InvalidConfiguration)?;
        let maximum_delivery_time = control
            .lease_duration()
            .checked_add(object_download_timeout)
            .and_then(|duration| duration.checked_add(timing.ocr_timeout))
            .and_then(|duration| duration.checked_add(timing.child_stop_grace))
            .and_then(|duration| duration.checked_add(control.finalization_timeout()));
        if required_lease_margin.is_none_or(|required| required >= control.lease_duration())
            || maximum_delivery_time.is_none_or(|required| required >= queue.claim_idle())
        {
            return Err(OcrConsumerError::InvalidConfiguration);
        }
        Ok(Self {
            database_url,
            redis_url,
            queue,
            control,
            object_store,
            heartbeat_interval: timing.heartbeat_interval,
            pel_recovery_interval: timing.pel_recovery_interval,
            object_download_timeout,
            ocr_timeout: timing.ocr_timeout,
            child_liveness_timeout,
        })
    }

    /// Returns the longest configured OCR dependency or heartbeat operation that can already be
    /// in progress when the process-level supervisor requests shutdown.
    pub(crate) fn shutdown_dependency_or_heartbeat_bound(&self) -> Duration {
        self.object_download_timeout.max(self.heartbeat_interval)
    }

    /// Returns the existing durable-finalization bound for process-level shutdown composition.
    pub(crate) const fn shutdown_finalization_bound(&self) -> Duration {
        self.control.finalization_timeout()
    }

    /// Returns the child watchdog bound derived from the validated ownership heartbeat.
    pub(crate) const fn child_liveness_timeout(&self) -> Duration {
        self.child_liveness_timeout
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct OcrConsumerTiming {
    heartbeat_interval: Duration,
    pel_recovery_interval: Duration,
    ocr_timeout: Duration,
    child_stop_grace: Duration,
}

impl OcrConsumerTiming {
    pub(crate) const fn new(
        heartbeat_interval: Duration,
        pel_recovery_interval: Duration,
        ocr_timeout: Duration,
        child_stop_grace: Duration,
    ) -> Result<Self, OcrConsumerError> {
        if heartbeat_interval.is_zero()
            || pel_recovery_interval.is_zero()
            || ocr_timeout.is_zero()
            || child_stop_grace.is_zero()
        {
            return Err(OcrConsumerError::InvalidConfiguration);
        }
        Ok(Self {
            heartbeat_interval,
            pel_recovery_interval,
            ocr_timeout,
            child_stop_grace,
        })
    }
}

#[derive(Debug, Error)]
pub(crate) enum OcrConsumerError {
    #[error("OCR consumer configuration is unsafe")]
    InvalidConfiguration,
    #[error("OCR consumer database dependency failed: {0}")]
    Database(&'static str),
    #[error("OCR consumer queue dependency failed: {0}")]
    Queue(&'static str),
    #[error("OCR consumer control transition failed: {0}")]
    Control(&'static str),
    #[error("OCR isolated process boundary failed: {0}")]
    ChildProcess(&'static str),
    #[error("OCR post-commit outbox sink stopped")]
    PostCommitSink(#[from] PostCommitSinkClosed),
    #[error("OCR PEL recovery schedule exceeded the monotonic clock bound")]
    DurationBound,
}

impl From<OcrQueueError> for OcrConsumerError {
    fn from(error: OcrQueueError) -> Self {
        Self::Queue(error.kind())
    }
}

impl From<OcrControlError> for OcrConsumerError {
    fn from(error: OcrControlError) -> Self {
        Self::Control(error.kind())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeliveryDisposition {
    Acknowledge,
    AlreadyAcknowledged,
    LeavePending(PendingRecoveryPolicy),
    StopLoop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PendingRecoveryPolicy {
    ColdOnly,
    AtIdleThreshold,
}

impl DeliveryDisposition {
    const fn leave_pending_cold() -> Self {
        Self::LeavePending(PendingRecoveryPolicy::ColdOnly)
    }

    const fn leave_pending_at_idle() -> Self {
        Self::LeavePending(PendingRecoveryPolicy::AtIdleThreshold)
    }
}

enum SupervisedAttempt<T> {
    Completed(T),
    TimedOut,
    Shutdown,
    OwnerLost,
}

enum OcrChildOutcome<T> {
    Completed(T),
    ResourceExhausted,
    TimedOut,
    Shutdown,
    OwnerLost,
}

pub(super) fn shutdown_requested(shutdown: &watch::Receiver<bool>) -> bool {
    if *shutdown.borrow() {
        return true;
    }
    shutdown.has_changed().is_err()
}

/// Runs the explicitly enabled Rust OCR v2 consumer with an injected OCR child launcher.
///
/// Activation remains explicit; rollout requires the independently maintained R2, control-plane,
/// resource, and accuracy gates.
///
/// # Errors
///
/// Returns an opaque dependency or control-plane category without exposing connection strings,
/// credentials, object keys, or OCR payloads.
pub(crate) async fn run<L: OcrChildLauncher>(
    config: OcrConsumerConfig,
    launcher: &L,
    post_commit_sink: PostCommitSink,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), OcrConsumerError> {
    let mut control_client = postgres::connect(&config.database_url)
        .await
        .map_err(|error| OcrConsumerError::Database(error.kind()))?;
    let mut heartbeat_client = postgres::connect(&config.database_url)
        .await
        .map_err(|error| OcrConsumerError::Database(error.kind()))?;
    let redis_client = redis::Client::open(config.redis_url.as_str())
        .map_err(|_error| OcrConsumerError::Queue("ocr_redis_configuration"))?;
    let mut redis = redis_client
        .get_connection_manager()
        .await
        .map_err(|_error| OcrConsumerError::Queue("ocr_redis_connect"))?;
    ensure_consumer_group(&mut redis, &config.queue).await?;
    let objects = R2ObjectStore::new(&config.object_store);
    info!(
        event = "ocr_rust_v2_worker_ready",
        worker_id = %config.control.worker_id(),
        "Rust OCR v2 consumer is ready"
    );
    consumer_loop::consume_deliveries(
        &mut control_client,
        &mut heartbeat_client,
        &mut redis,
        &objects,
        launcher,
        &config,
        &post_commit_sink,
        &mut shutdown,
    )
    .await?;
    info!(
        event = "ocr_rust_v2_worker_drained",
        "Rust OCR v2 consumer drained"
    );
    Ok(())
}

#[expect(
    clippy::too_many_arguments,
    reason = "one delivery coordinates the four durable adapters and injected child launcher explicitly"
)]
async fn process_delivery<L: OcrChildLauncher>(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    redis: &mut ConnectionManager,
    objects: &R2ObjectStore,
    launcher: &L,
    config: &OcrConsumerConfig,
    post_commit_sink: &PostCommitSink,
    delivery: &OcrQueueDelivery,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    match &delivery.body {
        OcrQueueDeliveryBody::Malformed {
            recoverable_job_id,
            error,
        } => {
            warn!(
                event = "ocr_v2_delivery_malformed",
                contract_error = ?error,
                "Rust OCR v2 delivery failed its closed contract"
            );
            if let Some(job_id) = recoverable_job_id {
                record_queue_failure(
                    control_client,
                    job_id,
                    config.control.finalization_timeout(),
                )
                .await?;
                Ok(DeliveryDisposition::Acknowledge)
            } else {
                Ok(DeliveryDisposition::leave_pending_at_idle())
            }
        }
        OcrQueueDeliveryBody::MaximumAttempts {
            recoverable_job_id, ..
        } => {
            if let Some(job_id) = recoverable_job_id {
                record_queue_failure(
                    control_client,
                    job_id,
                    config.control.finalization_timeout(),
                )
                .await?;
            }
            dead_letter_and_acknowledge(redis, &config.queue, delivery).await?;
            Ok(DeliveryDisposition::AlreadyAcknowledged)
        }
        OcrQueueDeliveryBody::Job(delivery) => {
            match wait_for_claim(control_client, delivery, config, post_commit_sink, shutdown)
                .await?
            {
                ClaimDecision::Claimed(claim) => {
                    Box::pin(process_claimed(
                        control_client,
                        heartbeat_client,
                        objects,
                        launcher,
                        config,
                        &claim,
                        delivery.payload().hints(),
                        shutdown,
                    ))
                    .await
                }
                ClaimDecision::Acknowledge => Ok(DeliveryDisposition::Acknowledge),
                ClaimDecision::LeavePendingCold => Ok(DeliveryDisposition::leave_pending_cold()),
                ClaimDecision::RetryAtIdleThreshold => {
                    Ok(DeliveryDisposition::leave_pending_at_idle())
                }
                ClaimDecision::StopWaiting => Ok(DeliveryDisposition::StopLoop),
            }
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the claimed attempt keeps control, heartbeat, object, and child-process boundaries explicit"
)]
async fn process_claimed<L: OcrChildLauncher>(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    objects: &R2ObjectStore,
    launcher: &L,
    config: &OcrConsumerConfig,
    claim: &ClaimedOcrJob,
    hints: &OcrHints,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    let started = time::Instant::now();
    let downloaded = Box::pin(supervise_attempt(
        objects.download(&claim.source_image),
        config.object_download_timeout,
        heartbeat_client,
        claim,
        config,
        shutdown,
        None,
    ))
    .await?;
    let image = match downloaded {
        SupervisedAttempt::Completed(Ok(image))
            if image.width() == claim.expected_width && image.height() == claim.expected_height =>
        {
            image
        }
        SupervisedAttempt::Completed(Err(OcrObjectStoreError::NotFound)) => {
            return finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::TempImageMissing,
                started,
            )
            .await;
        }
        SupervisedAttempt::Completed(Ok(_) | Err(OcrObjectStoreError::Integrity)) => {
            return finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::InvalidImage,
                started,
            )
            .await;
        }
        SupervisedAttempt::Completed(Err(
            OcrObjectStoreError::AccessDenied | OcrObjectStoreError::Unavailable,
        ))
        | SupervisedAttempt::TimedOut => {
            requeue_transient(control_client, claim, &config.control).await?;
            return Ok(DeliveryDisposition::leave_pending_at_idle());
        }
        SupervisedAttempt::Shutdown => {
            requeue_transient(control_client, claim, &config.control).await?;
            return Ok(DeliveryDisposition::StopLoop);
        }
        SupervisedAttempt::OwnerLost => return Ok(DeliveryDisposition::leave_pending_cold()),
    };
    let ocr_started = time::Instant::now();
    let mut child = launcher
        .launch(&image, claim.requested_screen_type, hints)
        .map_err(OcrConsumerError::ChildProcess)?;
    // The child handle owns the transport, not the source image. Release the bounded
    // compressed object before waiting for the child so the parent does not retain up to
    // the object-size limit for the whole OCR duration.
    drop(image);
    let child_outcome = supervise_ocr_child(
        child.as_mut(),
        config
            .ocr_timeout
            .checked_sub(ocr_started.elapsed())
            .unwrap_or(Duration::ZERO),
        heartbeat_client,
        claim,
        config,
        shutdown,
    )
    .await?;
    finish_ocr_attempt(control_client, claim, hints, config, started, child_outcome).await
}

async fn finish_ocr_attempt(
    control_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    hints: &OcrHints,
    config: &OcrConsumerConfig,
    started: time::Instant,
    child_outcome: OcrChildOutcome<Result<OcrOutput, OcrFailure>>,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    match child_outcome {
        OcrChildOutcome::Completed(Ok(output)) => {
            let completion = draft_completion(output, elapsed_milliseconds(started));
            finish_success(control_client, claim, &config.control, hints, &completion).await?;
            Ok(DeliveryDisposition::Acknowledge)
        }
        OcrChildOutcome::Completed(Err(failure)) if domain_failure_is_retryable(failure) => {
            requeue_transient(control_client, claim, &config.control).await?;
            Ok(DeliveryDisposition::leave_pending_at_idle())
        }
        OcrChildOutcome::Completed(Err(failure)) => {
            finish_terminal_failure(
                control_client,
                claim,
                config,
                domain_failure_control_code(failure),
                started,
            )
            .await
        }
        OcrChildOutcome::ResourceExhausted => {
            handle_resource_exhausted(control_client, claim, config).await
        }
        OcrChildOutcome::TimedOut => {
            finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::OcrTimeout,
                started,
            )
            .await
        }
        OcrChildOutcome::Shutdown => {
            requeue_transient(control_client, claim, &config.control).await?;
            Ok(DeliveryDisposition::StopLoop)
        }
        OcrChildOutcome::OwnerLost => Ok(DeliveryDisposition::leave_pending_cold()),
    }
}

async fn handle_resource_exhausted(
    control_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    warn!(
        event = "ocr_child_resource_exhausted",
        "OCR child exceeded the cgroup memory budget; retrying through the existing unavailable policy"
    );
    requeue_transient(control_client, claim, &config.control).await?;
    Ok(DeliveryDisposition::leave_pending_at_idle())
}

const fn draft_completion(output: OcrOutput, duration_milliseconds: i32) -> OcrDraftCompletion {
    OcrDraftCompletion {
        output,
        duration_milliseconds,
    }
}

async fn finish_terminal_failure(
    client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
    failure: OcrFailureCode,
    started: time::Instant,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    finish_failure(
        client,
        claim,
        &config.control,
        failure,
        elapsed_milliseconds(started),
    )
    .await?;
    Ok(DeliveryDisposition::Acknowledge)
}

async fn supervise_attempt<F, T>(
    future: F,
    timeout: Duration,
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
    shutdown: &mut watch::Receiver<bool>,
    mut child_liveness: Option<&mut dyn OcrChildLiveness>,
) -> Result<SupervisedAttempt<T>, OcrConsumerError>
where
    F: Future<Output = T>,
{
    if shutdown_requested(shutdown) {
        return Ok(SupervisedAttempt::Shutdown);
    }
    tokio::pin!(future);
    let deadline_at = time::Instant::now()
        .checked_add(timeout)
        .ok_or(OcrConsumerError::DurationBound)?;
    let deadline = time::sleep_until(deadline_at);
    tokio::pin!(deadline);
    let mut interval = time::interval(config.heartbeat_interval);
    interval.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    interval.tick().await;
    loop {
        tokio::select! {
            biased;
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(SupervisedAttempt::Shutdown);
                }
            }
            _ = interval.tick() => {
                let heartbeat = time::timeout(
                    config.heartbeat_interval,
                    heartbeat(heartbeat_client, claim, &config.control),
                );
                tokio::pin!(heartbeat);
                let heartbeat_result = loop {
                    tokio::select! {
                        biased;
                        result = shutdown.changed() => {
                            if result.is_err() || *shutdown.borrow() {
                                return Ok(SupervisedAttempt::Shutdown);
                            }
                        }
                        () = &mut deadline => return Ok(SupervisedAttempt::TimedOut),
                        output = &mut future => return Ok(SupervisedAttempt::Completed(output)),
                        result = &mut heartbeat => {
                            break result
                                .map_err(|_elapsed| {
                                    OcrConsumerError::Control("ocr_heartbeat_timeout")
                                })??;
                        }
                    }
                };
                match heartbeat_result {
                    OcrHeartbeatResult::Continue => {
                        if let Some(liveness) = child_liveness.as_deref_mut() {
                            liveness.refresh().map_err(OcrConsumerError::ChildProcess)?;
                        }
                    }
                    OcrHeartbeatResult::OwnerLost => return Ok(SupervisedAttempt::OwnerLost),
                }
            }
            () = &mut deadline => return Ok(SupervisedAttempt::TimedOut),
            output = &mut future => return Ok(SupervisedAttempt::Completed(output)),
        }
    }
}

async fn supervise_ocr_child(
    child: &mut dyn OcrChildHandle,
    timeout: Duration,
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<OcrChildOutcome<Result<OcrOutput, OcrFailure>>, OcrConsumerError> {
    let mut liveness = match child.liveness() {
        Ok(liveness) => liveness,
        Err(kind) => {
            terminate_ocr_child(child).await?;
            return Err(OcrConsumerError::ChildProcess(kind));
        }
    };
    if let Err(kind) = liveness.refresh() {
        terminate_ocr_child(child).await?;
        return Err(OcrConsumerError::ChildProcess(kind));
    }
    let event = {
        let waiting = child.wait();
        supervise_attempt(
            waiting,
            timeout,
            heartbeat_client,
            claim,
            config,
            shutdown,
            Some(liveness.as_mut()),
        )
        .await
    };

    match event {
        Ok(SupervisedAttempt::Completed(Ok(output))) => Ok(OcrChildOutcome::Completed(output)),
        Ok(SupervisedAttempt::Completed(Err(OcrChildProcessFailure::ResourceExhausted))) => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::ResourceExhausted)
        }
        Ok(SupervisedAttempt::Completed(Err(OcrChildProcessFailure::ProcessBoundary(kind)))) => {
            terminate_ocr_child(child).await?;
            Err(OcrConsumerError::ChildProcess(kind))
        }
        Ok(SupervisedAttempt::TimedOut) => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::TimedOut)
        }
        Ok(SupervisedAttempt::Shutdown) => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::Shutdown)
        }
        Ok(SupervisedAttempt::OwnerLost) => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::OwnerLost)
        }
        Err(error) => {
            terminate_ocr_child(child).await?;
            Err(error)
        }
    }
}

async fn terminate_ocr_child(child: &mut dyn OcrChildHandle) -> Result<(), OcrConsumerError> {
    child
        .terminate()
        .await
        .map_err(OcrConsumerError::ChildProcess)
}

fn elapsed_milliseconds(started: time::Instant) -> i32 {
    i32::try_from(started.elapsed().as_millis()).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
    use super::claim_wait::{ClaimAttempt, classify_claim_result, submit_claim_outcome};
    use super::*;
    use crate::outbox::{ControlOutcome, OutboxKind, PostCommitEffects};

    #[test]
    fn ocr_failures_have_one_deterministic_control_policy() {
        for failure in [
            OcrFailure::InvalidImage,
            OcrFailure::UnsupportedImageFormat,
            OcrFailure::DecodeFailed,
            OcrFailure::CategoryUndetected,
            OcrFailure::LayoutUnsupported,
            OcrFailure::ParserFailed,
        ] {
            assert!(!domain_failure_is_retryable(failure));
        }
        assert!(domain_failure_is_retryable(OcrFailure::EngineUnavailable));
    }

    #[test]
    fn claim_disposition_is_closed_for_duplicate_and_deferred_work() {
        for result in [
            OcrClaimResult::MissingOrTerminal,
            OcrClaimResult::AlreadyRunning,
            OcrClaimResult::QueueContractMismatch,
        ] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimAttempt::Complete(ClaimDecision::Acknowledge)
            ));
        }
        for result in [
            OcrClaimResult::UnsupportedQueueSchema,
            OcrClaimResult::NotYetAvailable,
        ] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimAttempt::Complete(ClaimDecision::LeavePendingCold)
            ));
        }
        for result in [OcrClaimResult::Busy, OcrClaimResult::PreemptionRequested] {
            assert!(matches!(classify_claim_result(result), ClaimAttempt::Retry));
        }
    }

    #[test]
    fn analysis_wake_submission_must_succeed_before_claim_disposition() {
        let (sink, receiver) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        drop(receiver);
        let outcome = ControlOutcome::new(
            OcrClaimResult::MissingOrTerminal,
            PostCommitEffects::wake(OutboxKind::SeriesAnalysis),
        );

        assert!(matches!(
            submit_claim_outcome(&sink, outcome),
            Err(OcrConsumerError::PostCommitSink(_))
        ));
    }

    #[test]
    fn lease_and_claim_idle_cover_one_total_child_stop_budget() {
        let object_store = R2ObjectStoreConfig::new(
            "http://127.0.0.1:9000",
            "ocr-test",
            String::from("access-key"),
            String::from("secret-key"),
            Duration::from_secs(10),
            Duration::from_secs(5),
            1,
        );
        assert!(object_store.is_ok());
        let Some(object_store) = object_store.ok() else {
            return;
        };
        let build = |lease_duration,
                     child_stop_grace,
                     claim_idle,
                     queue_worker: &str,
                     control_worker: &str|
         -> Result<OcrConsumerConfig, OcrConsumerError> {
            let queue = OcrQueueConfig::new(
                String::from("momo:ocr:v2:jobs"),
                String::from("momo-ocr-rust-v2"),
                String::from("momo:ocr:v2:jobs:dead"),
                String::from(queue_worker),
                claim_idle,
                Duration::from_secs(1),
                2,
                10,
            )?;
            let control = OcrControlConfig::new(
                String::from(control_worker),
                lease_duration,
                Duration::from_secs(5),
                Duration::from_secs(1),
            )?;
            let timing = OcrConsumerTiming::new(
                Duration::from_secs(5),
                Duration::from_mins(5),
                Duration::from_secs(30),
                child_stop_grace,
            )?;
            OcrConsumerConfig::new(
                String::from("postgresql://localhost/test"),
                String::from("redis://localhost/"),
                queue,
                control,
                object_store.clone(),
                timing,
            )
        };

        assert!(
            build(
                Duration::from_secs(26),
                Duration::from_secs(5),
                Duration::from_secs(82),
                "ocr-worker-1",
                "ocr-worker-1"
            )
            .is_ok()
        );
        assert!(
            build(
                Duration::from_secs(25),
                Duration::from_secs(5),
                Duration::from_secs(82),
                "ocr-worker-1",
                "ocr-worker-1"
            )
            .is_err()
        );
        assert!(
            build(
                Duration::from_secs(26),
                Duration::from_secs(5),
                Duration::from_secs(81),
                "ocr-worker-1",
                "ocr-worker-1"
            )
            .is_err()
        );
        assert!(
            build(
                Duration::from_secs(26),
                Duration::from_secs(5),
                Duration::from_secs(82),
                "redis-worker",
                "database-worker"
            )
            .is_err()
        );
    }

    #[test]
    fn shutdown_is_requested_by_true_state_or_a_closed_channel() {
        let (open_sender, open_receiver) = watch::channel(false);
        assert!(!shutdown_requested(&open_receiver));
        assert!(
            open_sender.send(true).is_ok(),
            "the live receiver must accept a shutdown update"
        );
        assert!(shutdown_requested(&open_receiver));

        let (closed_sender, closed_receiver) = watch::channel(false);
        drop(closed_sender);
        assert!(shutdown_requested(&closed_receiver));
    }
}
