//! Passive analysis lifecycle state and the typed claimed-attempt execution boundary.
use std::time::{Duration, Instant, SystemTime};

use thiserror::Error;
use tracing::{info, warn};

pub(crate) mod artifact;
pub(crate) mod bootstrap;
pub(crate) mod child;
mod child_process;
pub(crate) mod child_report;
pub(crate) mod config;
pub(crate) mod control;
pub(crate) mod endurance;
pub(crate) mod materialization;
pub(crate) mod release;

mod attempt;
mod attempt_directory;
mod campaign;
mod heartbeat;
mod input_repository;
mod job_transitions;
mod metrics;
mod policy;
mod radar_prepare;
mod runner;

pub(crate) use runner::Runner;

use self::{
    attempt_directory::cleanup_stale_attempt_directories,
    config::AnalysisConsumerConfig,
    control::{ControlError, IdleRefreshSchedule, mark_draining, register_capability},
};
use crate::{postgres::PostgresError, process::ProcessError, worker::PostCommitSinkClosed};

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
    #[error("analysis blocking work outlived its finalization deadline")]
    BlockingWorkUnfinished,
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
            Self::BlockingWorkUnfinished => "blocking_work_unfinished",
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
            Self::Shutdown => "shutdown",
            Self::OwnerLost => "owner_lost",
            Self::HeartbeatUncertain => "heartbeat_uncertain",
            Self::WorkerCrashed => "worker_crashed",
        }
    }
}

/// Owns idle maintenance and capability lifetime independently of an active attempt task.
/// Campaign/radar preparation uses the worker's control connection and remains runnable
/// while the attempt resources are temporarily owned by that task.
pub(crate) struct Module {
    config: AnalysisConsumerConfig,
    maintenance: MaintenanceSchedules,
    runner: Option<Runner>,
}

impl Module {
    pub(crate) const fn take_runner(&mut self) -> Option<Runner> {
        self.runner.take()
    }

    pub(crate) fn restore_runner(&mut self, runner: Runner) {
        self.runner = Some(runner);
    }

    /// Active attempts renew capability through their heartbeat. Idle maintenance resumes
    /// when their resources return, including any deadline that elapsed during calculation.
    pub(crate) fn maintenance_due_in(&self) -> Option<Duration> {
        self.runner
            .as_ref()
            .map(|_| self.maintenance.next_due_in(Instant::now()))
    }

    pub(crate) async fn maintain(&mut self) -> Result<(), ConsumerError> {
        if let Some(runner) = &mut self.runner {
            self.maintenance
                .run_due(&mut runner.control_client, &self.config)
                .await?;
        }
        Ok(())
    }

    /// Uses the lifecycle owner's connection, so an unwound attempt need not return its
    /// resources before this worker generation can be marked draining.
    #[expect(
        clippy::needless_pass_by_ref_mut,
        reason = "an exclusive module borrow keeps the drain future Send while runner resources are not Sync"
    )]
    pub(crate) async fn drain(
        &mut self,
        control_client: &tokio_postgres::Client,
    ) -> Result<(), ConsumerError> {
        control_operation(
            &self.config,
            mark_draining(control_client, &self.config.worker_id),
        )
        .await?;
        info!(event = "analysis_worker_drained", worker_id = %self.config.worker_id, "analysis worker drained");
        Ok(())
    }
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
