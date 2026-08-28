use std::time::Instant;

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, QueuePayload};
use redis::{RedisError, aio::ConnectionManager};
use thiserror::Error;
use tokio::sync::watch;
use tracing::{Instrument, error, info, info_span, warn};

pub(crate) mod artifact;
pub(crate) mod child;
pub(crate) mod child_report;
pub(crate) mod config;
pub(crate) mod control;
pub(crate) mod endurance;
pub(crate) mod outbox;
pub(crate) mod release;

use crate::{
    outbox::{ControlOutcome, PostCommitSink, PostCommitSinkClosed},
    pel_recovery::{PelRecoverySchedule, RecoveryAction},
    postgres::{self, PostgresError},
    process::ProcessError,
};

use self::{
    config::AnalysisConsumerConfig,
    control::{
        ALGORITHM_VERSION, AttemptFailure, ClaimResult, ControlError, IdleRefreshSchedule,
        SafeFailureCode, claim_job, finish_failure, mark_draining, register_capability,
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
use queue::{
    AutoClaimCursor, acknowledge, ensure_consumer_group, payload_from_delivery, read_new_delivery,
    recover_cold_page, recover_targeted_delivery,
};

#[derive(Debug, Error)]
pub(crate) enum ConsumerError {
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
    #[error("analysis post-commit coordination channel is closed")]
    PostCommitSink(#[from] PostCommitSinkClosed),
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
            Self::PostCommitSink(_) => "post_commit_sink_closed",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeliveryDisposition {
    Acknowledge,
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

/// Runs the durable analysis consumer with the process-local post-commit coordinator sink.
///
/// # Errors
///
/// Returns a structural error when the coordinator has stopped accepting committed work. The
/// durable database transition is not rolled back and the source delivery is not advanced.
pub(crate) async fn run(
    config: AnalysisConsumerConfig,
    post_commit_sink: PostCommitSink,
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
    let read_client = startup_result(
        postgres::connect(&config.read_database_url).await,
        "read_database_connect",
    )?;
    // A fresh startup must authenticate every configured database credential. The calculation
    // child opens its own read-only connection later, so this probe is intentionally not retained.
    drop(read_client);
    startup_result(
        cleanup_stale_attempt_directories(&config, &control_client).await,
        "temporary_storage_recovery",
    )?;
    startup_result(
        register_capability(&heartbeat_client, &config.worker_id).await,
        "capability_registration",
    )?;
    let capability_refresh = IdleRefreshSchedule::after_success(Instant::now());

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
        &post_commit_sink,
        capability_refresh,
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
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    mut capability_refresh: IdleRefreshSchedule,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), ConsumerError> {
    let mut recovery_cursor = AutoClaimCursor::start();
    let mut recovery_schedule =
        PelRecoverySchedule::new(Instant::now(), config.pel_recovery_interval);
    while !*shutdown.borrow() {
        if capability_refresh.is_due_at(Instant::now()) {
            register_capability(heartbeat_client, &config.worker_id).await?;
            capability_refresh.record_success_at(Instant::now());
        }
        let delivery = match recovery_schedule.due_action(Instant::now()) {
            Some(RecoveryAction::ColdPage) => {
                let page = recover_cold_page(redis, config, &mut recovery_cursor).await?;
                if !recovery_schedule.record_cold_page(Instant::now(), page.complete) {
                    return Err(ConsumerError::DurationBound);
                }
                page.delivery
            }
            Some(RecoveryAction::Targeted(message_id)) => {
                let delivery = recover_targeted_delivery(redis, config, &message_id).await?;
                recovery_schedule.record_target_attempt(&message_id);
                delivery
            }
            None => {
                let delivery = read_new_delivery(redis, config).await?;
                recovery_schedule.record_new_delivery_read();
                delivery
            }
        };
        let Some(delivery) = delivery else {
            continue;
        };
        let message_id = delivery.id.clone();
        let delivery_received_at = Instant::now();
        recovery_schedule.forget_target(&message_id);
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
            post_commit_sink,
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
            DeliveryDisposition::LeavePending(policy) => {
                if policy == PendingRecoveryPolicy::AtIdleThreshold {
                    let Some(due_at) = delivery_received_at.checked_add(config.lease_duration)
                    else {
                        return Err(ConsumerError::DurationBound);
                    };
                    if !recovery_schedule.schedule_target(message_id.clone(), due_at) {
                        warn!(
                            event = "analysis_pel_target_schedule_full",
                            recovery = "cold",
                            "analysis pending delivery will wait for bounded cold recovery"
                        );
                    }
                }
            }
            DeliveryDisposition::StopLoop => break,
        }
    }
    Ok(())
}

async fn process_delivery(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    message_id: &str,
    payload: &QueuePayload,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, ConsumerError> {
    let claim = submit_control_outcome(
        post_commit_sink,
        claim_job(control_client, &payload.job_id, config).await?,
    )?;
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
            return Ok(DeliveryDisposition::leave_pending_cold());
        }
        ClaimResult::NotYetAvailable => {
            return Ok(DeliveryDisposition::leave_pending_cold());
        }
        ClaimResult::Busy => {
            return Ok(DeliveryDisposition::LeavePending(
                PendingRecoveryPolicy::AtIdleThreshold,
            ));
        }
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
        let result = process_claimed_delivery(
            control_client,
            heartbeat_client,
            config,
            post_commit_sink,
            &claim,
            shutdown,
        )
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

fn submit_control_outcome<T>(
    sink: &PostCommitSink,
    outcome: ControlOutcome<T>,
) -> Result<T, ConsumerError> {
    sink.submit(outcome.effects)?;
    Ok(outcome.value)
}

async fn process_claimed_delivery(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
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
            let outcome = finish_failure(control_client, claim, config, failure, &metrics).await?;
            submit_control_outcome(post_commit_sink, outcome)?;
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
    let outcome = finish_attempt_result(
        control_client,
        config,
        claim,
        &attempt_directory,
        started,
        result,
    )
    .await?;
    let disposition = submit_control_outcome(post_commit_sink, outcome)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outbox::{OutboxKind, PostCommitEffects};

    #[test]
    fn closed_sink_blocks_a_committed_queue_disposition() {
        let (sink, receiver) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        drop(receiver);

        let result = submit_control_outcome(
            &sink,
            ControlOutcome::new(
                DeliveryDisposition::Acknowledge,
                PostCommitEffects::wake(OutboxKind::SeriesAnalysis),
            ),
        );

        assert!(matches!(result, Err(ConsumerError::PostCommitSink(_))));
    }
}
