use std::collections::BTreeMap;

use futures_util::TryStreamExt;
use momo_analysis_core::model::MAXIMUM_PLAYER_MATCH_ROWS;
use tokio_postgres::{
    Row, Transaction,
    types::{Json, Type},
};

use super::{
    AnalysisIdentity, AnalysisSource, Artifact, MAXIMUM_ARTIFACT_BYTES, MAXIMUM_ARTIFACT_SEASONS,
    SkipReason, current_publication, database_error, valid_id,
};
use crate::notifications::analysis::types::MatchIdentity;

pub(super) struct ArtifactInput {
    pub(super) artifact: Artifact,
    pub(super) scope_counts: BTreeMap<Option<String>, usize>,
    expected_contexts: i32,
    actual_contexts: i64,
}

pub(super) async fn read(
    transaction: &Transaction<'_>,
    source: AnalysisSource<'_>,
    candidate_id: &str,
    baseline_id: Option<&str>,
) -> Result<BTreeMap<String, ArtifactInput>, SkipReason> {
    let mut ids = vec![candidate_id];
    if let Some(id) = baseline_id.filter(|id| *id != candidate_id) {
        ids.push(id);
    }
    let scope_limit =
        i64::try_from(MAXIMUM_ARTIFACT_SEASONS + 1).map_err(|_error| SkipReason::PayloadBound)?;
    let rows = transaction
        .query_typed(
            include_str!("header.sql"),
            &[
                (&ids, Type::TEXT_ARRAY),
                (&source.game_title_id, Type::TEXT),
                (&scope_limit, Type::INT8),
            ],
        )
        .await
        .map_err(database_error)?;
    let mut inputs = BTreeMap::new();
    for row in rows {
        let input = from_header(&row, candidate_id, baseline_id)?;
        if inputs
            .insert(input.artifact.identity.artifact_id.clone(), input)
            .is_some()
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    if inputs.len() != ids.len() {
        return Err(SkipReason::InvalidSnapshot);
    }
    let current = &inputs
        .get(candidate_id)
        .ok_or(SkipReason::InvalidSnapshot)?
        .artifact;
    if current.identity.input_revision != source.input_revision.to_string()
        || current.identity.algorithm_version != source.algorithm_version
        || current.identity.artifact_schema_version != source.artifact_schema_version
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    read_matches(transaction, &ids, &mut inputs).await?;
    for input in inputs.values() {
        if i64::from(input.expected_contexts) != input.actual_contexts
            || usize::try_from(input.expected_contexts) != Ok(input.artifact.matches.len() * 4)
        {
            return Err(SkipReason::InvalidSnapshot);
        }
        validate_input_counts(&input.scope_counts, &input.artifact.matches)?;
    }
    Ok(inputs)
}

fn from_header(
    row: &Row,
    candidate_id: &str,
    baseline_id: Option<&str>,
) -> Result<ArtifactInput, SkipReason> {
    let identity = AnalysisIdentity {
        artifact_id: row.try_get(0).map_err(database_error)?,
        input_revision: row.try_get(1).map_err(database_error)?,
        algorithm_version: row.try_get(2).map_err(database_error)?,
        artifact_schema_version: row.try_get(3).map_err(database_error)?,
        validation_contract_id: row.try_get(4).map_err(database_error)?,
    };
    // Preparation reads immutable inputs; fenced publication owns the staging transition.
    // A baseline must already have completed publication, including candidate reuse.
    let status: &str = row.try_get("status").map_err(database_error)?;
    if [&identity.artifact_id, &identity.algorithm_version]
        .into_iter()
        .any(|id| !valid_id(id))
        || identity.artifact_schema_version < 1
        || (identity.artifact_id == candidate_id && !current_publication(&identity))
        || !matches!(status, "staging" | "published")
        || (baseline_id == Some(identity.artifact_id.as_str()) && status != "published")
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    let count: i64 = row.try_get("scope_count").map_err(database_error)?;
    let bytes: i64 = row.try_get("payload_bytes").map_err(database_error)?;
    if !usize::try_from(count)
        .is_ok_and(|count| (1..=MAXIMUM_ARTIFACT_SEASONS + 1).contains(&count))
        || (current_publication(&identity) && bytes > MAXIMUM_ARTIFACT_BYTES)
    {
        return Err(SkipReason::PayloadBound);
    }
    let metadata: Json<Vec<(Option<String>, i32)>> =
        row.try_get("scope_metadata").map_err(database_error)?;
    let mut scope_counts = BTreeMap::new();
    for (season, rows) in metadata.0 {
        let rows = usize::try_from(rows).map_err(|_error| SkipReason::InvalidSnapshot)?;
        if season.as_ref().is_some_and(|id| !valid_id(id))
            || scope_counts.insert(season, rows).is_some()
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    if usize::try_from(count) != Ok(scope_counts.len()) {
        return Err(SkipReason::InvalidSnapshot);
    }
    Ok(ArtifactInput {
        artifact: Artifact {
            scopes: current_publication(&identity).then(BTreeMap::new),
            identity,
            matches: BTreeMap::new(),
        },
        scope_counts,
        expected_contexts: row
            .try_get("match_context_chunk_count")
            .map_err(database_error)?,
        actual_contexts: row
            .try_get("actual_match_context_count")
            .map_err(database_error)?,
    })
}

async fn read_matches(
    transaction: &Transaction<'_>,
    ids: &[&str],
    inputs: &mut BTreeMap<String, ArtifactInput>,
) -> Result<(), SkipReason> {
    let limit = i64::try_from(MAXIMUM_PLAYER_MATCH_ROWS / 4 + 1)
        .map_err(|_error| SkipReason::PayloadBound)?;
    let parameters: [(&(dyn tokio_postgres::types::ToSql + Sync), Type); 2] =
        [(&ids, Type::TEXT_ARRAY), (&limit, Type::INT8)];
    let rows = transaction
        .query_typed_raw(include_str!("matches.sql"), parameters)
        .await
        .map_err(database_error)?;
    tokio::pin!(rows);
    while let Some(row) = rows.try_next().await.map_err(database_error)? {
        let artifact_id: &str = row.try_get(0).map_err(database_error)?;
        let id: String = row.try_get(1).map_err(database_error)?;
        let identity = MatchIdentity {
            source_revision: row.try_get(2).map_err(database_error)?,
            season_id: row.try_get(3).map_err(database_error)?,
            map_id: row.try_get(4).map_err(database_error)?,
        };
        let matches = &mut inputs
            .get_mut(artifact_id)
            .ok_or(SkipReason::InvalidSnapshot)?
            .artifact
            .matches;
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
    Ok(())
}

// Aggregate item_count is the saved number of player input rows, independent of JSON format.
// Four player rows and four scope contexts per match reject incomplete input metadata.
pub(super) fn validate_input_counts(
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
