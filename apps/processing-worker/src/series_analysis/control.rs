use std::time::Duration;

use thiserror::Error;

use crate::database::DatabaseError;

pub(crate) const ALGORITHM_VERSION: &str = "series-analysis-v2";

mod capability;
mod claim;
mod completion;
mod lifecycle;
mod publication;
mod recovery;
mod transaction;
mod vocabulary;

pub(crate) use capability::{mark_draining, register_capability};
pub(crate) use claim::claim_job;
pub(crate) use completion::publish;
pub(crate) use lifecycle::{
    finish_failure, heartbeat, requeue_interrupted, retry_transient_failure, supersede,
};
pub(crate) use recovery::recover_expired_analysis_holder;
pub(crate) use transaction::artifact_id_for_attempt;
pub(crate) use vocabulary::{AttemptFailure, RequeueCause, SafeFailureCode};

use vocabulary::{AttemptOutcome, DeliveryReason, RequestOutcome, ResultDisposition};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ClaimedJob {
    pub job_id: String,
    pub game_title_id: String,
    pub input_revision: i64,
    pub algorithm_version: String,
    pub artifact_schema_version: i32,
    pub attempt_id: String,
    pub attempt_no: i32,
    pub fencing_token: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ClaimResult {
    Claimed(ClaimedJob),
    Busy,
    MissingOrTerminal,
    UnsupportedVersion(UnsupportedJobVersion),
    NotReady,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UnsupportedJobVersion {
    pub algorithm_version: String,
    pub artifact_schema_version: i32,
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
    pub elapsed_milliseconds: i64,
    pub calculation_milliseconds: i64,
    pub staging_milliseconds: i64,
    pub publication_milliseconds: i64,
    pub child_peak_bytes: Option<i64>,
    pub worker_peak_bytes: Option<i64>,
    pub artifact_chunk_count: Option<i64>,
    pub artifact_encoded_bytes: Option<i64>,
    pub input_milliseconds: Option<i64>,
    pub kernel_milliseconds: Option<i64>,
    pub encoding_milliseconds: Option<i64>,
    pub input_row_count: Option<i64>,
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

    pub(crate) fn record_publication(&mut self, duration: Duration) {
        self.publication_milliseconds = signed_milliseconds(duration);
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
pub enum ControlError {
    #[error("analysis database operation failed")]
    Database(#[from] DatabaseError),
    #[error("analysis PostgreSQL state transition failed")]
    Postgres(#[from] tokio_postgres::Error),
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
            Self::Database(error) => error.kind(),
            Self::Postgres(_) => "postgres_state_transition",
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
    fn staged_attempt_metrics_preserve_total_time_instead_of_child_time_only() {
        let mut metrics = AttemptMetrics {
            calculation_milliseconds: 10,
            ..AttemptMetrics::default()
        };

        metrics.record_staging(Duration::from_millis(3));
        metrics.record_publication(Duration::from_millis(4));
        assert_eq!(metrics.elapsed_milliseconds, 17);

        metrics.record_finalization(Duration::from_millis(9));
        assert_eq!(metrics.staging_milliseconds, 3);
        assert_eq!(metrics.publication_milliseconds, 6);
        assert_eq!(metrics.elapsed_milliseconds, 19);
    }
}
