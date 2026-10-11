//! Immutable resources are read before publication locks, from one cleanup-safe MVCC snapshot.

use std::collections::{BTreeMap, BTreeSet};

use futures_util::TryStreamExt;
use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use tokio_postgres::{Client, IsolationLevel, Transaction, types::Type};

use super::{
    AnalysisSource, SkipReason,
    comparison::{self, Changes},
    types::{AnalysisIdentity, Artifact, Baseline, BaselinePointer, RankSample, Ranks},
};
use inputs::ArtifactInput;

mod aggregate;
mod inputs;
pub(super) use aggregate::decode_ranks;

// Full comparison history can exceed the seasons affected by one notification.
const MAXIMUM_ARTIFACT_SEASONS: usize = 128;
const MAXIMUM_ARTIFACT_BYTES: i64 = 8 * 1024 * 1024;

pub(super) struct ComparedArtifacts {
    pub(super) previous: Baseline,
    pub(super) current: Artifact,
    pub(super) changes: Changes,
}

pub(super) async fn load(
    client: &mut Client,
    source: AnalysisSource<'_>,
    candidate_id: &str,
) -> Result<Option<ComparedArtifacts>, SkipReason> {
    let transaction = client
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(database_error)?;
    transaction
        .batch_execute("SET LOCAL statement_timeout = '1000ms'")
        .await
        .map_err(database_error)?;
    let row = transaction
        .query_typed_one(
            "SELECT notification_baseline_state, notification_baseline_artifact_id \
             FROM series_analysis_title_states WHERE game_title_id = $1",
            &[(&source.game_title_id, Type::TEXT)],
        )
        .await
        .map_err(database_error)?;
    let pointer = BaselinePointer::from_storage(
        row.try_get(0).map_err(database_error)?,
        row.try_get(1).map_err(database_error)?,
    )?;
    let baseline_id = match &pointer {
        BaselinePointer::Initial => None,
        BaselinePointer::Artifact(id) => Some(id.as_str()),
        BaselinePointer::Unknown => return Err(SkipReason::MissingBaseline),
    };
    let mut inputs = inputs::read(&transaction, source, candidate_id, baseline_id).await?;
    let previous_input = baseline_id
        .map(|id| inputs.get(id).ok_or(SkipReason::InvalidSnapshot))
        .transpose()?;
    let current_input = inputs
        .get(candidate_id)
        .ok_or(SkipReason::InvalidSnapshot)?;
    let changes = comparison::changes(
        previous_input.map(|input| &input.artifact),
        &current_input.artifact,
    )?;
    if changes.is_empty() {
        transaction.commit().await.map_err(database_error)?;
        return Ok(None);
    }

    // The current format is fully validated and attested before these immutable resources
    // become publication candidates. Complete relational metadata still checks input coverage;
    // only ranks that can appear in this notification need to be decoded again.
    read_ranks(&transaction, &mut inputs, &changes.seasons).await?;
    transaction.commit().await.map_err(database_error)?;
    let current = inputs
        .remove(candidate_id)
        .ok_or(SkipReason::InvalidSnapshot)?
        .artifact;
    let previous = match baseline_id {
        Some(id) => Baseline::Artifact(
            inputs
                .remove(id)
                .ok_or(SkipReason::InvalidSnapshot)?
                .artifact,
        ),
        None => Baseline::Initial,
    };
    Ok(Some(ComparedArtifacts {
        previous,
        current,
        changes,
    }))
}

async fn read_ranks(
    transaction: &Transaction<'_>,
    inputs: &mut BTreeMap<String, ArtifactInput>,
    seasons: &BTreeSet<String>,
) -> Result<(), SkipReason> {
    let ids: Vec<_> = inputs
        .iter()
        .filter(|(_, input)| input.artifact.scopes.is_some())
        .map(|(id, _)| id.clone())
        .collect();
    let selected_seasons: Vec<_> = seasons.iter().map(String::as_str).collect();
    let parameters: [(&(dyn tokio_postgres::types::ToSql + Sync), Type); 2] = [
        (&ids, Type::TEXT_ARRAY),
        (&selected_seasons, Type::TEXT_ARRAY),
    ];
    let rows = transaction
        .query_typed_raw(include_str!("artifacts/scopes.sql"), parameters)
        .await
        .map_err(database_error)?;
    tokio::pin!(rows);
    while let Some(row) = rows.try_next().await.map_err(database_error)? {
        let id: &str = row.try_get(0).map_err(database_error)?;
        let season: Option<String> = row.try_get(1).map_err(database_error)?;
        let payload: &[u8] = row.try_get(2).map_err(database_error)?;
        let scopes = inputs
            .get_mut(id)
            .and_then(|input| input.artifact.scopes.as_mut())
            .ok_or(SkipReason::InvalidSnapshot)?;
        if scopes.insert(season, decode_ranks(payload)?).is_some() {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    for input in inputs.values() {
        if let Some(scopes) = &input.artifact.scopes {
            validate_selected_scope_counts(scopes, &input.scope_counts, seasons)?;
        }
    }
    Ok(())
}

fn validate_selected_scope_counts(
    scopes: &BTreeMap<Option<String>, Ranks>,
    counts: &BTreeMap<Option<String>, usize>,
    seasons: &BTreeSet<String>,
) -> Result<(), SkipReason> {
    let selected = counts
        .keys()
        .filter(|season| season.as_ref().is_none_or(|id| seasons.contains(id)));
    if scopes.keys().ne(selected) {
        return Err(SkipReason::InvalidSnapshot);
    }
    for (season, samples) in scopes {
        let expected = counts.get(season).ok_or(SkipReason::InvalidSnapshot)? / 4;
        if (expected > 0 && samples.len() != 4)
            || samples
                .values()
                .any(|sample| usize::try_from(sample.match_count) != Ok(expected))
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    Ok(())
}

fn current_publication(identity: &AnalysisIdentity) -> bool {
    u32::try_from(identity.artifact_schema_version) == Ok(ARTIFACT_SCHEMA_VERSION)
        && identity.validation_contract_id.as_deref() == Some(ARTIFACT_VALIDATION_CONTRACT_ID)
}

const fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200
}
#[expect(
    clippy::needless_pass_by_value,
    reason = "map_err owns the driver error before discarding its sensitive detail"
)]
fn database_error(error: tokio_postgres::Error) -> SkipReason {
    tracing::warn!(
        event = "result_notification_database_failed",
        phase = "comparison",
        sqlstate = error.code().map(tokio_postgres::error::SqlState::code)
    );
    SkipReason::PreparationFailed
}

#[cfg(test)]
mod tests;
