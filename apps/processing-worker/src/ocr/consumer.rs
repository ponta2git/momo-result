use std::{future::Future, pin::Pin, time::Duration};

use redis::aio::ConnectionManager;
use thiserror::Error;
use tokio::{sync::watch, time};
use tracing::{info, warn};

use crate::{
    outbox::{ControlOutcome, PostCommitEffects, PostCommitSink, PostCommitSinkClosed},
    postgres,
};

use super::{
    contract::OcrQueuePayload,
    control::{
        ClaimedOcrJob, OcrClaimResult, OcrControlConfig, OcrControlError, OcrDraftCompletion,
        OcrFailureCode, OcrHeartbeatResult, claim_job, finish_failure, finish_success, heartbeat,
        record_queue_failure, requeue_transient,
    },
    object_store::{OcrObjectStoreError, R2ObjectStore, R2ObjectStoreConfig, VerifiedSourceImage},
    queue::{
        OcrQueueConfig, OcrQueueDelivery, OcrQueueDeliveryBody, OcrQueueError, acknowledge,
        dead_letter_and_acknowledge, ensure_consumer_group, next_delivery,
    },
};

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

pub(crate) trait OcrChildHandle: Send {
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
        payload: &OcrQueuePayload,
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
    claim_wait_timeout: Duration,
    object_download_timeout: Duration,
    ocr_timeout: Duration,
    finalization_timeout: Duration,
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
    #[expect(
        clippy::too_many_arguments,
        reason = "the consumer requires every topology and timing bound explicitly"
    )]
    pub(crate) fn new(
        database_url: String,
        redis_url: String,
        stream: String,
        group: String,
        dead_letter_stream: String,
        worker_id: String,
        object_store: R2ObjectStoreConfig,
        lease_duration: Duration,
        heartbeat_interval: Duration,
        finalization_timeout: Duration,
        retry_delay: Duration,
        redis_block: Duration,
        claim_idle: Duration,
        ocr_timeout: Duration,
        maximum_delivery_attempts: usize,
        pending_scan_count: usize,
    ) -> Result<Self, OcrConsumerError> {
        if database_url.trim().is_empty()
            || redis_url.trim().is_empty()
            || heartbeat_interval.is_zero()
            || ocr_timeout.is_zero()
            || redis_block > heartbeat_interval
        {
            return Err(OcrConsumerError::InvalidConfiguration);
        }
        let required_lease_margin = heartbeat_interval
            .checked_mul(3)
            .and_then(|duration| duration.checked_add(finalization_timeout));
        let object_download_timeout = object_store
            .operation_timeout()
            .checked_add(heartbeat_interval)
            .ok_or(OcrConsumerError::InvalidConfiguration)?;
        let maximum_delivery_time = lease_duration
            .checked_add(object_download_timeout)
            .and_then(|duration| duration.checked_add(ocr_timeout))
            .and_then(|duration| duration.checked_add(finalization_timeout));
        if required_lease_margin.is_none_or(|required| required >= lease_duration)
            || maximum_delivery_time.is_none_or(|required| required >= claim_idle)
        {
            return Err(OcrConsumerError::InvalidConfiguration);
        }
        let queue = OcrQueueConfig::new(
            stream,
            group,
            dead_letter_stream,
            worker_id.clone(),
            claim_idle,
            redis_block,
            maximum_delivery_attempts,
            pending_scan_count,
        )?;
        let control =
            OcrControlConfig::new(worker_id, lease_duration, finalization_timeout, retry_delay)?;
        Ok(Self {
            database_url,
            redis_url,
            queue,
            control,
            object_store,
            heartbeat_interval,
            claim_wait_timeout: lease_duration,
            object_download_timeout,
            ocr_timeout,
            finalization_timeout,
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
    #[error("OCR post-commit outbox sink is unavailable")]
    PostCommitSinkUnavailable,
    #[error("OCR post-commit outbox sink stopped")]
    PostCommitSink(#[from] PostCommitSinkClosed),
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
    LeavePending,
    StopLoop,
}

enum ClaimDecision {
    Claimed(ClaimedOcrJob),
    RetryClaim,
    Acknowledge,
    LeavePending,
    StopWaiting,
}

enum PostCommitRoute {
    Registered(PostCommitSink),
    Unavailable,
}

impl PostCommitRoute {
    fn submit(&self, effects: PostCommitEffects) -> Result<(), OcrConsumerError> {
        match self {
            Self::Registered(sink) => sink.submit(effects).map_err(Into::into),
            Self::Unavailable if effects.outbox_wakes.is_empty() => Ok(()),
            Self::Unavailable => Err(OcrConsumerError::PostCommitSinkUnavailable),
        }
    }
}

enum DownloadOutcome<T> {
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
    shutdown: watch::Receiver<bool>,
) -> Result<(), OcrConsumerError> {
    run_with_post_commit_route(config, launcher, PostCommitRoute::Unavailable, shutdown).await
}

/// Runs the OCR consumer with the process-local post-commit coordinator sink.
///
/// # Errors
///
/// Returns a structural error when the coordinator has stopped accepting committed work. The
/// durable database transition is not rolled back and the source delivery is not advanced.
pub(crate) async fn run_with_post_commit_sink<L: OcrChildLauncher>(
    config: OcrConsumerConfig,
    launcher: &L,
    post_commit_sink: PostCommitSink,
    shutdown: watch::Receiver<bool>,
) -> Result<(), OcrConsumerError> {
    run_with_post_commit_route(
        config,
        launcher,
        PostCommitRoute::Registered(post_commit_sink),
        shutdown,
    )
    .await
}

async fn run_with_post_commit_route<L: OcrChildLauncher>(
    config: OcrConsumerConfig,
    launcher: &L,
    post_commit_route: PostCommitRoute,
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
        "Rust OCR v2 consumer is ready"
    );
    while !*shutdown.borrow() {
        let Some(delivery) = next_delivery(&mut redis, &config.queue).await? else {
            continue;
        };
        let disposition = Box::pin(process_delivery(
            &mut control_client,
            &mut heartbeat_client,
            &mut redis,
            &objects,
            launcher,
            &config,
            &post_commit_route,
            &delivery,
            &mut shutdown,
        ))
        .await?;
        match disposition {
            DeliveryDisposition::Acknowledge => {
                acknowledge(&mut redis, &config.queue, &delivery.message_id).await?;
            }
            DeliveryDisposition::AlreadyAcknowledged | DeliveryDisposition::LeavePending => {}
            DeliveryDisposition::StopLoop => break,
        }
    }
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
    post_commit_route: &PostCommitRoute,
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
                record_queue_failure(control_client, job_id, config.finalization_timeout).await?;
                Ok(DeliveryDisposition::Acknowledge)
            } else {
                Ok(DeliveryDisposition::LeavePending)
            }
        }
        OcrQueueDeliveryBody::MaximumAttempts {
            recoverable_job_id, ..
        } => {
            if let Some(job_id) = recoverable_job_id {
                record_queue_failure(control_client, job_id, config.finalization_timeout).await?;
            }
            dead_letter_and_acknowledge(redis, &config.queue, delivery).await?;
            Ok(DeliveryDisposition::AlreadyAcknowledged)
        }
        OcrQueueDeliveryBody::Job(payload) => {
            match wait_for_claim(control_client, payload, config, post_commit_route, shutdown)
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
                        payload,
                        shutdown,
                    ))
                    .await
                }
                ClaimDecision::Acknowledge => Ok(DeliveryDisposition::Acknowledge),
                ClaimDecision::LeavePending | ClaimDecision::RetryClaim => {
                    Ok(DeliveryDisposition::LeavePending)
                }
                ClaimDecision::StopWaiting => Ok(DeliveryDisposition::StopLoop),
            }
        }
    }
}

async fn wait_for_claim(
    client: &mut tokio_postgres::Client,
    payload: &OcrQueuePayload,
    config: &OcrConsumerConfig,
    post_commit_route: &PostCommitRoute,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<ClaimDecision, OcrConsumerError> {
    let deadline = time::sleep(config.claim_wait_timeout);
    tokio::pin!(deadline);
    loop {
        match submit_claim_outcome(
            post_commit_route,
            claim_job(client, payload, &config.control).await?,
        )? {
            ClaimDecision::Claimed(claim) => return Ok(ClaimDecision::Claimed(claim)),
            ClaimDecision::Acknowledge => return Ok(ClaimDecision::Acknowledge),
            ClaimDecision::LeavePending => return Ok(ClaimDecision::LeavePending),
            ClaimDecision::StopWaiting => return Ok(ClaimDecision::StopWaiting),
            ClaimDecision::RetryClaim => {}
        }
        tokio::select! {
            () = &mut deadline => return Ok(ClaimDecision::LeavePending),
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(ClaimDecision::StopWaiting);
                }
            }
            () = time::sleep(config.heartbeat_interval) => {}
        }
    }
}

fn submit_claim_outcome(
    route: &PostCommitRoute,
    outcome: ControlOutcome<OcrClaimResult>,
) -> Result<ClaimDecision, OcrConsumerError> {
    route.submit(outcome.effects)?;
    Ok(classify_claim_result(outcome.value))
}

fn classify_claim_result(result: OcrClaimResult) -> ClaimDecision {
    match result {
        OcrClaimResult::Claimed(claim) => ClaimDecision::Claimed(claim),
        OcrClaimResult::MissingOrTerminal
        | OcrClaimResult::AlreadyRunning
        | OcrClaimResult::QueueContractMismatch => ClaimDecision::Acknowledge,
        OcrClaimResult::UnsupportedQueueSchema | OcrClaimResult::NotYetAvailable => {
            ClaimDecision::LeavePending
        }
        OcrClaimResult::Busy | OcrClaimResult::PreemptionRequested => ClaimDecision::RetryClaim,
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
    payload: &OcrQueuePayload,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    let started = time::Instant::now();
    let downloaded = Box::pin(supervise_download(
        objects.download(payload),
        config.object_download_timeout,
        heartbeat_client,
        claim,
        config,
        shutdown,
    ))
    .await?;
    let image = match downloaded {
        DownloadOutcome::Completed(Ok(image))
            if image.width() == claim.expected_width && image.height() == claim.expected_height =>
        {
            image
        }
        DownloadOutcome::Completed(Err(OcrObjectStoreError::NotFound)) => {
            return finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::TempImageMissing,
                started,
            )
            .await;
        }
        DownloadOutcome::Completed(Ok(_) | Err(OcrObjectStoreError::Integrity)) => {
            return finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::InvalidImage,
                started,
            )
            .await;
        }
        DownloadOutcome::Completed(Err(
            OcrObjectStoreError::AccessDenied | OcrObjectStoreError::Unavailable,
        ))
        | DownloadOutcome::TimedOut => {
            requeue_transient(control_client, claim, &config.control).await?;
            return Ok(DeliveryDisposition::LeavePending);
        }
        DownloadOutcome::Shutdown => {
            requeue_transient(control_client, claim, &config.control).await?;
            return Ok(DeliveryDisposition::StopLoop);
        }
        DownloadOutcome::OwnerLost => return Ok(DeliveryDisposition::LeavePending),
    };
    let mut child = launcher
        .launch(&image, payload)
        .map_err(OcrConsumerError::ChildProcess)?;
    // The child handle owns the transport, not the source image. Release the bounded
    // compressed object before waiting for the child so the parent does not retain up to
    // the object-size limit for the whole OCR duration.
    drop(image);
    let child_outcome = supervise_ocr_child(
        child.as_mut(),
        config.ocr_timeout,
        heartbeat_client,
        claim,
        config,
        shutdown,
    )
    .await?;
    finish_ocr_attempt(control_client, claim, config, started, child_outcome).await
}

async fn finish_ocr_attempt(
    control_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
    started: time::Instant,
    child_outcome: OcrChildOutcome<Result<OcrOutput, OcrFailure>>,
) -> Result<DeliveryDisposition, OcrConsumerError> {
    match child_outcome {
        OcrChildOutcome::Completed(Ok(output)) => {
            let completion = draft_completion(output, elapsed_milliseconds(started));
            finish_success(control_client, claim, &config.control, &completion).await?;
            Ok(DeliveryDisposition::Acknowledge)
        }
        OcrChildOutcome::Completed(Err(failure)) if domain_failure_is_retryable(failure) => {
            requeue_transient(control_client, claim, &config.control).await?;
            Ok(DeliveryDisposition::LeavePending)
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
        OcrChildOutcome::OwnerLost => Ok(DeliveryDisposition::LeavePending),
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
    Ok(DeliveryDisposition::LeavePending)
}

fn draft_completion(output: OcrOutput, duration_milliseconds: i32) -> OcrDraftCompletion {
    OcrDraftCompletion {
        detected_screen_type: output.detected_screen_type,
        profile_id: output.profile_id,
        payload: output.payload,
        warnings: output.warnings,
        timings_milliseconds: output.timings_milliseconds,
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

async fn supervise_download<F, T>(
    future: F,
    timeout: Duration,
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DownloadOutcome<T>, OcrConsumerError>
where
    F: Future<Output = T>,
{
    tokio::pin!(future);
    let deadline = time::sleep(timeout);
    tokio::pin!(deadline);
    let mut interval = time::interval(config.heartbeat_interval);
    interval.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    interval.tick().await;
    loop {
        tokio::select! {
            output = &mut future => return Ok(DownloadOutcome::Completed(output)),
            () = &mut deadline => return Ok(DownloadOutcome::TimedOut),
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(DownloadOutcome::Shutdown);
                }
            }
            _ = interval.tick() => {
                match heartbeat(heartbeat_client, claim, &config.control).await? {
                    OcrHeartbeatResult::Continue => {}
                    OcrHeartbeatResult::OwnerLost => return Ok(DownloadOutcome::OwnerLost),
                }
            }
        }
    }
}

enum OcrChildEvent {
    Completed(Result<Result<OcrOutput, OcrFailure>, OcrChildProcessFailure>),
    TimedOut,
    Shutdown,
    OwnerLost,
    Dependency(OcrConsumerError),
}

async fn supervise_ocr_child(
    child: &mut dyn OcrChildHandle,
    timeout: Duration,
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrConsumerConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<OcrChildOutcome<Result<OcrOutput, OcrFailure>>, OcrConsumerError> {
    let event = {
        let waiting = child.wait();
        tokio::pin!(waiting);
        let deadline = time::sleep(timeout);
        tokio::pin!(deadline);
        let mut interval = time::interval(config.heartbeat_interval);
        interval.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
        interval.tick().await;
        loop {
            tokio::select! {
                output = &mut waiting => break OcrChildEvent::Completed(output),
                () = &mut deadline => break OcrChildEvent::TimedOut,
                result = shutdown.changed() => {
                    if result.is_err() || *shutdown.borrow() {
                        break OcrChildEvent::Shutdown;
                    }
                }
                _ = interval.tick() => {
                    match heartbeat(heartbeat_client, claim, &config.control).await {
                        Ok(OcrHeartbeatResult::Continue) => {}
                        Ok(OcrHeartbeatResult::OwnerLost) => {
                            break OcrChildEvent::OwnerLost;
                        }
                        Err(error) => {
                            break OcrChildEvent::Dependency(error.into());
                        }
                    }
                }
            }
        }
    };

    match event {
        OcrChildEvent::Completed(Ok(output)) => Ok(OcrChildOutcome::Completed(output)),
        OcrChildEvent::Completed(Err(OcrChildProcessFailure::ResourceExhausted)) => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::ResourceExhausted)
        }
        OcrChildEvent::Completed(Err(OcrChildProcessFailure::ProcessBoundary(kind))) => {
            terminate_ocr_child(child).await?;
            Err(OcrConsumerError::ChildProcess(kind))
        }
        OcrChildEvent::TimedOut => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::TimedOut)
        }
        OcrChildEvent::Shutdown => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::Shutdown)
        }
        OcrChildEvent::OwnerLost => {
            terminate_ocr_child(child).await?;
            Ok(OcrChildOutcome::OwnerLost)
        }
        OcrChildEvent::Dependency(error) => {
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
    use super::*;
    use crate::outbox::{OutboxKind, PostCommitEffects};

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
                ClaimDecision::Acknowledge
            ));
        }
        for result in [
            OcrClaimResult::UnsupportedQueueSchema,
            OcrClaimResult::NotYetAvailable,
        ] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimDecision::LeavePending
            ));
        }
        for result in [OcrClaimResult::Busy, OcrClaimResult::PreemptionRequested] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimDecision::RetryClaim
            ));
        }
    }

    #[test]
    fn effect_free_claim_does_not_require_an_outbox_sink() {
        let decision = submit_claim_outcome(
            &PostCommitRoute::Unavailable,
            ControlOutcome::without_effects(OcrClaimResult::Busy),
        );

        assert!(matches!(decision, Ok(ClaimDecision::RetryClaim)));
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
            submit_claim_outcome(&PostCommitRoute::Registered(sink), outcome),
            Err(OcrConsumerError::PostCommitSink(_))
        ));
    }

    #[test]
    fn missing_sink_fails_closed_only_when_a_claim_committed_outbox_work() {
        let outcome = ControlOutcome::new(
            OcrClaimResult::MissingOrTerminal,
            PostCommitEffects::wake(OutboxKind::SeriesAnalysis),
        );

        assert!(matches!(
            submit_claim_outcome(&PostCommitRoute::Unavailable, outcome),
            Err(OcrConsumerError::PostCommitSinkUnavailable)
        ));
    }

    #[test]
    fn redis_claim_idle_covers_preemption_download_ocr_and_finalization() {
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
        let build = |claim_idle| {
            OcrConsumerConfig::new(
                String::from("postgresql://localhost/test"),
                String::from("redis://localhost/"),
                String::from("momo:ocr:v2:jobs"),
                String::from("momo-ocr-rust-v2"),
                String::from("momo:ocr:v2:jobs:dead"),
                String::from("ocr-worker-1"),
                object_store.clone(),
                Duration::from_mins(1),
                Duration::from_secs(5),
                Duration::from_secs(5),
                Duration::from_secs(1),
                Duration::from_secs(1),
                claim_idle,
                Duration::from_secs(30),
                2,
                10,
            )
        };

        assert!(build(Duration::from_secs(111)).is_ok());
        assert!(build(Duration::from_secs(110)).is_err());
    }
}
