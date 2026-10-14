use std::time::{Duration, Instant, SystemTime};

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
pub(crate) mod materialization;
pub(crate) mod release;

use crate::{
    postgres::{self, PostgresError},
    process::ProcessError,
    scheduler::{ControlOutcome, PostCommitSink, PostCommitSinkClosed},
};

use self::{
    config::AnalysisConsumerConfig,
    control::{
        AttemptFailure, ControlError, IdleRefreshSchedule, SafeFailureCode, finish_failure,
        mark_draining, register_capability,
    },
};

mod attempt;
mod attempt_directory;
mod campaign;
mod heartbeat;
mod input_repository;
mod radar_prepare;
use heartbeat::HeartbeatConnection;
mod metrics;
mod policy;

use attempt::{child_spec, finish_attempt_result, run_claimed_child};
use attempt_directory::{
    cleanup_stale_attempt_directories, create_attempt_directory, validate_temporary_root,
};
use metrics::{PhaseTimer, elapsed_metrics, measure};

#[derive(Debug, Error)]
pub(crate) enum ConsumerError {
    #[error("analysis control database connection failed")]
    Database(#[from] PostgresError),
    #[error("analysis control-plane transition failed")]
    Control(#[from] ControlError),
    #[error("analysis control-plane operation exceeded its deadline")]
    ControlTimeout,
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
enum AttemptResult {
    Completed,
    OwnershipUncertain,
    Stopped,
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
        // the bounded scheduler cadence avoids both a permanent startup skip and a hot poll.
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
/// durable database transition is not rolled back and the durable state remains recoverable.
pub(crate) struct Runner {
    control_client: postgres::ConnectedClient,
    heartbeat_client: HeartbeatConnection,
    config: AnalysisConsumerConfig,
    maintenance: MaintenanceSchedules,
    post_commit_sink: PostCommitSink,
}

impl Runner {
    pub(crate) async fn new(
        config: AnalysisConsumerConfig,
        post_commit_sink: PostCommitSink,
    ) -> Result<Self, ConsumerError> {
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
        let control_client = startup_result(
            postgres::connect(&config.database_url).await,
            "control_database_connect",
        )?;
        let heartbeat_client = startup_result(
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

        info!(event = "analysis_worker_ready", worker_id = %config.worker_id, "analysis worker is ready");
        Ok(Self {
            control_client,
            heartbeat_client,
            config,
            maintenance,
            post_commit_sink,
        })
    }

    pub(crate) fn maintenance_due_in(&self) -> Duration {
        self.maintenance.next_due_in(Instant::now())
    }

    pub(crate) async fn maintain(&mut self) -> Result<(), ConsumerError> {
        self.maintenance
            .run_due(&mut self.control_client, &self.config)
            .await
    }

    pub(crate) async fn execute(
        &mut self,
        claim: control::ClaimedJob,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), ConsumerError> {
        let span = info_span!(
            "analysis_attempt",
            worker_id = %self.config.worker_id,
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
            let result = execute_claimed_job(
                &mut self.control_client,
                &mut self.heartbeat_client,
                &self.config,
                &self.post_commit_sink,
                &claim,
                &mut shutdown,
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
            result.map(|_| ())
        }
        .instrument(span)
        .await
    }

    pub(crate) async fn drain(self) -> Result<(), ConsumerError> {
        finish_consumer(&self.control_client, &self.config, Ok(())).await
    }
}

async fn finish_consumer(
    control_client: &tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    result: Result<(), ConsumerError>,
) -> Result<(), ConsumerError> {
    if let Err(error) = &result {
        error!(
            event = "analysis_worker_runtime_failed",
            phase = "execution_loop",
            error_kind = error.kind(),
            "analysis worker execution loop stopped unexpectedly"
        );
    }
    // A failed claim can leave a response unread. Draining is best-effort after failure and
    // must not keep the consumer alive indefinitely on that same connection.
    let draining = mark_draining(control_client, &config.worker_id);
    if let Err(error) = control_operation(config, draining).await {
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

async fn control_operation<T>(
    config: &AnalysisConsumerConfig,
    operation: impl Future<Output = Result<T, ControlError>>,
) -> Result<T, ConsumerError> {
    tokio::time::timeout(config.control_response_timeout(), operation)
        .await
        .map_err(|_elapsed| ConsumerError::ControlTimeout)?
        .map_err(ConsumerError::Control)
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

fn submit_control_outcome<T>(
    sink: &PostCommitSink,
    outcome: ControlOutcome<T>,
) -> Result<T, ConsumerError> {
    sink.submit(outcome.effects)?;
    Ok(outcome.value)
}

async fn execute_claimed_job(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut HeartbeatConnection,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    claim: &control::ClaimedJob,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<AttemptResult, ConsumerError> {
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
            return Ok(AttemptResult::Completed);
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
