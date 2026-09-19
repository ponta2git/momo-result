use std::borrow::Cow;

use futures_util::TryStreamExt;
use momo_analysis_core::contract::{ArtifactManifest, ResourceManifest};
use tokio_postgres::{Row, Transaction};

use super::{ControlError, transaction::scope_columns};

#[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]
struct StagedResourceMetadata<'a> {
    kind: &'a str,
    scope_key: Cow<'a, str>,
    scope_kind: &'a str,
    season_master_id: Option<&'a str>,
    map_master_id: Option<&'a str>,
    member_id: Option<&'a str>,
    metric_id: Option<&'a str>,
    match_id: Option<&'a str>,
    source_match_revision: Option<i64>,
    encoded_bytes: i32,
    decoded_bytes: i32,
    item_count: i32,
    nesting_depth: i32,
    checksum: &'a str,
}

impl<'a> StagedResourceMetadata<'a> {
    fn from_manifest(resource: &'a ResourceManifest) -> Result<Self, ControlError> {
        let common = resource.common();
        let (scope_kind, season_master_id, map_master_id) = scope_columns(&common.scope);
        let (kind, member_id, metric_id, match_id, source_match_revision) = match resource {
            ResourceManifest::Aggregate { .. } => ("aggregate", None, None, None, None),
            ResourceManifest::Review { .. } => ("review", None, None, None, None),
            ResourceManifest::Drilldown {
                member_id,
                metric_id,
                ..
            } => (
                "drilldown",
                Some(member_id.as_str()),
                Some(metric_id.as_str()),
                None,
                None,
            ),
            ResourceManifest::MatchContext {
                match_id,
                source_match_revision,
                ..
            } => (
                "match_context",
                None,
                None,
                Some(match_id.as_str()),
                Some(source_match_revision.parse::<i64>()?),
            ),
        };
        Ok(Self {
            kind,
            scope_key: Cow::Owned(common.scope.key()),
            scope_kind,
            season_master_id,
            map_master_id,
            member_id,
            metric_id,
            match_id,
            source_match_revision,
            encoded_bytes: i32::try_from(common.encoded_bytes)?,
            decoded_bytes: i32::try_from(common.decoded_bytes)?,
            item_count: i32::try_from(common.item_count)?,
            nesting_depth: i32::try_from(common.nesting_depth)?,
            checksum: &common.checksum,
        })
    }

    fn from_row(row: &'a Row) -> Result<Self, ControlError> {
        Ok(Self {
            kind: row.try_get(0)?,
            scope_key: Cow::Borrowed(row.try_get(1)?),
            scope_kind: row.try_get(2)?,
            season_master_id: row.try_get(3)?,
            map_master_id: row.try_get(4)?,
            member_id: row.try_get(5)?,
            metric_id: row.try_get(6)?,
            match_id: row.try_get(7)?,
            source_match_revision: row.try_get(8)?,
            encoded_bytes: row.try_get(9)?,
            decoded_bytes: row.try_get(10)?,
            item_count: row.try_get(11)?,
            nesting_depth: row.try_get(12)?,
            checksum: row.try_get(13)?,
        })
    }
}

pub(super) async fn validate_staged_resource_metadata(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let mut expected = manifest
        .resources
        .iter()
        .map(StagedResourceMetadata::from_manifest)
        .collect::<Result<Vec<_>, _>>()?;
    expected.sort_unstable();
    expected.dedup();
    if expected.len() != manifest.resources.len() {
        return Err(ControlError::InvalidMetadata);
    }
    // Retain borrowed manifest metadata and visit each database row once. The bitmap also
    // distinguishes duplicate rows from a complete, order-independent match.
    let mut seen = vec![false; expected.len()];
    let rows = transaction
        .query_raw(
            "SELECT kind, scope_key, scope_kind, season_master_id, map_master_id, member_id,\x20\
                    metric_id, match_id, source_match_revision, encoded_bytes, decoded_bytes,\x20\
                    item_count, nesting_depth, checksum FROM (\x20\
               SELECT 'aggregate'::text AS kind, scope_key, scope_kind, season_master_id,\x20\
                      map_master_id, NULL::text AS member_id, NULL::text AS metric_id,\x20\
                      NULL::text AS match_id, NULL::bigint AS source_match_revision,\x20\
                      encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum\x20\
               FROM series_analysis_scope_aggregate_artifacts WHERE artifact_id = $1\x20\
               UNION ALL\x20\
               SELECT 'review', scope_key, scope_kind, season_master_id, map_master_id,\x20\
                      NULL::text, NULL::text, NULL::text, NULL::bigint, encoded_bytes,\x20\
                      decoded_bytes, item_count, nesting_depth, checksum\x20\
               FROM series_analysis_scope_review_artifacts WHERE artifact_id = $1\x20\
               UNION ALL\x20\
               SELECT 'drilldown', scope_key, scope_kind, season_master_id, map_master_id,\x20\
                      member_id, metric_id, NULL::text, NULL::bigint, encoded_bytes, decoded_bytes,\x20\
                      item_count, nesting_depth, checksum\x20\
               FROM series_analysis_drilldown_artifacts WHERE artifact_id = $1\x20\
               UNION ALL\x20\
               SELECT 'match_context', scope_key, scope_kind, season_master_id, map_master_id,\x20\
                      NULL::text, NULL::text, match_id, source_match_revision, encoded_bytes,\x20\
                      decoded_bytes, item_count, nesting_depth, checksum\x20\
               FROM series_analysis_match_context_artifacts WHERE artifact_id = $1\x20\
             ) resources",
            [&manifest.artifact_id],
        )
        .await?;
    tokio::pin!(rows);
    while let Some(row) = rows.try_next().await? {
        let metadata = StagedResourceMetadata::from_row(&row)?;
        let index = expected
            .binary_search(&metadata)
            .map_err(|_missing| ControlError::InvalidMetadata)?;
        let visited = seen.get_mut(index).ok_or(ControlError::InvalidMetadata)?;
        if std::mem::replace(visited, true) {
            return Err(ControlError::InvalidMetadata);
        }
    }
    if seen.into_iter().all(|visited| visited) {
        Ok(())
    } else {
        Err(ControlError::InvalidMetadata)
    }
}
