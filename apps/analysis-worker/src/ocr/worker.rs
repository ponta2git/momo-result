use std::{future::Future, pin::Pin, time::Duration};

use redis::aio::ConnectionManager;
use serde_json::Value as JsonValue;
use thiserror::Error;
use tokio::{sync::watch, time};
use tracing::{info, warn};

use crate::database;

use super::{
    contract::{OcrQueuePayload, RequestedScreenType},
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

pub type OcrAttemptFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<Result<OcrEngineOutput, OcrEngineFailure>, &'static str>>
            + Send
            + 'a,
    >,
>;

pub type OcrAttemptTerminationFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), &'static str>> + Send + 'a>>;

pub trait OcrEngineAttempt: Send {
    /// Waits until the isolated OCR child is reaped and returns its closed domain outcome.
    fn wait(&mut self) -> OcrAttemptFuture<'_>;

    /// Stops and reaps the isolated OCR child before control-plane ownership is released.
    fn terminate(&mut self) -> OcrAttemptTerminationFuture<'_>;
}

pub trait OcrEngine: Send + Sync {
    /// Starts one OCR child behind the shared attach barrier.
    ///
    /// # Errors
    ///
    /// Returns an opaque runtime category when the process cannot be created safely.
    fn start(
        &self,
        image: &VerifiedSourceImage,
        payload: &OcrQueuePayload,
    ) -> Result<Box<dyn OcrEngineAttempt>, &'static str>;
}

pub struct OcrEngineOutput {
    pub detected_screen_type: RequestedScreenType,
    pub profile_id: Option<String>,
    pub payload: JsonValue,
    pub warnings: JsonValue,
    pub timings_milliseconds: JsonValue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrEngineFailure {
    InvalidImage,
    UnsupportedImageFormat,
    DecodeFailed,
    CategoryUndetected,
    LayoutUnsupported,
    EngineUnavailable,
    ParserFailed,
}

impl OcrEngineFailure {
    const fn control_code(self) -> OcrFailureCode {
        match self {
            Self::InvalidImage => OcrFailureCode::InvalidImage,
            Self::UnsupportedImageFormat => OcrFailureCode::UnsupportedImageFormat,
            Self::DecodeFailed => OcrFailureCode::DecodeFailed,
            Self::CategoryUndetected => OcrFailureCode::CategoryUndetected,
            Self::LayoutUnsupported => OcrFailureCode::LayoutUnsupported,
            Self::EngineUnavailable => OcrFailureCode::OcrEngineUnavailable,
            Self::ParserFailed => OcrFailureCode::ParserFailed,
        }
    }

    const fn retryable(self) -> bool {
        matches!(self, Self::EngineUnavailable)
    }
}

#[derive(Clone)]
pub struct OcrWorkerRuntimeConfig {
    database_url: String,
    redis_url: String,
    queue: OcrQueueConfig,
    control: OcrControlConfig,
    object_store: R2ObjectStoreConfig,
    heartbeat_interval: Duration,
    priority_wait: Duration,
    object_download_timeout: Duration,
    ocr_timeout: Duration,
    finalization_timeout: Duration,
}

impl std::fmt::Debug for OcrWorkerRuntimeConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("OcrWorkerRuntimeConfig([REDACTED])")
    }
}

impl OcrWorkerRuntimeConfig {
    /// Builds a dormant Rust OCR v2 runtime with closed topology and timing bounds.
    ///
    /// # Errors
    ///
    /// Returns an error when an identifier, timeout, retry, lease, or delivery bound could permit
    /// concurrent ownership or unbounded dependency work.
    #[expect(
        clippy::too_many_arguments,
        reason = "the dormant consumer requires every topology and timing bound explicitly"
    )]
    pub fn new(
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
    ) -> Result<Self, OcrWorkerError> {
        if database_url.trim().is_empty()
            || redis_url.trim().is_empty()
            || heartbeat_interval.is_zero()
            || ocr_timeout.is_zero()
            || redis_block > heartbeat_interval
        {
            return Err(OcrWorkerError::InvalidConfiguration);
        }
        let required_lease_margin = heartbeat_interval
            .checked_mul(3)
            .and_then(|duration| duration.checked_add(finalization_timeout));
        let object_download_timeout = object_store
            .operation_timeout()
            .checked_add(heartbeat_interval)
            .ok_or(OcrWorkerError::InvalidConfiguration)?;
        let maximum_delivery_time = lease_duration
            .checked_add(object_download_timeout)
            .and_then(|duration| duration.checked_add(ocr_timeout))
            .and_then(|duration| duration.checked_add(finalization_timeout));
        if required_lease_margin.is_none_or(|required| required >= lease_duration)
            || maximum_delivery_time.is_none_or(|required| required >= claim_idle)
        {
            return Err(OcrWorkerError::InvalidConfiguration);
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
            priority_wait: lease_duration,
            object_download_timeout,
            ocr_timeout,
            finalization_timeout,
        })
    }
}

#[derive(Debug, Error)]
pub enum OcrWorkerError {
    #[error("OCR worker configuration is unsafe")]
    InvalidConfiguration,
    #[error("OCR worker database dependency failed: {0}")]
    Database(&'static str),
    #[error("OCR worker queue dependency failed: {0}")]
    Queue(&'static str),
    #[error("OCR worker control transition failed: {0}")]
    Control(&'static str),
    #[error("OCR isolated process boundary failed: {0}")]
    Engine(&'static str),
}

impl From<OcrQueueError> for OcrWorkerError {
    fn from(error: OcrQueueError) -> Self {
        Self::Queue(error.kind())
    }
}

impl From<OcrControlError> for OcrWorkerError {
    fn from(error: OcrControlError) -> Self {
        Self::Control(error.kind())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeliveryDisposition {
    Acknowledge,
    Resolved,
    LeavePending,
    Stop,
}

enum ClaimDecision {
    Claimed(ClaimedOcrJob),
    Retry,
    Acknowledge,
    LeavePending,
    Stop,
}

enum Supervised<T> {
    Completed(T),
    TimedOut,
    Shutdown,
    OwnerLost,
}

/// Runs the dormant Rust OCR v2 consumer with an injected OCR engine.
///
/// The production writer must remain disabled until the live R2, control-plane, resource, and
/// accuracy gates pass.
///
/// # Errors
///
/// Returns an opaque dependency or control-plane category without exposing connection strings,
/// credentials, object keys, or OCR payloads.
pub async fn run_with_engine<E: OcrEngine>(
    config: OcrWorkerRuntimeConfig,
    engine: &E,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), OcrWorkerError> {
    let mut control_client = database::connect(&config.database_url)
        .await
        .map_err(|error| OcrWorkerError::Database(error.kind()))?;
    let mut heartbeat_client = database::connect(&config.database_url)
        .await
        .map_err(|error| OcrWorkerError::Database(error.kind()))?;
    let redis_client = redis::Client::open(config.redis_url.as_str())
        .map_err(|_error| OcrWorkerError::Queue("ocr_redis_configuration"))?;
    let mut redis = redis_client
        .get_connection_manager()
        .await
        .map_err(|_error| OcrWorkerError::Queue("ocr_redis_connect"))?;
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
            engine,
            &config,
            &delivery,
            &mut shutdown,
        ))
        .await?;
        match disposition {
            DeliveryDisposition::Acknowledge => {
                acknowledge(&mut redis, &config.queue, &delivery.message_id).await?;
            }
            DeliveryDisposition::Resolved | DeliveryDisposition::LeavePending => {}
            DeliveryDisposition::Stop => break,
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
    reason = "one delivery coordinates the four durable adapters and injected engine explicitly"
)]
async fn process_delivery<E: OcrEngine>(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    redis: &mut ConnectionManager,
    objects: &R2ObjectStore,
    engine: &E,
    config: &OcrWorkerRuntimeConfig,
    delivery: &OcrQueueDelivery,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, OcrWorkerError> {
    match &delivery.body {
        OcrQueueDeliveryBody::Malformed {
            readable_job_id,
            error,
        } => {
            warn!(
                event = "ocr_v2_delivery_malformed",
                contract_error = ?error,
                "Rust OCR v2 delivery failed its closed contract"
            );
            if let Some(job_id) = readable_job_id {
                record_queue_failure(control_client, job_id, config.finalization_timeout).await?;
                Ok(DeliveryDisposition::Acknowledge)
            } else {
                Ok(DeliveryDisposition::LeavePending)
            }
        }
        OcrQueueDeliveryBody::MaximumAttempts {
            readable_job_id, ..
        } => {
            if let Some(job_id) = readable_job_id {
                record_queue_failure(control_client, job_id, config.finalization_timeout).await?;
            }
            dead_letter_and_acknowledge(redis, &config.queue, delivery).await?;
            Ok(DeliveryDisposition::Resolved)
        }
        OcrQueueDeliveryBody::Job(payload) => {
            match wait_for_claim(control_client, payload, config, shutdown).await? {
                ClaimDecision::Claimed(claim) => {
                    Box::pin(process_claimed(
                        control_client,
                        heartbeat_client,
                        objects,
                        engine,
                        config,
                        &claim,
                        payload,
                        shutdown,
                    ))
                    .await
                }
                ClaimDecision::Acknowledge => Ok(DeliveryDisposition::Acknowledge),
                ClaimDecision::LeavePending | ClaimDecision::Retry => {
                    Ok(DeliveryDisposition::LeavePending)
                }
                ClaimDecision::Stop => Ok(DeliveryDisposition::Stop),
            }
        }
    }
}

async fn wait_for_claim(
    client: &mut tokio_postgres::Client,
    payload: &OcrQueuePayload,
    config: &OcrWorkerRuntimeConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<ClaimDecision, OcrWorkerError> {
    let deadline = time::sleep(config.priority_wait);
    tokio::pin!(deadline);
    loop {
        match classify_claim_result(claim_job(client, payload, &config.control).await?) {
            ClaimDecision::Claimed(claim) => return Ok(ClaimDecision::Claimed(claim)),
            ClaimDecision::Acknowledge => return Ok(ClaimDecision::Acknowledge),
            ClaimDecision::LeavePending => return Ok(ClaimDecision::LeavePending),
            ClaimDecision::Stop => return Ok(ClaimDecision::Stop),
            ClaimDecision::Retry => {}
        }
        tokio::select! {
            () = &mut deadline => return Ok(ClaimDecision::LeavePending),
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(ClaimDecision::Stop);
                }
            }
            () = time::sleep(config.heartbeat_interval) => {}
        }
    }
}

fn classify_claim_result(result: OcrClaimResult) -> ClaimDecision {
    match result {
        OcrClaimResult::Claimed(claim) => ClaimDecision::Claimed(claim),
        OcrClaimResult::MissingOrTerminal
        | OcrClaimResult::AlreadyRunning
        | OcrClaimResult::RejectedQueueContract => ClaimDecision::Acknowledge,
        OcrClaimResult::ForeignSchema | OcrClaimResult::NotReady => ClaimDecision::LeavePending,
        OcrClaimResult::Busy | OcrClaimResult::PreemptionRequested => ClaimDecision::Retry,
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the claimed attempt keeps control, heartbeat, object, and engine boundaries explicit"
)]
async fn process_claimed<E: OcrEngine>(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    objects: &R2ObjectStore,
    engine: &E,
    config: &OcrWorkerRuntimeConfig,
    claim: &ClaimedOcrJob,
    payload: &OcrQueuePayload,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, OcrWorkerError> {
    let started = time::Instant::now();
    let downloaded = Box::pin(supervise(
        objects.download(payload),
        config.object_download_timeout,
        heartbeat_client,
        claim,
        config,
        shutdown,
    ))
    .await?;
    let image = match downloaded {
        Supervised::Completed(Ok(image))
            if image.width() == claim.expected_width && image.height() == claim.expected_height =>
        {
            image
        }
        Supervised::Completed(Err(OcrObjectStoreError::NotFound)) => {
            return finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::TempImageMissing,
                started,
            )
            .await;
        }
        Supervised::Completed(Ok(_) | Err(OcrObjectStoreError::Integrity)) => {
            return finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::InvalidImage,
                started,
            )
            .await;
        }
        Supervised::Completed(Err(
            OcrObjectStoreError::AccessDenied | OcrObjectStoreError::Unavailable,
        ))
        | Supervised::TimedOut => {
            requeue_transient(control_client, claim, &config.control).await?;
            return Ok(DeliveryDisposition::LeavePending);
        }
        Supervised::Shutdown => {
            requeue_transient(control_client, claim, &config.control).await?;
            return Ok(DeliveryDisposition::Stop);
        }
        Supervised::OwnerLost => return Ok(DeliveryDisposition::LeavePending),
    };
    let mut attempt = engine
        .start(&image, payload)
        .map_err(OcrWorkerError::Engine)?;
    let recognized = supervise_ocr_attempt(
        attempt.as_mut(),
        config.ocr_timeout,
        heartbeat_client,
        claim,
        config,
        shutdown,
    )
    .await?;
    match recognized {
        Supervised::Completed(Ok(output)) => {
            let completion = draft_completion(output, elapsed_milliseconds(started));
            finish_success(control_client, claim, &config.control, &completion).await?;
            Ok(DeliveryDisposition::Acknowledge)
        }
        Supervised::Completed(Err(failure)) if failure.retryable() => {
            requeue_transient(control_client, claim, &config.control).await?;
            Ok(DeliveryDisposition::LeavePending)
        }
        Supervised::Completed(Err(failure)) => {
            finish_terminal_failure(
                control_client,
                claim,
                config,
                failure.control_code(),
                started,
            )
            .await
        }
        Supervised::TimedOut => {
            finish_terminal_failure(
                control_client,
                claim,
                config,
                OcrFailureCode::OcrTimeout,
                started,
            )
            .await
        }
        Supervised::Shutdown => {
            requeue_transient(control_client, claim, &config.control).await?;
            Ok(DeliveryDisposition::Stop)
        }
        Supervised::OwnerLost => Ok(DeliveryDisposition::LeavePending),
    }
}

fn draft_completion(output: OcrEngineOutput, duration_milliseconds: i32) -> OcrDraftCompletion {
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
    config: &OcrWorkerRuntimeConfig,
    failure: OcrFailureCode,
    started: time::Instant,
) -> Result<DeliveryDisposition, OcrWorkerError> {
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

async fn supervise<F, T>(
    future: F,
    timeout: Duration,
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrWorkerRuntimeConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<Supervised<T>, OcrWorkerError>
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
            output = &mut future => return Ok(Supervised::Completed(output)),
            () = &mut deadline => return Ok(Supervised::TimedOut),
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(Supervised::Shutdown);
                }
            }
            _ = interval.tick() => {
                match heartbeat(heartbeat_client, claim, &config.control).await? {
                    OcrHeartbeatResult::Continue => {}
                    OcrHeartbeatResult::OwnerLost => return Ok(Supervised::OwnerLost),
                }
            }
        }
    }
}

enum OcrAttemptEvent {
    Completed(Result<Result<OcrEngineOutput, OcrEngineFailure>, &'static str>),
    TimedOut,
    Shutdown,
    OwnerLost,
    Dependency(OcrWorkerError),
}

async fn supervise_ocr_attempt(
    attempt: &mut dyn OcrEngineAttempt,
    timeout: Duration,
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedOcrJob,
    config: &OcrWorkerRuntimeConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<Supervised<Result<OcrEngineOutput, OcrEngineFailure>>, OcrWorkerError> {
    let event = {
        let waiting = attempt.wait();
        tokio::pin!(waiting);
        let deadline = time::sleep(timeout);
        tokio::pin!(deadline);
        let mut interval = time::interval(config.heartbeat_interval);
        interval.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
        interval.tick().await;
        loop {
            tokio::select! {
                output = &mut waiting => break OcrAttemptEvent::Completed(output),
                () = &mut deadline => break OcrAttemptEvent::TimedOut,
                result = shutdown.changed() => {
                    if result.is_err() || *shutdown.borrow() {
                        break OcrAttemptEvent::Shutdown;
                    }
                }
                _ = interval.tick() => {
                    match heartbeat(heartbeat_client, claim, &config.control).await {
                        Ok(OcrHeartbeatResult::Continue) => {}
                        Ok(OcrHeartbeatResult::OwnerLost) => {
                            break OcrAttemptEvent::OwnerLost;
                        }
                        Err(error) => {
                            break OcrAttemptEvent::Dependency(error.into());
                        }
                    }
                }
            }
        }
    };

    match event {
        OcrAttemptEvent::Completed(Ok(output)) => Ok(Supervised::Completed(output)),
        OcrAttemptEvent::Completed(Err(kind)) => {
            terminate_ocr_attempt(attempt).await?;
            Err(OcrWorkerError::Engine(kind))
        }
        OcrAttemptEvent::TimedOut => {
            terminate_ocr_attempt(attempt).await?;
            Ok(Supervised::TimedOut)
        }
        OcrAttemptEvent::Shutdown => {
            terminate_ocr_attempt(attempt).await?;
            Ok(Supervised::Shutdown)
        }
        OcrAttemptEvent::OwnerLost => {
            terminate_ocr_attempt(attempt).await?;
            Ok(Supervised::OwnerLost)
        }
        OcrAttemptEvent::Dependency(error) => {
            terminate_ocr_attempt(attempt).await?;
            Err(error)
        }
    }
}

async fn terminate_ocr_attempt(attempt: &mut dyn OcrEngineAttempt) -> Result<(), OcrWorkerError> {
    attempt.terminate().await.map_err(OcrWorkerError::Engine)
}

fn elapsed_milliseconds(started: time::Instant) -> i32 {
    i32::try_from(started.elapsed().as_millis()).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_failures_have_one_deterministic_control_policy() {
        for failure in [
            OcrEngineFailure::InvalidImage,
            OcrEngineFailure::UnsupportedImageFormat,
            OcrEngineFailure::DecodeFailed,
            OcrEngineFailure::CategoryUndetected,
            OcrEngineFailure::LayoutUnsupported,
            OcrEngineFailure::ParserFailed,
        ] {
            assert!(!failure.retryable());
        }
        assert!(OcrEngineFailure::EngineUnavailable.retryable());
    }

    #[test]
    fn claim_disposition_is_closed_for_duplicate_and_deferred_work() {
        for result in [
            OcrClaimResult::MissingOrTerminal,
            OcrClaimResult::AlreadyRunning,
            OcrClaimResult::RejectedQueueContract,
        ] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimDecision::Acknowledge
            ));
        }
        for result in [OcrClaimResult::ForeignSchema, OcrClaimResult::NotReady] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimDecision::LeavePending
            ));
        }
        for result in [OcrClaimResult::Busy, OcrClaimResult::PreemptionRequested] {
            assert!(matches!(
                classify_claim_result(result),
                ClaimDecision::Retry
            ));
        }
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
            OcrWorkerRuntimeConfig::new(
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
