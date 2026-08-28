use std::collections::{BTreeMap, BTreeSet};

use momo_analysis_core::{
    contract::{ArtifactManifest, ResourceManifest, ScopeRef},
    model::{MAXIMUM_INPUT_ID_BYTES, MAXIMUM_PLAYER_MATCH_ROWS},
};
use tokio_postgres::{Row, Transaction};

use crate::series_analysis::control::ControlError;

const INPUT_SHAPE_QUERY: &str = r"SELECT
       COUNT(DISTINCT m.id)::bigint,
       COUNT(mp.member_id)::bigint,
       COALESCE(MAX(octet_length(m.id)), 0)::int,
       COALESCE(MAX(octet_length(m.season_master_id)), 0)::int,
       COALESCE(MAX(octet_length(m.map_master_id)), 0)::int,
       COALESCE(MAX(octet_length(mp.member_id)), 0)::int
     FROM matches m
     LEFT JOIN match_players mp ON mp.match_id = m.id
     WHERE m.game_title_id = $1";

const MATCH_SNAPSHOT_QUERY: &str = r"SELECT
       m.id, m.analysis_revision, m.season_master_id, m.map_master_id,
       COUNT(mp.member_id)::bigint
     FROM matches m
     LEFT JOIN match_players mp ON mp.match_id = m.id
     WHERE m.game_title_id = $1
     GROUP BY m.id, m.analysis_revision, m.season_master_id, m.map_master_id
     ORDER BY m.id
     LIMIT $2";

#[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]
struct ContextIdentity {
    scope: ScopeRef,
    match_id: String,
    source_match_revision: String,
    item_count: u64,
}

#[derive(Debug, Eq, PartialEq)]
struct ArtifactShape {
    aggregate_item_counts: BTreeMap<ScopeRef, u64>,
    contexts: BTreeSet<ContextIdentity>,
}

struct MatchSnapshot {
    match_id: String,
    source_match_revision: String,
    season_master_id: String,
    map_master_id: String,
    player_count: u64,
}

pub(in crate::series_analysis::control) async fn validate_manifest(
    transaction: &Transaction<'_>,
    game_title_id: &str,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let expected = load_expected_shape(transaction, game_title_id).await?;
    let candidate = candidate_shape(manifest)?;
    if candidate == expected {
        Ok(())
    } else {
        Err(ControlError::InvalidMetadata)
    }
}

async fn load_expected_shape(
    transaction: &Transaction<'_>,
    game_title_id: &str,
) -> Result<ArtifactShape, ControlError> {
    let shape = transaction
        .query_one(INPUT_SHAPE_QUERY, &[&game_title_id])
        .await?;
    let match_count = bounded_count(shape.try_get(0)?)?;
    let player_row_count = bounded_count(shape.try_get(1)?)?;
    if player_row_count > MAXIMUM_PLAYER_MATCH_ROWS || id_lengths_exceed_bound(&shape)? {
        return Err(ControlError::AuthoritativeInputContract);
    }

    let query_limit = i64::try_from(MAXIMUM_PLAYER_MATCH_ROWS)
        .map_err(|_error| ControlError::AuthoritativeInputContract)?
        .checked_add(1)
        .ok_or(ControlError::AuthoritativeInputContract)?;
    let rows = transaction
        .query(MATCH_SNAPSHOT_QUERY, &[&game_title_id, &query_limit])
        .await?;
    if rows.len() != match_count {
        return Err(ControlError::AuthoritativeInputContract);
    }
    expected_shape(
        rows.iter()
            .map(match_snapshot)
            .collect::<Result<Vec<_>, _>>()?,
    )
}

fn bounded_count(value: i64) -> Result<usize, ControlError> {
    usize::try_from(value)
        .ok()
        .filter(|count| *count <= MAXIMUM_PLAYER_MATCH_ROWS)
        .ok_or(ControlError::AuthoritativeInputContract)
}

fn id_lengths_exceed_bound(row: &Row) -> Result<bool, tokio_postgres::Error> {
    (2..=5)
        .map(|index| row.try_get::<_, i32>(index))
        .try_fold(false, |exceeded, length| {
            let length = length?;
            Ok(exceeded
                || usize::try_from(length).map_or(true, |length| length > MAXIMUM_INPUT_ID_BYTES))
        })
}

fn match_snapshot(row: &Row) -> Result<MatchSnapshot, ControlError> {
    let match_id = row.try_get::<_, String>(0)?;
    let revision = row.try_get::<_, i64>(1)?;
    let season_master_id = row.try_get::<_, String>(2)?;
    let map_master_id = row.try_get::<_, String>(3)?;
    let player_count = row.try_get::<_, i64>(4)?;
    if revision < 0
        || player_count != 4
        || [
            match_id.as_str(),
            season_master_id.as_str(),
            map_master_id.as_str(),
        ]
        .into_iter()
        .any(|id| id.is_empty() || id.len() > MAXIMUM_INPUT_ID_BYTES)
    {
        return Err(ControlError::AuthoritativeInputContract);
    }
    Ok(MatchSnapshot {
        match_id,
        source_match_revision: revision.to_string(),
        season_master_id,
        map_master_id,
        player_count: u64::try_from(player_count)
            .map_err(|_error| ControlError::AuthoritativeInputContract)?,
    })
}

fn expected_shape(matches: Vec<MatchSnapshot>) -> Result<ArtifactShape, ControlError> {
    let mut aggregate_item_counts = BTreeMap::from([(ScopeRef::Overall, 0_u64)]);
    let mut contexts = BTreeSet::new();
    for match_snapshot in matches {
        let scopes = [
            ScopeRef::Overall,
            ScopeRef::Season {
                season_master_id: match_snapshot.season_master_id.clone(),
            },
            ScopeRef::Map {
                map_master_id: match_snapshot.map_master_id.clone(),
            },
            ScopeRef::SeasonMap {
                season_master_id: match_snapshot.season_master_id.clone(),
                map_master_id: match_snapshot.map_master_id.clone(),
            },
        ];
        for scope in scopes {
            let item_count = aggregate_item_counts.entry(scope.clone()).or_default();
            *item_count = item_count
                .checked_add(match_snapshot.player_count)
                .ok_or(ControlError::AuthoritativeInputContract)?;
            if !contexts.insert(ContextIdentity {
                scope,
                match_id: match_snapshot.match_id.clone(),
                source_match_revision: match_snapshot.source_match_revision.clone(),
                item_count: match_snapshot.player_count,
            }) {
                return Err(ControlError::AuthoritativeInputContract);
            }
        }
    }
    Ok(ArtifactShape {
        aggregate_item_counts,
        contexts,
    })
}

fn candidate_shape(manifest: &ArtifactManifest) -> Result<ArtifactShape, ControlError> {
    let mut aggregate_item_counts = BTreeMap::new();
    let mut contexts = BTreeSet::new();
    for resource in &manifest.resources {
        match resource {
            ResourceManifest::Aggregate { common } => {
                if aggregate_item_counts
                    .insert(common.scope.clone(), common.item_count)
                    .is_some()
                {
                    return Err(ControlError::InvalidMetadata);
                }
            }
            ResourceManifest::MatchContext {
                common,
                match_id,
                source_match_revision,
            } => {
                if !contexts.insert(ContextIdentity {
                    scope: common.scope.clone(),
                    match_id: match_id.clone(),
                    source_match_revision: source_match_revision.clone(),
                    item_count: common.item_count,
                }) {
                    return Err(ControlError::InvalidMetadata);
                }
            }
            ResourceManifest::Review { .. } | ResourceManifest::Drilldown { .. } => {}
        }
    }
    Ok(ArtifactShape {
        aggregate_item_counts,
        contexts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use momo_analysis_core::contract::{CommonResource, MANIFEST_VERSION};

    fn common(scope: ScopeRef, item_count: u64) -> CommonResource {
        CommonResource {
            scope,
            item_key: String::from("fixture"),
            path: String::from("fixture.json"),
            encoded_bytes: 2,
            decoded_bytes: 2,
            item_count,
            nesting_depth: 1,
            checksum: format!("sha256:{}", "0".repeat(64)),
        }
    }

    fn manifest(resources: Vec<ResourceManifest>) -> ArtifactManifest {
        ArtifactManifest {
            manifest_version: MANIFEST_VERSION,
            artifact_id: String::from("artifact-fixture"),
            game_title_id: String::from("title-fixture"),
            input_revision: String::from("1"),
            algorithm_version: String::from("series-analysis-v3"),
            artifact_schema_version: 2,
            source_input_checksum: format!("sha256:{}", "0".repeat(64)),
            root_checksum: format!("sha256:{}", "0".repeat(64)),
            resources,
        }
    }

    fn one_match() -> MatchSnapshot {
        MatchSnapshot {
            match_id: String::from("match-1"),
            source_match_revision: String::from("7"),
            season_master_id: String::from("season-1"),
            map_master_id: String::from("map-1"),
            player_count: 4,
        }
    }

    #[test]
    fn exact_scope_counts_and_context_identities_match() {
        let expected = expected_shape(vec![one_match()]);
        assert!(expected.is_ok());
        let Some(expected) = expected.ok() else {
            return;
        };
        let scopes = [
            ScopeRef::Overall,
            ScopeRef::Season {
                season_master_id: String::from("season-1"),
            },
            ScopeRef::Map {
                map_master_id: String::from("map-1"),
            },
            ScopeRef::SeasonMap {
                season_master_id: String::from("season-1"),
                map_master_id: String::from("map-1"),
            },
        ];
        let mut resources = Vec::new();
        for scope in scopes {
            resources.push(ResourceManifest::Aggregate {
                common: common(scope.clone(), 4),
            });
            resources.push(ResourceManifest::MatchContext {
                common: common(scope, 4),
                match_id: String::from("match-1"),
                source_match_revision: String::from("7"),
            });
        }
        assert_eq!(candidate_shape(&manifest(resources)).ok(), Some(expected));
    }

    #[test]
    fn empty_input_still_requires_the_overall_aggregate() {
        let expected = expected_shape(Vec::new());
        assert!(expected.is_ok());
        let Some(expected) = expected.ok() else {
            return;
        };
        assert_ne!(
            candidate_shape(&manifest(Vec::new())).ok().as_ref(),
            Some(&expected)
        );
        let overall = ResourceManifest::Aggregate {
            common: common(ScopeRef::Overall, 0),
        };
        assert_eq!(
            candidate_shape(&manifest(vec![overall])).ok().as_ref(),
            Some(&expected)
        );
    }
}
