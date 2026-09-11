//! Compare published artifacts, then freeze display metadata at the final success boundary.

use std::time::Duration;

use tokio::time::{Instant, timeout};
use tokio_postgres::Transaction;

use super::{
    NotificationReservation, NotificationSink, PreparedNotification, SkipReason, log_skip,
};
use crate::series_analysis::control::ClaimedJob;
use types::Artifact;

mod artifacts;
mod comparison;
mod snapshot;
mod types;

const KIND: &str = "analysis_completed";
// Conservative wire bound leaves room for JSONB whitespace and numeric expansion at receipt.
const MAXIMUM_SNAPSHOT_BYTES: usize = 4 * 1024 * 1024;
const MAXIMUM_LISTED_MATCHES: usize = 1024;

pub(crate) struct Comparison {
    reservation: NotificationReservation,
    previous: Option<Artifact>,
    current: Artifact,
    changes: comparison::Changes,
}

pub(crate) async fn load(
    sink: &NotificationSink,
    database_url: &str,
    claim: &ClaimedJob,
    candidate_id: &str,
    staged: bool,
    deadline: Instant,
) -> Option<Comparison> {
    let attempt = async {
        let reservation = sink.reserve(MAXIMUM_SNAPSHOT_BYTES)?;
        let mut client = crate::postgres::connect(database_url)
            .await
            .map_err(|_error| SkipReason::PreparationFailed)?;
        let (previous, current) =
            artifacts::load(&mut client, &claim.game_title_id, candidate_id, staged).await?;
        if current.identity.input_revision != claim.input_revision.to_string()
            || current.identity.algorithm_version != claim.algorithm_version
            || current.identity.artifact_schema_version != claim.artifact_schema_version
        {
            return Err(SkipReason::InvalidSnapshot);
        }
        let changes = comparison::changes(previous.as_ref(), &current);
        if changes.matches.len() > MAXIMUM_LISTED_MATCHES
            || changes.seasons.len() > artifacts::MAXIMUM_SEASONS
        {
            return Err(SkipReason::PayloadBound);
        }
        Ok(Comparison {
            reservation,
            previous,
            current,
            changes,
        })
    };
    let budget =
        (deadline.saturating_duration_since(Instant::now()) / 4).min(Duration::from_secs(1));
    match timeout(budget, attempt).await {
        Ok(Ok(comparison)) => Some(comparison),
        Ok(Err(reason)) => {
            log_skip(KIND, &claim.job_id, reason);
            None
        }
        Err(_error) => {
            log_skip(KIND, &claim.job_id, SkipReason::FinalizationBudget);
            None
        }
    }
}

impl Comparison {
    pub(crate) async fn prepare(
        self,
        transaction: &Transaction<'_>,
        claim: &ClaimedJob,
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
            log_skip(KIND, &claim.job_id, SkipReason::InvalidSnapshot);
            return Ok(None);
        }
        super::preparation::recoverable(transaction, KIND, &claim.job_id, deadline, async {
            snapshot::prepare(transaction, claim, self, reused).await
        })
        .await
    }
}
