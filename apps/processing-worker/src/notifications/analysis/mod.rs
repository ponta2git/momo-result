//! Compare published artifacts, then freeze display metadata at the final success boundary.

use std::{sync::Arc, time::Duration};

use tokio::time::{Instant, timeout};
use tokio_postgres::{Client, Transaction};

use super::{
    NotificationKind, NotificationReservation, NotificationSink, PreparedNotification, SkipReason,
    log_skip,
};
use types::Artifact;

mod artifacts;
mod comparison;
mod snapshot;
mod types;

const KIND: &str = NotificationKind::AnalysisCompleted.as_str();
// Conservative wire bound leaves room for JSONB whitespace and numeric expansion at receipt.
const MAXIMUM_SNAPSHOT_BYTES: i32 = 4 * 1024 * 1024;
const MAXIMUM_LISTED_MATCHES: usize = 1024;
const MAXIMUM_SEASONS: usize = 128;
const COMPARISON_TIMEOUT: Duration = Duration::from_secs(10);

/// Immutable job identity needed to freeze a notification; no lease, fence or runtime settings.
#[derive(Clone, Copy)]
pub(crate) struct AnalysisSource<'a> {
    pub(crate) job_id: &'a str,
    pub(crate) game_title_id: &'a str,
    pub(crate) input_revision: i64,
    pub(crate) algorithm_version: &'a str,
    pub(crate) artifact_schema_version: i32,
}

/// Owns the reserved capacity and immutable comparison until finalization. Reuse shares one
/// artifact between both sides. Preparation checks the final current pointer before freezing
/// metadata; only the caller's confirmed success COMMIT may authorize dispatch.
pub(crate) struct Comparison {
    reservation: NotificationReservation,
    previous: Option<Arc<Artifact>>,
    current: Arc<Artifact>,
    changes: comparison::Changes,
}

pub(crate) async fn load(
    sink: &NotificationSink,
    database_url: &str,
    source: AnalysisSource<'_>,
    candidate_id: &str,
    staged: bool,
    deadline: Instant,
) -> Option<(Client, Comparison)> {
    let started = Instant::now();
    let attempt = async {
        let reservation = sink.reserve(
            usize::try_from(MAXIMUM_SNAPSHOT_BYTES).map_err(|_error| SkipReason::PayloadBound)?,
        )?;
        let mut client = crate::postgres::connect(database_url)
            .await
            .map_err(|error| {
                tracing::warn!(event = "result_notification_connection_failed", kind = KIND,
                source_job_id = %source.job_id, error_kind = error.kind());
                SkipReason::PreparationFailed
            })?;
        let (previous, current) =
            artifacts::load(&mut client, source.game_title_id, candidate_id, staged).await?;
        if current.identity.input_revision != source.input_revision.to_string()
            || current.identity.algorithm_version != source.algorithm_version
            || current.identity.artifact_schema_version != source.artifact_schema_version
        {
            return Err(SkipReason::InvalidSnapshot);
        }
        let changes = comparison::changes(previous.as_deref(), &current)?;
        Ok((
            client,
            Comparison {
                reservation,
                previous,
                current,
                changes,
            },
        ))
    };
    // Connection setup and the complete MVCC read share this allowance. Keep most of the
    // parent deadline available for fenced publication, recovery and COMMIT.
    let budget = (deadline.saturating_duration_since(started) / 3).min(COMPARISON_TIMEOUT);
    match timeout(budget, attempt).await {
        Ok(Ok((client, comparison))) => {
            tracing::info!(
                event = "result_notification_comparison_ready",
                kind = KIND,
                source_job_id = %source.job_id,
                elapsed_milliseconds = started.elapsed().as_millis(),
                changed_match_count = comparison.changes.matches.len(),
            );
            // The read transaction committed successfully. Reuse this fresh connection for
            // publication; failed or timed-out reads never lend their connection to a writer.
            Some((client, comparison))
        }
        Ok(Err(reason)) => {
            log_skip(KIND, source.job_id, reason);
            None
        }
        Err(_error) => {
            tracing::warn!(event = "result_notification_comparison_timeout", kind = KIND,
                source_job_id = %source.job_id, budget_milliseconds = budget.as_millis(),
                elapsed_milliseconds = started.elapsed().as_millis());
            log_skip(KIND, source.job_id, SkipReason::ComparisonTimeout);
            None
        }
    }
}

impl Comparison {
    pub(crate) async fn prepare(
        self,
        transaction: &Transaction<'_>,
        source: AnalysisSource<'_>,
        previous_id: Option<&str>,
        reused: bool,
        deadline: Instant,
    ) -> Result<Option<PreparedNotification>, tokio_postgres::Error> {
        if previous_id
            != self
                .previous
                .as_ref()
                .map(|artifact| artifact.identity.artifact_id.as_str())
        {
            log_skip(KIND, source.job_id, SkipReason::InvalidSnapshot);
            return Ok(None);
        }
        super::preparation::recoverable(transaction, KIND, source.job_id, deadline, async {
            snapshot::prepare(transaction, source, self, reused).await
        })
        .await
    }
}
