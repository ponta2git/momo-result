//! Immutable resources are read before publication locks, from one cleanup-safe MVCC snapshot.

use std::collections::BTreeMap;

use futures_util::TryStreamExt;
use momo_analysis_core::model::MAXIMUM_PLAYER_MATCH_ROWS;
use tokio_postgres::{Client, IsolationLevel, Transaction};

use super::{
    SkipReason,
    comparison::decode_ranks,
    types::{AnalysisIdentity, Artifact, MatchIdentity},
};

const MAXIMUM_ARTIFACT_BYTES: i64 = 8 * 1024 * 1024;
pub(super) const MAXIMUM_SEASONS: usize = 128;

pub(super) async fn load(
    client: &mut Client,
    title_id: &str,
    candidate_id: &str,
    staged: bool,
) -> Result<(Option<Artifact>, Artifact), SkipReason> {
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
        .query_one(
            "SELECT current_artifact_id FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&title_id],
        )
        .await
        .map_err(database_error)?;
    let previous_id: Option<String> = row.try_get(0).map_err(database_error)?;
    let previous = if let Some(id) = previous_id {
        Some(read(&transaction, title_id, &id).await?)
    } else {
        None
    };
    let current = if staged {
        read(&transaction, title_id, candidate_id).await?
    } else {
        previous.clone().ok_or(SkipReason::InvalidSnapshot)?
    };
    transaction.commit().await.map_err(database_error)?;
    Ok((previous, current))
}

async fn read(
    transaction: &Transaction<'_>,
    title_id: &str,
    artifact_id: &str,
) -> Result<Artifact, SkipReason> {
    let header = transaction.query_one(
        "SELECT left(id, 201), input_revision::text, left(algorithm_version, 201), artifact_schema_version, \
         left(validation_contract_id, 201) FROM series_analysis_artifacts WHERE id = $1 AND game_title_id = $2",
        &[&artifact_id, &title_id],
    ).await.map_err(database_error)?;
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
        || identity
            .validation_contract_id
            .as_ref()
            .is_some_and(|id| !valid_id(id))
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    let size = transaction.query_one(
        "SELECT count(*)::bigint, COALESCE(sum(octet_length(payload)), 0)::bigint \
         FROM series_analysis_scope_aggregate_artifacts WHERE artifact_id = $1 AND scope_kind IN ('overall','season')",
        &[&artifact_id],
    ).await.map_err(database_error)?;
    let count: i64 = size.try_get(0).map_err(database_error)?;
    let bytes: i64 = size.try_get(1).map_err(database_error)?;
    if !(1..=129).contains(&count) || bytes > MAXIMUM_ARTIFACT_BYTES {
        return Err(SkipReason::PayloadBound);
    }
    let rows = transaction.query_raw(
        "SELECT left(season_master_id, 201), payload FROM series_analysis_scope_aggregate_artifacts \
         WHERE artifact_id = $1 AND scope_kind IN ('overall','season') ORDER BY scope_key",
        [&artifact_id],
    ).await.map_err(database_error)?;
    tokio::pin!(rows);
    let mut scopes = BTreeMap::new();
    while let Some(row) = rows.try_next().await.map_err(database_error)? {
        let season: Option<String> = row.try_get(0).map_err(database_error)?;
        if season.as_ref().is_some_and(|id| !valid_id(id)) {
            return Err(SkipReason::InvalidSnapshot);
        }
        let payload: &[u8] = row.try_get(1).map_err(database_error)?;
        let ranks = decode_ranks(payload)?;
        if scopes.insert(season, ranks).is_some() {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    if !scopes.contains_key(&None) {
        return Err(SkipReason::InvalidSnapshot);
    }
    let matches = match_identities(transaction, artifact_id).await?;
    for (season, samples) in &scopes {
        let expected_count = matches
            .values()
            .filter(|m| season.as_ref().is_none_or(|id| *id == m.season_id))
            .count();
        if (expected_count > 0 && samples.len() != 4)
            || samples
                .values()
                .any(|sample| usize::try_from(sample.match_count) != Ok(expected_count))
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    if matches
        .values()
        .any(|m| !scopes.contains_key(&Some(m.season_id.clone())))
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    Ok(Artifact {
        identity,
        scopes,
        matches,
    })
}

async fn match_identities(
    transaction: &Transaction<'_>,
    artifact_id: &str,
) -> Result<BTreeMap<String, MatchIdentity>, SkipReason> {
    let limit = i64::try_from(MAXIMUM_PLAYER_MATCH_ROWS / 4 + 1)
        .map_err(|_error| SkipReason::PayloadBound)?;
    let parameters: [&(dyn tokio_postgres::types::ToSql + Sync); 2] = [&artifact_id, &limit];
    let rows = transaction.query_raw(
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

const fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200
}
fn database_error(_error: tokio_postgres::Error) -> SkipReason {
    SkipReason::PreparationFailed
}
