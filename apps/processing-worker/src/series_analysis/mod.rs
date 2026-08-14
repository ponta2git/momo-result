use std::time::Instant;

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, QueuePayload};
use redis::{RedisError, aio::ConnectionManager};
use thiserror::Error;
use tokio::sync::watch;
use tracing::{Instrument, error, info, info_span, warn};

pub mod artifact;
pub mod child;
pub mod child_report;
pub mod config;
pub mod control;
pub mod endurance;
pub mod release;

use crate::{
    postgres::{self, PostgresError},
    process::ProcessError,
};

use self::{
    config::WorkerRuntimeConfig,
    control::{
        ALGORITHM_VERSION, AttemptFailure, ClaimResult, ControlError, SafeFailureCode, claim_job,
        finish_failure, mark_draining, register_capability,
    },
};

mod attempt;
mod attempt_directory;
mod input_repository;
mod metrics;
mod policy;
mod queue;

use attempt::{child_spec, finish_attempt_result, run_claimed_child};
use attempt_directory::{
    cleanup_stale_attempt_directories, create_attempt_directory, validate_temporary_root,
};
use metrics::elapsed_metrics;
use queue::{acknowledge, ensure_consumer_group, next_delivery, payload_from_delivery};

#[derive(Debug, Error)]
pub enum ConsumerError {
    #[error("analysis control database connection failed")]
    Database(#[from] PostgresError),
    #[error("analysis control-plane transition failed")]
    Control(#[from] ControlError),
    #[error("analysis Redis operation failed")]
    Redis(#[from] RedisError),
    #[error("analysis child process operation failed")]
    Process(#[from] ProcessError),
    #[error("analysis temporary directory operation failed")]
    Temporary(#[from] std::io::Error),
    #[error("analysis runtime duration exceeds a supported bound")]
    DurationBound,
    #[error("analysis runtime duration conversion exceeds a supported bound")]
    DurationConversion(#[from] std::num::TryFromIntError),
    #[error("analysis temporary storage does not meet the configured bound")]
    TemporaryStorageBound,
}

impl ConsumerError {
    #[must_use]
    const fn kind(&self) -> &'static str {
        match self {
            Self::Database(error) => error.kind(),
            Self::Control(error) => error.kind(),
            Self::Redis(_) => "redis_operation",
            Self::Process(error) => error.kind(),
            Self::Temporary(_) => "temporary_storage_io",
            Self::DurationBound => "duration_bound",
            Self::DurationConversion(_) => "duration_conversion",
            Self::TemporaryStorageBound => "temporary_storage_bound",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeliveryDisposition {
    Acknowledge,
    LeavePending,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AttemptInterruption {
    TimedOut,
    Preempted,
    Shutdown,
    OwnerLost,
    WorkerCrashed,
}

impl AttemptInterruption {
    const fn wire(self) -> &'static str {
        match self {
            Self::TimedOut => "timed_out",
            Self::Preempted => "preempted",
            Self::Shutdown => "shutdown",
            Self::OwnerLost => "owner_lost",
            Self::WorkerCrashed => "worker_crashed",
        }
    }
}

/// Runs the durable analysis consumer until shutdown is requested.
///
/// # Errors
///
/// Returns an error only when a runtime dependency or safety boundary fails. Individual analysis
/// failures are persisted as terminal jobs and do not stop the parent worker.
pub(crate) async fn run(
    config: WorkerRuntimeConfig,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), ConsumerError> {
    if !crate::process::managed_analysis_runtime_supported() {
        let error = ConsumerError::Process(ProcessError::UnsupportedPlatform);
        log_startup_failure("platform_contract", &error);
        return Err(error);
    }
    if !crate::process::worker_identity_supported() {
        let error = ConsumerError::Process(ProcessError::InvalidWorkerIdentity);
        log_startup_failure("worker_identity", &error);
        return Err(error);
    }
    startup_result(
        config
            .child_cgroup
            .ensure_empty()
            .map_err(ProcessError::from),
        "child_cgroup_validation",
    )?;
    startup_result(
        validate_temporary_root(&config).await,
        "temporary_storage_validation",
    )?;
    let mut control_client = startup_result(
        postgres::connect(&config.database_url).await,
        "control_database_connect",
    )?;
    let mut heartbeat_client = startup_result(
        postgres::connect(&config.database_url).await,
        "heartbeat_database_connect",
    )?;
    startup_result(
        cleanup_stale_attempt_directories(&config, &control_client).await,
        "temporary_storage_recovery",
    )?;
    startup_result(
        register_capability(&control_client, &config.worker_id).await,
        "capability_registration",
    )?;

    let redis_client = startup_result(
        redis::Client::open(config.redis_url.as_str()),
        "queue_configuration",
    )?;
    let mut redis = startup_result(redis_client.get_connection_manager().await, "queue_connect")?;
    startup_result(
        ensure_consumer_group(&mut redis, &config).await,
        "queue_consumer_group",
    )?;
    info!(
        event = "analysis_worker_ready",
        worker_id = %config.worker_id,
        "analysis worker is ready"
    );
    let result = consume_deliveries(
        &mut control_client,
        &mut heartbeat_client,
        &mut redis,
        &config,
        &mut shutdown,
    )
    .await;
    if let Err(error) = &result {
        error!(
            event = "analysis_worker_runtime_failed",
            phase = "delivery_loop",
            error_kind = error.kind(),
            "analysis worker delivery loop stopped unexpectedly"
        );
    }
    if let Err(error) = mark_draining(&control_client, &config.worker_id).await {
        if result.is_ok() {
            return Err(error.into());
        }
        error!(
            event = "analysis_worker_draining_persist_failed",
            worker_id = %config.worker_id,
            error_kind = error.kind(),
            "analysis worker failed to persist its draining state after a runtime error"
        );
    }
    result?;
    info!(
        event = "analysis_worker_drained",
        worker_id = %config.worker_id,
        "analysis worker drained"
    );
    Ok(())
}

fn startup_result<T, E>(result: Result<T, E>, phase: &'static str) -> Result<T, ConsumerError>
where
    E: Into<ConsumerError>,
{
    result.map_err(|source| {
        let error = source.into();
        log_startup_failure(phase, &error);
        error
    })
}

fn log_startup_failure(phase: &'static str, error: &ConsumerError) {
    error!(
        event = "analysis_worker_startup_failed",
        phase,
        error_kind = error.kind(),
        "analysis worker startup boundary failed"
    );
}

async fn consume_deliveries(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    redis: &mut ConnectionManager,
    config: &WorkerRuntimeConfig,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), ConsumerError> {
    while !*shutdown.borrow() {
        register_capability(control_client, &config.worker_id).await?;
        let delivery = next_delivery(redis, config).await?;
        let Some(delivery) = delivery else {
            continue;
        };
        let message_id = delivery.id.clone();
        let Some(payload) = payload_from_delivery(&delivery) else {
            warn!(
                event = "analysis_delivery_discarded",
                phase = "delivery_decode",
                message_id = %message_id,
                reason = "malformed_payload",
                "discarding malformed analysis delivery"
            );
            if let Err(error) = acknowledge(redis, config, &message_id).await {
                error!(
                    event = "analysis_delivery_ack_failed",
                    phase = "delivery_ack",
                    message_id = %message_id,
                    error_kind = "redis_operation",
                    "malformed analysis delivery acknowledgement failed"
                );
                return Err(error);
            }
            continue;
        };

        let disposition = process_delivery(
            control_client,
            heartbeat_client,
            config,
            &message_id,
            &payload,
            shutdown,
        )
        .await?;
        match disposition {
            DeliveryDisposition::Acknowledge => {
                if let Err(error) = acknowledge(redis, config, &message_id).await {
                    error!(
                        event = "analysis_delivery_ack_failed",
                        phase = "delivery_ack",
                        message_id = %message_id,
                        job_id = %payload.job_id,
                        error_kind = "redis_operation",
                        "analysis delivery acknowledgement failed"
                    );
                    return Err(error);
                }
            }
            DeliveryDisposition::LeavePending => {}
            DeliveryDisposition::Stop => break,
        }
    }
    Ok(())
}

async fn process_delivery(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    message_id: &str,
    payload: &QueuePayload,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, ConsumerError> {
    let claim = claim_job(control_client, &payload.job_id, config).await?;
    let claim = match claim {
        ClaimResult::Claimed(claim) => claim,
        ClaimResult::MissingOrTerminal => {
            info!(
                event = "analysis_delivery_resolved",
                job_id = %payload.job_id,
                disposition = "acknowledge",
                reason = "missing_or_terminal",
                "analysis delivery required no work"
            );
            return Ok(DeliveryDisposition::Acknowledge);
        }
        ClaimResult::UnsupportedVersion(version) => {
            warn!(
                event = "analysis_delivery_deferred",
                phase = "claim",
                message_id,
                job_id = %payload.job_id,
                disposition = "leave_pending",
                reason = "unsupported_version",
                job_algorithm_version = %version.algorithm_version,
                job_artifact_schema_version = version.artifact_schema_version,
                supported_algorithm_version = ALGORITHM_VERSION,
                supported_artifact_schema_version = ARTIFACT_SCHEMA_VERSION,
                "analysis delivery requires a compatible worker generation"
            );
            return Ok(DeliveryDisposition::LeavePending);
        }
        ClaimResult::NotReady => {
            return Ok(DeliveryDisposition::LeavePending);
        }
        ClaimResult::Busy => return Ok(DeliveryDisposition::LeavePending),
    };
    let span = info_span!(
        "analysis_attempt",
        delivery_message_id = message_id,
        worker_id = %config.worker_id,
        job_id = %claim.job_id,
        attempt_id = %claim.attempt_id,
        game_title_id = %claim.game_title_id,
        attempt_no = claim.attempt_no,
        input_revision = claim.input_revision,
        algorithm_version = %claim.algorithm_version,
        artifact_schema_version = claim.artifact_schema_version,
        fencing_token = claim.fencing_token,
    );
    async {
        let result =
            process_claimed_delivery(control_client, heartbeat_client, config, &claim, shutdown)
                .await;
        if let Err(error) = &result {
            error!(
                event = "analysis_attempt_runtime_failed",
                phase = "control_plane",
                error_kind = error.kind(),
                "analysis attempt could not complete its control-plane transition"
            );
        }
        result
    }
    .instrument(span)
    .await
}

async fn process_claimed_delivery(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &control::ClaimedJob,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, ConsumerError> {
    info!(
        event = "analysis_attempt_claimed",
        phase = "claim",
        state = "running",
        "analysis attempt claimed"
    );

    let started = Instant::now();
    let attempt_directory = match create_attempt_directory(config, claim).await {
        Ok(directory) => directory,
        Err(_error) => {
            let metrics = elapsed_metrics(started, None);
            let failure = AttemptFailure::failed(SafeFailureCode::TemporaryStorageExhausted);
            finish_failure(control_client, claim, config, failure, &metrics).await?;
            warn!(
                event = "analysis_attempt_finished",
                phase = "temporary_storage_prepare",
                outcome = failure.outcome_wire(),
                safe_failure_code = failure.code_wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt failed before child startup"
            );
            return Ok(DeliveryDisposition::Acknowledge);
        }
    };
    let child_spec = child_spec(config, claim, &attempt_directory)?;
    let result = run_claimed_child(
        heartbeat_client,
        config,
        claim,
        &child_spec,
        shutdown,
        started,
    )
    .await;
    let disposition = finish_attempt_result(
        control_client,
        config,
        claim,
        &attempt_directory,
        started,
        result,
    )
    .await?;
    if let Err(cleanup_error) = tokio::fs::remove_dir_all(&attempt_directory).await {
        error!(
            event = "analysis_attempt_cleanup_failed",
            phase = "temporary_storage_cleanup",
            error_kind = "temporary_storage_io",
            "analysis attempt directory cleanup failed"
        );
        return Err(ConsumerError::Temporary(cleanup_error));
    }
    Ok(disposition)
}
