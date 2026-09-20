//! Immutable resources are read before publication locks, from one cleanup-safe MVCC snapshot.

use std::{collections::BTreeMap, sync::Arc};

use futures_util::TryStreamExt;
use momo_analysis_core::{
    contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID},
    model::MAXIMUM_PLAYER_MATCH_ROWS,
};
use tokio_postgres::{Client, IsolationLevel, Transaction, types::Type};

use super::{
    MAXIMUM_SEASONS, SkipReason,
    types::{
        AnalysisIdentity, Artifact, Baseline, BaselinePointer, MatchIdentity, RankSample, Ranks,
    },
};

mod aggregate;
pub(super) use aggregate::decode_ranks;

const MAXIMUM_ARTIFACT_BYTES: i64 = 8 * 1024 * 1024;

pub(super) async fn load(
    client: &mut Client,
    title_id: &str,
    candidate_id: &str,
    staged: bool,
) -> Result<(Baseline, Arc<Artifact>), SkipReason> {
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
            "SELECT notification_baseline_state, notification_baseline_artifact_id, current_artifact_id \
             FROM series_analysis_title_states WHERE game_title_id = $1",
            &[(&title_id, Type::TEXT)],
        )
        .await
        .map_err(database_error)?;
    let pointer = BaselinePointer::from_storage(
        row.try_get(0).map_err(database_error)?,
        row.try_get(1).map_err(database_error)?,
    )?;
    let previous = match pointer {
        BaselinePointer::Initial => Baseline::Initial,
        BaselinePointer::Artifact(id) => {
            Baseline::Artifact(Arc::new(read(&transaction, title_id, &id, false).await?))
        }
        BaselinePointer::Unknown => return Err(SkipReason::MissingBaseline),
    };
    let current = if staged {
        Arc::new(read(&transaction, title_id, candidate_id, true).await?)
    } else {
        let current_id: Option<String> = row.try_get(2).map_err(database_error)?;
        let current_id = current_id.ok_or(SkipReason::InvalidSnapshot)?;
        // Publication reuse refers to the current public artifact, not the new manifest ID.
        // Share its immutable resources only when it is also the input comparison baseline.
        match &previous {
            Baseline::Artifact(artifact) if artifact.identity.artifact_id == current_id => {
                Arc::clone(artifact)
            }
            Baseline::Initial | Baseline::Artifact(_) => {
                Arc::new(read(&transaction, title_id, &current_id, false).await?)
            }
        }
    };
    if current.scopes.is_none() {
        return Err(SkipReason::InvalidSnapshot);
    }
    transaction.commit().await.map_err(database_error)?;
    Ok((previous, current))
}

async fn read(
    transaction: &Transaction<'_>,
    title_id: &str,
    artifact_id: &str,
    staged: bool,
) -> Result<Artifact, SkipReason> {
    let header = transaction
        .query_typed_one(
            include_str!("artifacts/header.sql"),
            &[(&artifact_id, Type::TEXT), (&title_id, Type::TEXT)],
        )
        .await
        .map_err(database_error)?;
    let identity = AnalysisIdentity {
        artifact_id: header.try_get(0).map_err(database_error)?,
        input_revision: header.try_get(1).map_err(database_error)?,
        algorithm_version: header.try_get(2).map_err(database_error)?,
        artifact_schema_version: header.try_get(3).map_err(database_error)?,
        validation_contract_id: header.try_get(4).map_err(database_error)?,
    };
    if [&identity.artifact_id, &identity.algorithm_version]
        .into_iter()
        .any(|id| !valid_id(id))
        || identity.artifact_schema_version < 1
        || (staged && !current_publication(&identity))
        || header
            .try_get::<_, &str>("status")
            .map_err(database_error)?
            != if staged { "staging" } else { "published" }
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    let count: i64 = header.try_get("scope_count").map_err(database_error)?;
    let bytes: i64 = header.try_get("payload_bytes").map_err(database_error)?;
    if !usize::try_from(count).is_ok_and(|count| (1..=MAXIMUM_SEASONS + 1).contains(&count))
        || (current_publication(&identity) && bytes > MAXIMUM_ARTIFACT_BYTES)
    {
        return Err(SkipReason::PayloadBound);
    }
    let matches = match_identities(transaction, artifact_id).await?;
    let contexts: i32 = header
        .try_get("match_context_chunk_count")
        .map_err(database_error)?;
    let actual_contexts: i64 = header
        .try_get("actual_match_context_count")
        .map_err(database_error)?;
    if i64::from(contexts) != actual_contexts || usize::try_from(contexts) != Ok(matches.len() * 4)
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    let scopes = if current_publication(&identity) {
        let scopes = read_ranks(transaction, artifact_id).await?;
        validate_scope_counts(&scopes, &matches)?;
        Some(scopes)
    } else {
        // Only the stable relational input metadata is read for older publication formats.
        let scope_counts = scope_metadata(transaction, artifact_id).await?;
        validate_input_counts(&scope_counts, &matches)?;
        None
    };
    Ok(Artifact {
        identity,
        scopes,
        matches,
    })
}

async fn read_ranks(
    transaction: &Transaction<'_>,
    artifact_id: &str,
) -> Result<BTreeMap<Option<String>, Ranks>, SkipReason> {
    let parameters: [(&(dyn tokio_postgres::types::ToSql + Sync), Type); 1] =
        [(&artifact_id, Type::TEXT)];
    let rows = transaction
        .query_typed_raw(include_str!("artifacts/scopes.sql"), parameters)
        .await
        .map_err(database_error)?;
    tokio::pin!(rows);
    let mut scopes = BTreeMap::new();
    while let Some(row) = rows.try_next().await.map_err(database_error)? {
        let season: Option<String> = row.try_get(0).map_err(database_error)?;
        let payload: &[u8] = row.try_get(1).map_err(database_error)?;
        if scopes.insert(season, decode_ranks(payload)?).is_some() {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    Ok(scopes)
}

async fn scope_metadata(
    transaction: &Transaction<'_>,
    artifact_id: &str,
) -> Result<BTreeMap<Option<String>, usize>, SkipReason> {
    let rows = transaction
        .query_typed(
            "SELECT left(season_master_id, 201), item_count \
         FROM series_analysis_scope_aggregate_artifacts \
         WHERE artifact_id = $1 AND scope_kind IN ('overall', 'season')",
            &[(&artifact_id, Type::TEXT)],
        )
        .await
        .map_err(database_error)?;
    let mut scopes = BTreeMap::new();
    for row in rows {
        let season: Option<String> = row.try_get(0).map_err(database_error)?;
        let count: i32 = row.try_get(1).map_err(database_error)?;
        let count = usize::try_from(count).map_err(|_error| SkipReason::InvalidSnapshot)?;
        if season.as_ref().is_some_and(|id| !valid_id(id)) || scopes.insert(season, count).is_some()
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    Ok(scopes)
}

// Aggregate item_count is the saved number of player input rows, independent of JSON format.
// Four player rows and four scope contexts per match let us reject incomplete input metadata.
fn validate_input_counts(
    scopes: &BTreeMap<Option<String>, usize>,
    matches: &BTreeMap<String, MatchIdentity>,
) -> Result<(), SkipReason> {
    let mut season_counts = BTreeMap::new();
    for identity in matches.values() {
        *season_counts
            .entry(identity.season_id.as_str())
            .or_insert(0_usize) += 4;
    }
    for (season, count) in scopes {
        let expected = season.as_ref().map_or(matches.len() * 4, |id| {
            season_counts.remove(id.as_str()).unwrap_or_default()
        });
        if *count != expected {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    if !scopes.contains_key(&None) || !season_counts.is_empty() {
        return Err(SkipReason::InvalidSnapshot);
    }
    Ok(())
}

// Count each match once, regardless of the number of seasons. Remaining entries identify
// missing aggregates, including seasons whose matches could otherwise disappear silently.
fn validate_scope_counts(
    scopes: &BTreeMap<Option<String>, Ranks>,
    matches: &BTreeMap<String, MatchIdentity>,
) -> Result<(), SkipReason> {
    let mut season_counts = BTreeMap::new();
    for identity in matches.values() {
        *season_counts
            .entry(identity.season_id.as_str())
            .or_insert(0_usize) += 1;
    }
    for (season, samples) in scopes {
        let expected_count = season.as_ref().map_or(matches.len(), |id| {
            season_counts.remove(id.as_str()).unwrap_or_default()
        });
        if (expected_count > 0 && samples.len() != 4)
            || samples
                .values()
                .any(|sample| usize::try_from(sample.match_count) != Ok(expected_count))
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    if !scopes.contains_key(&None) || !season_counts.is_empty() {
        return Err(SkipReason::InvalidSnapshot);
    }
    Ok(())
}

async fn match_identities(
    transaction: &Transaction<'_>,
    artifact_id: &str,
) -> Result<BTreeMap<String, MatchIdentity>, SkipReason> {
    let limit = i64::try_from(MAXIMUM_PLAYER_MATCH_ROWS / 4 + 1)
        .map_err(|_error| SkipReason::PayloadBound)?;
    let parameters: [(&(dyn tokio_postgres::types::ToSql + Sync), Type); 2] =
        [(&artifact_id, Type::TEXT), (&limit, Type::INT8)];
    let rows = transaction.query_typed_raw(
        "SELECT left(match_id, 201), source_match_revision::text, left(season_master_id, 201), left(map_master_id, 201) \
         FROM series_analysis_match_context_artifacts WHERE artifact_id = $1 AND scope_kind = 'season_map' \
         ORDER BY match_id LIMIT $2", parameters,
    ).await.map_err(database_error)?;
    tokio::pin!(rows);
    let mut matches = BTreeMap::new();
    while let Some(row) = rows.try_next().await.map_err(database_error)? {
        let id: String = row.try_get(0).map_err(database_error)?;
        let identity = MatchIdentity {
            source_revision: row.try_get(1).map_err(database_error)?,
            season_id: row.try_get(2).map_err(database_error)?,
            map_id: row.try_get(3).map_err(database_error)?,
        };
        if [&id, &identity.season_id, &identity.map_id]
            .into_iter()
            .any(|id| !valid_id(id))
            || matches.insert(id, identity).is_some()
        {
            return Err(SkipReason::InvalidSnapshot);
        }
        if matches.len() > MAXIMUM_PLAYER_MATCH_ROWS / 4 {
            return Err(SkipReason::PayloadBound);
        }
    }
    Ok(matches)
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
