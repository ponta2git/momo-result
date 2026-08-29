use std::time::Duration;

use momo_analysis_core::contract::ARTIFACT_VALIDATION_CONTRACT_ID;
use thiserror::Error;

use crate::outbox::{ControlOutcome, OutboxKind, PostCommitEffects};

pub(crate) const ALGORITHM_VERSION: &str = "series-analysis-v3";

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
    pub(crate) validation_contract_id: Option<String>,
    pub(crate) attempt_id: String,
    pub(crate) attempt_no: i32,
    pub(crate) fencing_token: i64,
}

impl ClaimedJob {
    /// Legacy jobs without a requested validator may be recalculated by the current validator,
    /// while a non-null request is an exact contract fence.
    #[must_use]
    pub(crate) fn accepts_current_validation_contract(&self) -> bool {
        self.validation_contract_id
            .as_deref()
            .is_none_or(|expected| expected == ARTIFACT_VALIDATION_CONTRACT_ID)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ClaimResult {
    Claimed(ClaimedJob),
    RecoveredCurrentJob,
    Busy,
    MissingOrTerminal,
    UnsupportedVersion(UnsupportedJobVersion),
    NotYetAvailable { remaining_delay: Duration },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UnsupportedJobVersion {
    pub(crate) algorithm_version: String,
    pub(crate) artifact_schema_version: i32,
    pub(crate) validation_contract_id: Option<String>,
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
    #[error("analysis artifact validation task failed")]
    ArtifactValidationTask(#[source] tokio::task::JoinError),
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
    #[error("authoritative analysis input violates its bounded structural contract")]
    AuthoritativeInputContract,
    #[error("analysis job requests an unsupported artifact validation contract")]
    UnsupportedValidationContract,
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
            Self::ArtifactValidationTask(_) => "artifact_validation_task",
            Self::NumericConversion(_) => "metadata_numeric_conversion",
            Self::NumericBound => "metadata_numeric_bound",
            Self::PublicationRowCount => "publication_row_count",
            Self::ChildArtifactMetrics => "child_artifact_metrics",
            Self::InvalidMetadata => "artifact_metadata",
            Self::MetadataParse(_) => "artifact_metadata_parse",
            Self::AuthoritativeInputContract => "authoritative_input_contract",
            Self::UnsupportedValidationContract => "unsupported_validation_contract",
        }
    }

    /// Returns whether a successful child produced a candidate that failed before publication.
    ///
    /// This classification is intentionally used only around `publish`: the same numeric error
    /// variants can describe control-plane corruption elsewhere, while every numeric conversion
    /// in that boundary derives from the already-decoded manifest and resource files.
    #[must_use]
    pub(crate) const fn is_artifact_candidate_failure(&self) -> bool {
        matches!(
            self,
            Self::Artifact(_)
                | Self::NumericConversion(_)
                | Self::NumericBound
                | Self::ChildArtifactMetrics
                | Self::InvalidMetadata
                | Self::MetadataParse(_)
        )
    }

    /// Returns whether candidate processing itself lost a trusted runtime boundary.
    ///
    /// Unlike malformed child output, these failures do not prove that the candidate is bad:
    /// `Io` occurs only while re-reading an already validated file for database staging, a join
    /// error means the blocking validator panicked or was cancelled, and an unsupported requested
    /// validator proves the durable claim changed outside the supported control path. The caller
    /// must retain the lease and delivery for recovery instead of persisting a business failure
    /// and `ACKing`.
    #[must_use]
    pub(crate) const fn is_candidate_processing_infrastructure_failure(&self) -> bool {
        matches!(
            self,
            Self::Io(_)
                | Self::ArtifactValidationTask(_)
                | Self::AuthoritativeInputContract
                | Self::UnsupportedValidationContract
        )
    }
}

impl From<crate::execution_slot::ExecutionSlotError> for ControlError {
    fn from(error: crate::execution_slot::ExecutionSlotError) -> Self {
        Self::ExecutionSlot(error.kind())
    }
}
