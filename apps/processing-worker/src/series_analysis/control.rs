use std::time::Duration;

use thiserror::Error;

use crate::outbox::{ControlOutcome, OutboxKind, PostCommitEffects};

pub(crate) const ALGORITHM_VERSION: &str = "series-analysis-v2";

mod capability;
mod claim;
mod completion;
mod lifecycle;
mod publication;
mod recovery;
mod staging_metadata;
mod transaction;
mod vocabulary;

#[cfg(test)]
mod integration_tests;

pub(crate) use capability::{
    CAPABILITY_FRESH_SECONDS, IdleRefreshSchedule, mark_draining, register_capability,
};
pub(crate) use claim::claim_job;
pub(crate) use completion::publish;
pub(crate) use lifecycle::{
    finish_failure, heartbeat, requeue_interrupted, retry_transient_failure, supersede,
};
pub(crate) use recovery::recover_expired_analysis_holder;
pub(crate) use transaction::artifact_id_for_attempt;
pub(crate) use vocabulary::{AttemptFailure, RequeueCause, SafeFailureCode};

use vocabulary::{AttemptOutcome, DeliveryReason, RequestOutcome, ResultDisposition};

/// Outbox work made durable by the transaction currently in progress.
///
/// This value is deliberately distinct from [`PostCommitEffects`]: callers may convert it only
/// after `Transaction::commit` has confirmed success. Nested control operations union their work
/// here so a recovery or follow-up cannot be hidden by an outer state transition.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct TransactionEffects {
    series_analysis_wake: bool,
}

impl TransactionEffects {
    pub(super) const fn empty() -> Self {
        Self {
            series_analysis_wake: false,
        }
    }

    pub(super) const fn record_series_analysis(&mut self) {
        self.series_analysis_wake = true;
    }

    pub(super) const fn merge(&mut self, other: Self) {
        self.series_analysis_wake = self.series_analysis_wake || other.series_analysis_wake;
    }

    pub(crate) const fn committed<T>(self, value: T) -> ControlOutcome<T> {
        let effects = if self.series_analysis_wake {
            PostCommitEffects::wake(OutboxKind::SeriesAnalysis)
        } else {
            PostCommitEffects::empty()
        };
        ControlOutcome::new(value, effects)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ClaimedJob {
    pub(crate) job_id: String,
    pub(crate) game_title_id: String,
    pub(crate) input_revision: i64,
    pub(crate) algorithm_version: String,
    pub(crate) artifact_schema_version: i32,
    pub(crate) attempt_id: String,
    pub(crate) attempt_no: i32,
    pub(crate) fencing_token: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ClaimResult {
    Claimed(ClaimedJob),
    Busy,
    MissingOrTerminal,
    UnsupportedVersion(UnsupportedJobVersion),
    NotYetAvailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UnsupportedJobVersion {
    pub(crate) algorithm_version: String,
    pub(crate) artifact_schema_version: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HeartbeatResult {
    Continue,
    PreemptRequested,
    OwnerLost,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PublicationResult {
    Published,
    Reused,
    Superseded,
    IntegrityFailure(SafeFailureCode),
}

impl PublicationResult {
    #[must_use]
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::Published => "published",
            Self::Reused => "reused",
            Self::Superseded => "superseded",
            Self::IntegrityFailure(_) => "integrity_failure",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TransientRetryResult {
    Requeued,
    Exhausted,
}

impl TransientRetryResult {
    #[must_use]
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::Requeued => "requeued",
            Self::Exhausted => "exhausted",
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct AttemptMetrics {
    pub(crate) elapsed_milliseconds: i64,
    pub(crate) calculation_milliseconds: i64,
    pub(crate) staging_milliseconds: i64,
    pub(crate) publication_milliseconds: i64,
    pub(crate) child_peak_bytes: Option<i64>,
    pub(crate) worker_peak_bytes: Option<i64>,
    pub(crate) artifact_chunk_count: Option<i64>,
    pub(crate) artifact_encoded_bytes: Option<i64>,
    pub(crate) input_milliseconds: Option<i64>,
    pub(crate) kernel_milliseconds: Option<i64>,
    pub(crate) encoding_milliseconds: Option<i64>,
    pub(crate) input_row_count: Option<i64>,
}

impl AttemptMetrics {
    pub(crate) fn observe_worker_peak(&mut self, observed_bytes: Option<u64>) {
        let observed = observed_bytes.map(|bytes| i64::try_from(bytes).unwrap_or(i64::MAX));
        self.worker_peak_bytes = self.worker_peak_bytes.max(observed);
    }

    pub(crate) fn record_staging(&mut self, duration: Duration) {
        self.staging_milliseconds = signed_milliseconds(duration);
        self.refresh_elapsed();
    }

    pub(crate) fn add_staging(&mut self, duration: Duration) {
        self.staging_milliseconds = self
            .staging_milliseconds
            .saturating_add(signed_milliseconds(duration));
        self.refresh_elapsed();
    }

    pub(crate) fn add_publication(&mut self, duration: Duration) {
        self.publication_milliseconds = self
            .publication_milliseconds
            .saturating_add(signed_milliseconds(duration));
        self.refresh_elapsed();
    }

    pub(crate) fn record_finalization(&mut self, duration: Duration) {
        let finalization_milliseconds = signed_milliseconds(duration);
        self.publication_milliseconds = finalization_milliseconds
            .saturating_sub(self.staging_milliseconds)
            .max(0);
        self.refresh_elapsed();
    }

    const fn refresh_elapsed(&mut self) {
        self.elapsed_milliseconds = self
            .calculation_milliseconds
            .saturating_add(self.staging_milliseconds)
            .saturating_add(self.publication_milliseconds);
    }
}

fn signed_milliseconds(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

#[derive(Debug, Error)]
pub(crate) enum ControlError {
    #[error("analysis PostgreSQL state transition failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("analysis PostgreSQL connection failed")]
    PostgresConnection(#[from] crate::postgres::PostgresError),
    #[error("analysis shared execution-slot transition failed: {0}")]
    ExecutionSlot(&'static str),
    #[error("analysis worker lost its fencing ownership")]
    OwnerLost,
    #[error("analysis artifact file is invalid")]
    Artifact(#[from] crate::series_analysis::artifact::ArtifactError),
    #[error("analysis artifact file read failed")]
    Io(#[from] std::io::Error),
    #[error("analysis artifact metadata exceeds database bounds")]
    NumericConversion(#[from] std::num::TryFromIntError),
    #[error("analysis artifact metadata arithmetic exceeds database bounds")]
    NumericBound,
    #[error("analysis artifact publication wrote an unexpected row count")]
    PublicationRowCount,
    #[error("analysis child diagnostics disagree with the validated artifact")]
    ChildArtifactMetrics,
    #[error("analysis artifact contains invalid numeric metadata")]
    InvalidMetadata,
    #[error("analysis artifact contains unparseable numeric metadata")]
    MetadataParse(#[from] std::num::ParseIntError),
}

impl ControlError {
    #[must_use]
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Postgres(_) => "postgres_state_transition",
            Self::PostgresConnection(error) => error.kind(),
            Self::ExecutionSlot(kind) => kind,
            Self::OwnerLost => "fencing_owner_lost",
            Self::Artifact(_) => "artifact_validation",
            Self::Io(_) => "artifact_io",
            Self::NumericConversion(_) => "metadata_numeric_conversion",
            Self::NumericBound => "metadata_numeric_bound",
            Self::PublicationRowCount => "publication_row_count",
            Self::ChildArtifactMetrics => "child_artifact_metrics",
            Self::InvalidMetadata => "artifact_metadata",
            Self::MetadataParse(_) => "artifact_metadata_parse",
        }
    }
}

impl From<crate::execution_slot::ExecutionSlotError> for ControlError {
    fn from(error: crate::execution_slot::ExecutionSlotError) -> Self {
        Self::ExecutionSlot(error.kind())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attempt_metrics_include_staging_and_publication_in_elapsed_time() {
        let mut metrics = AttemptMetrics {
            calculation_milliseconds: 10,
            ..AttemptMetrics::default()
        };

        metrics.record_staging(Duration::from_millis(3));
        metrics.add_publication(Duration::from_millis(4));
        assert_eq!(metrics.elapsed_milliseconds, 17);

        metrics.record_finalization(Duration::from_millis(9));
        assert_eq!(metrics.staging_milliseconds, 3);
        assert_eq!(metrics.publication_milliseconds, 6);
        assert_eq!(metrics.elapsed_milliseconds, 19);
    }

    #[test]
    fn nested_transaction_effects_preserve_analysis_wakes() {
        let mut nested = TransactionEffects::empty();
        let mut child = TransactionEffects::empty();
        child.record_series_analysis();
        nested.merge(child);
        nested.merge(TransactionEffects::empty());
        let outcome = nested.committed(());

        assert!(
            outcome
                .effects
                .outbox_wakes
                .contains(OutboxKind::SeriesAnalysis)
        );
    }

    #[test]
    fn empty_transaction_effects_do_not_fabricate_a_wake() {
        let outcome = TransactionEffects::empty().committed(());

        assert!(outcome.effects.outbox_wakes.is_empty());
    }

    #[test]
    fn analysis_outbox_paths_share_one_transaction_accumulator_contract() {
        const CLAIM: &str = include_str!("control/claim.rs");
        const COMPLETION: &str = include_str!("control/completion.rs");
        const LIFECYCLE: &str = include_str!("control/lifecycle.rs");
        const PUBLICATION: &str = include_str!("control/publication.rs");
        const RECOVERY: &str = include_str!("control/recovery.rs");
        const TRANSACTION: &str = include_str!("control/transaction.rs");

        let enqueue_occurrences = [TRANSACTION, RECOVERY, LIFECYCLE]
            .into_iter()
            .map(|source| source.matches("enqueue_delivery(").count())
            .sum::<usize>();
        assert_eq!(
            enqueue_occurrences, 6,
            "update the post-commit architecture check when adding an enqueue path"
        );
        for (source, route) in [
            (TRANSACTION, "DeliveryReason::FollowUp"),
            (RECOVERY, "DeliveryReason::LeaseRecovery"),
            (LIFECYCLE, "DeliveryReason::Superseded"),
            (LIFECYCLE, "DeliveryReason::TransientRetry"),
            (LIFECYCLE, "cause.delivery_reason()"),
        ] {
            assert!(source.contains(route), "missing accumulated route {route}");
        }
        assert!(TRANSACTION.contains("effects: &mut TransactionEffects"));
        assert!(RECOVERY.contains("schedule_follow_up(transaction, &recovered_claim, effects)"));
        assert!(LIFECYCLE.contains("schedule_follow_up(transaction, claim, effects)"));
        assert!(PUBLICATION.contains("schedule_follow_up(transaction, claim, effects)"));

        assert_eq!(CLAIM.matches(") -> Result<ControlOutcome<").count(), 1);
        assert_eq!(COMPLETION.matches(") -> Result<ControlOutcome<").count(), 3);
        assert_eq!(LIFECYCLE.matches(") -> Result<ControlOutcome<").count(), 4);
        for nested in [TRANSACTION, RECOVERY, PUBLICATION] {
            assert!(
                !nested.contains("PostCommitEffects"),
                "nested transaction code converted effects before its outer commit"
            );
        }
    }
}
