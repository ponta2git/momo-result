use std::time::{Duration, Instant, SystemTime};

use momo_analysis_core::contract::{
    ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID, QueuePayload,
};
use redis::{RedisError, aio::ConnectionManager, streams::StreamId};
use thiserror::Error;
use tokio::sync::watch;
use tracing::{Instrument, error, info, info_span, warn};

pub(crate) mod artifact;
pub(crate) mod child;
mod child_process;
pub(crate) mod child_report;
pub(crate) mod config;
pub(crate) mod control;
pub(crate) mod endurance;
pub(crate) mod outbox;
pub(crate) mod release;

use crate::{
    busy_retry::BusyRetryBudget,
    outbox::{ControlOutcome, PostCommitSink, PostCommitSinkClosed},
    pel_recovery::{PelRecoverySchedule, RecoveryAction},
    postgres::{self, PostgresError},
    process::ProcessError,
};

use self::{
    config::AnalysisConsumerConfig,
    control::{
        ALGORITHM_VERSION, AttemptFailure, ClaimResult, ControlError, IdleRefreshSchedule,
        SafeFailureCode, finish_failure, mark_draining, register_capability,
    },
};

mod attempt;
mod attempt_directory;
mod campaign;
mod claim_wait;
mod heartbeat;
mod input_repository;
mod radar_prepare;
use heartbeat::HeartbeatConnection;
mod metrics;
mod policy;
mod queue;

use attempt::{child_spec, finish_attempt_result, run_claimed_child};
use attempt_directory::{
    cleanup_stale_attempt_directories, create_attempt_directory, validate_temporary_root,
};
use claim_wait::claim_delivery;
use metrics::{PhaseTimer, elapsed_metrics, measure};
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
    #[error("analysis control-plane operation exceeded its deadline")]
    ControlTimeout,
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
            Self::ControlTimeout => "control_timeout",
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
    Targeted { remaining_delay: Duration },
}

impl DeliveryDisposition {
    const fn leave_pending_cold() -> Self {
        Self::LeavePending(PendingRecoveryPolicy::ColdOnly)
    }

    const fn retry_shared_slot_busy() -> Self {
        Self::retry_targeted_after(Duration::ZERO)
    }

    const fn retry_targeted_after(remaining_delay: Duration) -> Self {
        Self::LeavePending(PendingRecoveryPolicy::Targeted { remaining_delay })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AttemptInterruption {
    TimedOut,
    Preempted,
    Shutdown,
    OwnerLost,
    HeartbeatUncertain,
    WorkerCrashed,
}

struct MaintenanceSchedules {
    capability_refresh: IdleRefreshSchedule,
    stale_attempt_cleanup_due: Option<Instant>,
    history_cleanup_due: Instant,
}

impl MaintenanceSchedules {
    fn early_claim_until(
        &self,
        received_at: Instant,
        recovery: &PelRecoverySchedule,
        lease_duration: Duration,
    ) -> Option<Instant> {
        let recovery_wait = recovery.read_block(received_at, lease_duration);
        received_at.checked_add(recovery_wait.min(self.next_due_in(received_at)))
    }

    fn next_due_in(&self, now: Instant) -> Duration {
        let cleanup_due = self
            .stale_attempt_cleanup_due
            .map_or(self.history_cleanup_due, |due_at| {
                due_at.min(self.history_cleanup_due)
            });
        self.capability_refresh
            .next_due_in(now)
            .min(cleanup_due.saturating_duration_since(now))
    }

    async fn run_due(
        &mut self,
        control_client: &mut tokio_postgres::Client,
        config: &AnalysisConsumerConfig,
    ) -> Result<(), ConsumerError> {
        // Retention runs between attempts; a busy worker delays it until that bounded attempt ends.
        if Instant::now() >= self.history_cleanup_due {
            match control::cleanup_history(control_client, SystemTime::now(), 500).await {
                Ok(counts) => info!(
                    event = "analysis_history_pruned",
                    deleted = counts.iter().sum::<u64>(),
                    "expired analysis history was pruned"
                ),
                Err(error) => warn!(
                    event = "analysis_history_prune_failed",
                    error_kind = error.kind(),
                    "analysis history cleanup will retry at its next scheduled pass"
                ),
            }
            self.history_cleanup_due = Instant::now() + control::HISTORY_CLEANUP_INTERVAL;
        }
        // A young stale directory contributes its own one-shot maturity deadline. Rechecking at
        // the bounded delivery-loop cadence avoids both a permanent startup skip and a hot poll.
        if self
            .stale_attempt_cleanup_due
            .is_some_and(|due_at| due_at <= Instant::now())
        {
            self.stale_attempt_cleanup_due =
                cleanup_stale_attempt_directories(config, control_client).await?;
        }
        if self.capability_refresh.is_due_at(Instant::now()) {
            register_capability(control_client, &config.worker_id).await?;
            self.capability_refresh.record_success_at(Instant::now());
        }
        Ok(())
    }
}

impl AttemptInterruption {
    const fn wire(self) -> &'static str {
        match self {
            Self::TimedOut => "timed_out",
            Self::Preempted => "preempted",
            Self::Shutdown => "shutdown",
            Self::OwnerLost => "owner_lost",
            Self::HeartbeatUncertain => "heartbeat_uncertain",
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
    if !child_process::managed_analysis_runtime_supported() {
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
        HeartbeatConnection::connect(&config.database_url).await,
        "heartbeat_database_connect",
    )?;
    let read_client = startup_result(
        postgres::connect(&config.read_database_url).await,
        "read_database_connect",
    )?;
    // A fresh startup must authenticate every configured database credential. The calculation
    // child opens its own read-only connection later, so this probe is intentionally not retained.
    drop(read_client);
    let stale_attempt_cleanup_due = startup_result(
        cleanup_stale_attempt_directories(&config, &control_client).await,
        "temporary_storage_recovery",
    )?;
    startup_result(
        register_capability(&control_client, &config.worker_id).await,
        "capability_registration",
    )?;
    let maintenance = MaintenanceSchedules {
        capability_refresh: IdleRefreshSchedule::after_success(Instant::now()),
        stale_attempt_cleanup_due,
        history_cleanup_due: Instant::now(),
    };

    let redis_client = startup_result(
        redis::Client::open(config.redis_url.as_str()),
        "queue_configuration",
    )?;
    let connection = crate::stream_connection::connect(&redis_client).await;
    let mut redis = startup_result(connection, "queue_connect")?;
    startup_result(
        ensure_consumer_group(&mut redis, &config).await,
        "queue_consumer_group",
    )?;
    info!(
        event = "analysis_worker_ready",
        worker_id = %config.worker_id,
        "analysis worker is ready"
    );
    let result = Box::pin(consume_deliveries(
        &mut control_client,
        &mut heartbeat_client,
        &mut redis,
        &config,
        &post_commit_sink,
        maintenance,
        &mut shutdown,
    ))
    .await;
    if let Err(error) = &result {
        error!(
            event = "analysis_worker_runtime_failed",
            phase = "delivery_loop",
            error_kind = error.kind(),
            "analysis worker delivery loop stopped unexpectedly"
        );
    }
    if let Err(error) = mark_draining_with_deadline(&control_client, &config).await {
        if result.is_ok() {
            return Err(error);
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

async fn mark_draining_with_deadline(
    client: &tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
) -> Result<(), ConsumerError> {
    // A failed claim can leave a response unread. Draining is best-effort after failure and
    // must not keep the consumer alive indefinitely on that same connection.
    tokio::time::timeout(
        config.control_response_timeout(),
        mark_draining(client, &config.worker_id),
    )
    .await
    .map_err(|_elapsed| ConsumerError::ControlTimeout)??;
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
    heartbeat_client: &mut HeartbeatConnection,
    redis: &mut ConnectionManager,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    mut maintenance: MaintenanceSchedules,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), ConsumerError> {
    let mut recovery_cursor = AutoClaimCursor::start();
    let mut recovery_schedule =
        PelRecoverySchedule::new(Instant::now(), config.pel_recovery_interval);
    let mut busy_retry_budget = BusyRetryBudget::new(config.lease_duration);
    while !*shutdown.borrow() {
        maintenance.run_due(control_client, config).await?;
        let delivery = next_delivery(
            redis,
            config,
            &mut recovery_cursor,
            &mut recovery_schedule,
            &maintenance,
        )
        .await?;
        if *shutdown.borrow() {
            break;
        }
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

        let early_claim_until = maintenance
            .early_claim_until(
                delivery_received_at,
                &recovery_schedule,
                config.lease_duration,
            )
            .ok_or(ConsumerError::DurationBound)?;
        let disposition = process_delivery(
            control_client,
            heartbeat_client,
            config,
            post_commit_sink,
            &message_id,
            &payload,
            early_claim_until,
            &mut busy_retry_budget,
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
                schedule_pending_recovery(
                    &mut recovery_schedule,
                    message_id,
                    policy,
                    delivery_received_at,
                    config.lease_duration,
                )?;
            }
            DeliveryDisposition::StopLoop => break,
        }
    }
    Ok(())
}

async fn next_delivery(
    redis: &mut ConnectionManager,
    config: &AnalysisConsumerConfig,
    recovery_cursor: &mut AutoClaimCursor,
    recovery_schedule: &mut PelRecoverySchedule,
    maintenance: &MaintenanceSchedules,
) -> Result<Option<StreamId>, ConsumerError> {
    match recovery_schedule.due_action(Instant::now()) {
        Some(RecoveryAction::ColdPage) => {
            let page = recover_cold_page(redis, config, recovery_cursor).await?;
            if !recovery_schedule.record_cold_page(Instant::now(), page.complete) {
                return Err(ConsumerError::DurationBound);
            }
            Ok(page.delivery)
        }
        Some(RecoveryAction::Targeted(message_id)) => {
            let delivery = recover_targeted_delivery(redis, config, &message_id).await?;
            recovery_schedule.record_target_attempt(&message_id);
            Ok(delivery)
        }
        None => {
            let now = Instant::now();
            let block = recovery_schedule
                .read_block(now, config.redis_block)
                .min(maintenance.next_due_in(now));
            let delivery = read_new_delivery(redis, config, block).await?;
            recovery_schedule.record_new_delivery_read();
            Ok(delivery)
        }
    }
}

fn schedule_pending_recovery(
    schedule: &mut PelRecoverySchedule,
    message_id: String,
    policy: PendingRecoveryPolicy,
    delivery_received_at: Instant,
    delivery_idle_threshold: Duration,
) -> Result<(), ConsumerError> {
    let PendingRecoveryPolicy::Targeted { remaining_delay } = policy else {
        return Ok(());
    };
    // Anchor the DB-clock delay only after the claim result arrives, so transaction rollback and
    // transport latency can make recovery conservative but never earlier than `available_at`.
    let due_at = targeted_recovery_due_at(
        delivery_received_at,
        Instant::now(),
        delivery_idle_threshold,
        remaining_delay,
    )
    .ok_or(ConsumerError::DurationBound)?;
    if !schedule.schedule_target(message_id, due_at) {
        warn!(
            event = "analysis_pel_target_schedule_full",
            recovery = "cold",
            "analysis pending delivery will wait for bounded cold recovery"
        );
    }
    Ok(())
}

#[expect(
    clippy::too_many_arguments,
    reason = "the delivery keeps its recovery and maintenance bounds alongside the shared retry budget"
)]
async fn process_delivery(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut HeartbeatConnection,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    message_id: &str,
    payload: &QueuePayload,
    early_claim_until: Instant,
    busy_retry_budget: &mut BusyRetryBudget,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<DeliveryDisposition, ConsumerError> {
    let Some(claim) = Box::pin(claim_delivery(
        control_client,
        &payload.job_id,
        config,
        post_commit_sink,
        early_claim_until,
        busy_retry_budget,
        shutdown,
    ))
    .await?
    else {
        return Ok(DeliveryDisposition::StopLoop);
    };
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
        ClaimResult::RecoveredCurrentJob => {
            info!(
                event = "analysis_delivery_resolved",
                job_id = %payload.job_id,
                disposition = "acknowledge",
                reason = "expired_attempt_recovered",
                "analysis delivery was resolved by durable lease-recovery state"
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
                job_validation_contract_id = version.validation_contract_id.as_deref().unwrap_or("missing"),
                supported_algorithm_version = ALGORITHM_VERSION,
                supported_artifact_schema_version = ARTIFACT_SCHEMA_VERSION,
                supported_validation_contract_id = ARTIFACT_VALIDATION_CONTRACT_ID,
                "analysis delivery requires a compatible worker generation"
            );
            return Ok(DeliveryDisposition::leave_pending_cold());
        }
        ClaimResult::NotYetAvailable { remaining_delay } => {
            return Ok(DeliveryDisposition::retry_targeted_after(remaining_delay));
        }
        ClaimResult::Busy => {
            return Ok(DeliveryDisposition::retry_shared_slot_busy());
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
        validation_contract_id = claim.validation_contract_id.as_deref().unwrap_or("missing"),
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

fn targeted_recovery_due_at(
    delivery_received_at: Instant,
    claim_resolved_at: Instant,
    delivery_idle_threshold: Duration,
    remaining_delay: Duration,
) -> Option<Instant> {
    let idle_due_at = delivery_received_at.checked_add(delivery_idle_threshold)?;
    let available_due_at = claim_resolved_at.checked_add(remaining_delay)?;
    Some(idle_due_at.max(available_due_at))
}

async fn process_claimed_delivery(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut HeartbeatConnection,
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

    let attempt_timer = PhaseTimer::start("attempt_after_claim");
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
    let attempt_result = async {
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
        let result =
            attempt::renew_before_publication(heartbeat_client, config, claim, shutdown, result)
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
        submit_control_outcome(post_commit_sink, outcome)
    }
    .await;
    heartbeat_client.finish_attempt();
    let result = measure(
        "attempt_cleanup",
        cleanup_attempt_directory(&attempt_directory, attempt_result),
    )
    .await;
    if result.is_ok() {
        attempt_timer.complete();
    }
    result
}

/// Removes a completed attempt's non-authoritative files without hiding its control-plane result.
async fn cleanup_attempt_directory<T>(
    attempt_directory: &std::path::Path,
    attempt_result: Result<T, ConsumerError>,
) -> Result<T, ConsumerError> {
    let cleanup_result = tokio::fs::remove_dir_all(attempt_directory).await;
    if let Err(cleanup_error) = cleanup_result {
        error!(
            event = "analysis_attempt_cleanup_failed",
            phase = "temporary_storage_cleanup",
            error_kind = "temporary_storage_io",
            "analysis attempt directory cleanup failed"
        );
        return match attempt_result {
            Ok(_value) => Err(ConsumerError::Temporary(cleanup_error)),
            Err(attempt_error) => Err(attempt_error),
        };
    }
    attempt_result
}

#[cfg(test)]
mod tests {
    use std::error::Error as StdError;

    use super::*;
    use crate::outbox::PostCommitEffects;

    #[test]
    fn idle_reads_preserve_capability_and_cleanup_deadlines() {
        let now = Instant::now();
        let mut maintenance = MaintenanceSchedules {
            capability_refresh: IdleRefreshSchedule::after_success(now),
            stale_attempt_cleanup_due: None,
            history_cleanup_due: now + Duration::from_hours(1),
        };
        assert_eq!(maintenance.next_due_in(now), Duration::from_mins(1));
        maintenance.stale_attempt_cleanup_due = Some(now + Duration::from_secs(3));
        assert_eq!(maintenance.next_due_in(now), Duration::from_secs(3));
        maintenance.history_cleanup_due = now + Duration::from_secs(2);
        assert_eq!(maintenance.next_due_in(now), Duration::from_secs(2));
        assert_eq!(
            maintenance.next_due_in(now + Duration::from_secs(2)),
            Duration::ZERO
        );
    }

    #[test]
    fn early_claims_yield_to_existing_recovery_and_maintenance() {
        let now = Instant::now();
        let mut maintenance = MaintenanceSchedules {
            capability_refresh: IdleRefreshSchedule::after_success(now),
            stale_attempt_cleanup_due: None,
            history_cleanup_due: now + Duration::from_hours(1),
        };
        let lease = Duration::from_secs(70);
        let mut recovery = PelRecoverySchedule::new(now, Duration::from_mins(5));
        assert!(recovery.record_cold_page(now, true));
        assert!(
            recovery.schedule_target(String::from("older-delivery"), now + Duration::from_secs(2))
        );
        let deadline = maintenance.early_claim_until(now, &recovery, lease);
        assert_eq!(deadline, Some(now + Duration::from_secs(2)));
        let retry = crate::busy_retry::BusyRetry::new(
            tokio::time::Instant::from_std(now),
            tokio::time::Instant::from_std(deadline.unwrap_or(now)),
        );
        assert!(
            retry
                .next_at(tokio::time::Instant::from_std(now + Duration::from_secs(1)))
                .is_none(),
            "a busy delivery cannot start another check at an older delivery's recovery deadline"
        );

        recovery.forget_target("older-delivery");
        maintenance.stale_attempt_cleanup_due = Some(now + Duration::from_secs(1));
        assert_eq!(
            maintenance.early_claim_until(now, &recovery, lease),
            Some(now + Duration::from_secs(1))
        );
        assert!(recovery.record_cold_page(now, false));
        assert_eq!(
            maintenance.early_claim_until(now, &recovery, lease),
            Some(now),
            "an unfinished cold sweep takes precedence over optional early claims"
        );
    }

    #[test]
    fn closed_sink_blocks_a_committed_queue_disposition() {
        let (sink, receiver) = PostCommitSink::channel();
        drop(receiver);

        let result = submit_control_outcome(
            &sink,
            ControlOutcome::new(
                DeliveryDisposition::Acknowledge,
                PostCommitEffects::WakeAnalysis,
            ),
        );

        assert!(matches!(result, Err(ConsumerError::PostCommitSink(_))));
    }

    #[test]
    fn shared_slot_busy_keeps_the_delivery_for_targeted_recovery() {
        assert_eq!(
            DeliveryDisposition::retry_shared_slot_busy(),
            DeliveryDisposition::LeavePending(PendingRecoveryPolicy::Targeted {
                remaining_delay: Duration::ZERO,
            })
        );
    }

    #[test]
    fn deferred_job_recovery_waits_for_both_redis_idle_and_database_availability() {
        let received_at = Instant::now();
        let resolved_at = received_at + Duration::from_secs(2);

        assert_eq!(
            targeted_recovery_due_at(
                received_at,
                resolved_at,
                Duration::from_mins(1),
                Duration::from_secs(90),
            ),
            Some(resolved_at + Duration::from_secs(90))
        );
        assert_eq!(
            targeted_recovery_due_at(
                received_at,
                resolved_at,
                Duration::from_mins(1),
                Duration::from_secs(10),
            ),
            Some(received_at + Duration::from_mins(1))
        );
    }

    #[test]
    fn recovery_ack_cannot_pass_a_required_post_commit_effect() {
        let (sink, receiver) = PostCommitSink::channel();
        drop(receiver);

        let result = submit_control_outcome(
            &sink,
            ControlOutcome::new(
                ClaimResult::RecoveredCurrentJob,
                PostCommitEffects::WakeAnalysis,
            ),
        );

        assert!(matches!(result, Err(ConsumerError::PostCommitSink(_))));
    }

    #[tokio::test]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "filesystem cleanup evidence uses assertions while setup errors remain visible"
    )]
    async fn attempt_files_are_removed_when_control_plane_finalization_fails()
    -> Result<(), Box<dyn StdError>> {
        let root = tempfile::tempdir()?;
        let attempt_directory = root.path().join("analysis-attempt-test");
        tokio::fs::create_dir(&attempt_directory).await?;
        tokio::fs::write(attempt_directory.join("candidate.json"), b"candidate").await?;

        let result = cleanup_attempt_directory(
            &attempt_directory,
            Err::<(), _>(ConsumerError::DurationBound),
        )
        .await;

        assert!(matches!(result, Err(ConsumerError::DurationBound)));
        assert!(!attempt_directory.exists());
        Ok(())
    }
}
