use std::path::Path;

use momo_analysis_core::{
    canonical::sha256_prefixed,
    contract::{ArtifactManifest, CommonResource, ResourceManifest},
};
use tokio_postgres::{Client, Transaction, binary_copy::BinaryCopyInWriter, types::Type};
use tracing::{error, info};

use crate::series_analysis::{
    artifact::validate_artifact_directory, config::AnalysisConsumerConfig,
};

use super::{
    AttemptMetrics, AttemptOutcome, ClaimedJob, ControlError, RequestOutcome, ResultDisposition,
    staging_metadata::validate_staged_resource_metadata,
    transaction::{
        artifact_id_for_attempt, finish_attempt, fulfill_requests, refresh_operation_projections,
        release_slot_by, schedule_follow_up, scope_columns,
    },
};

pub(super) fn validated_manifest(
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    artifact_directory: &Path,
) -> Result<ArtifactManifest, ControlError> {
    let limits = &config.execution_limits;
    let manifest = validate_artifact_directory(
        artifact_directory,
        limits.chunk_count_limit.get(),
        limits.chunk_bytes_limit.get(),
        limits.temporary_bytes_limit.get(),
        limits.temporary_file_count_limit.get(),
    )?;
    let manifest_revision = manifest.input_revision.parse::<i64>()?;
    let manifest_schema = i32::try_from(manifest.artifact_schema_version)?;
    if manifest.artifact_id != artifact_id_for_attempt(&claim.attempt_id)
        || manifest.game_title_id != claim.game_title_id
        || manifest_revision != claim.input_revision
        || manifest.algorithm_version != claim.algorithm_version
        || manifest_schema != claim.artifact_schema_version
    {
        return Err(ControlError::InvalidMetadata);
    }
    Ok(manifest)
}

pub(super) enum ExistingArtifact {
    DifferentVersion,
    Reusable,
    IntegrityFailure(super::SafeFailureCode),
}

pub(super) async fn requires_staging(
    client: &Client,
    claim: &ClaimedJob,
) -> Result<bool, ControlError> {
    let should_stage = client
        .query_one(
            "SELECT s.input_revision = $2 AND s.algorithm_version = $3\x20\
                    AND s.artifact_schema_version = $4 AND NOT EXISTS (\x20\
                      SELECT 1 FROM series_analysis_artifacts a\x20\
                      WHERE a.id = s.current_artifact_id AND a.status = 'published'\x20\
                        AND a.input_revision = $2 AND a.algorithm_version = $3\x20\
                        AND a.artifact_schema_version = $4\x20\
                    )\x20\
             FROM series_analysis_title_states s WHERE s.game_title_id = $1",
            &[
                &claim.game_title_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
            ],
        )
        .await?
        .try_get::<_, bool>(0)?;
    Ok(should_stage)
}

pub(super) async fn existing_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    current_artifact_id: Option<&str>,
) -> Result<ExistingArtifact, ControlError> {
    let Some(current_artifact_id) = current_artifact_id else {
        return Ok(ExistingArtifact::DifferentVersion);
    };
    let current = transaction
        .query_one(
            "SELECT input_revision, algorithm_version, artifact_schema_version,\x20\
                    source_input_checksum, root_checksum\x20\
             FROM series_analysis_artifacts WHERE id = $1 AND status = 'published'",
            &[&current_artifact_id],
        )
        .await?;
    let current_revision = current.try_get::<_, i64>(0)?;
    let current_algorithm = current.try_get::<_, String>(1)?;
    let current_schema = current.try_get::<_, i32>(2)?;
    let current_source_checksum = current.try_get::<_, String>(3)?;
    let current_root_checksum = current.try_get::<_, String>(4)?;
    let same_version = current_revision == claim.input_revision
        && current_algorithm == claim.algorithm_version
        && current_schema == claim.artifact_schema_version;
    if !same_version {
        return Ok(ExistingArtifact::DifferentVersion);
    }
    if current_source_checksum != manifest.source_input_checksum {
        return Ok(ExistingArtifact::IntegrityFailure(
            super::SafeFailureCode::InputRevisionViolation,
        ));
    }
    if current_root_checksum != manifest.root_checksum {
        return Ok(ExistingArtifact::IntegrityFailure(
            super::SafeFailureCode::NonDeterministicOutput,
        ));
    }
    Ok(ExistingArtifact::Reusable)
}

pub(super) async fn stage_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    artifact_directory: &Path,
) -> Result<(), ControlError> {
    let totals = artifact_totals(manifest)?;
    let inserted = insert_artifact_header(transaction, claim, manifest, &totals).await?;
    match inserted {
        1 => {}
        0 => replace_staged_artifact(transaction, claim, manifest, &totals).await?,
        _ => return Err(ControlError::PublicationRowCount),
    }
    copy_artifact_resources(transaction, manifest, artifact_directory, &totals).await?;
    validate_staged_artifact_shape(transaction, claim, manifest, &totals).await
}

pub(super) async fn validate_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let totals = artifact_totals(manifest)?;
    validate_staged_artifact_shape(transaction, claim, manifest, &totals).await
}

pub(super) async fn discard_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let deleted = transaction
        .execute(
            "DELETE FROM series_analysis_artifacts\x20\
             WHERE id = $1 AND attempt_id = $2 AND status = 'staging'",
            &[&manifest.artifact_id, &claim.attempt_id],
        )
        .await?;
    require_publication_row(deleted)
}

pub(super) async fn publish_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let published = transaction
        .execute(
            "UPDATE series_analysis_artifacts\x20\
             SET status = 'published', published_at = clock_timestamp()\x20\
             WHERE id = $1 AND attempt_id = $2 AND status = 'staging'",
            &[&manifest.artifact_id, &claim.attempt_id],
        )
        .await?;
    require_publication_row(published)?;
    let pointed = transaction
        .execute(
            "UPDATE series_analysis_title_states SET\x20\
               previous_artifact_id = CASE\x20\
                 WHEN current_artifact_id IS DISTINCT FROM $1 THEN current_artifact_id\x20\
                 ELSE previous_artifact_id END,\x20\
               current_artifact_id = $1, pending_work = false, pending_forced_run_count = 0,\x20\
               last_failure_code = NULL, last_failure_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE game_title_id = $2 AND input_revision = $3\x20\
               AND algorithm_version = $4 AND artifact_schema_version = $5",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
            ],
        )
        .await?;
    require_publication_row(pointed)
}

pub(super) async fn finish_success(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    worker_id: &str,
    metrics: &AttemptMetrics,
    output_checksum: &str,
    disposition: ResultDisposition,
) -> Result<(), ControlError> {
    let disposition = disposition.wire();
    finish_attempt(transaction, claim, AttemptOutcome::Succeeded, metrics).await?;
    let updated = transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               status = 'succeeded', finished_at = clock_timestamp(),\x20\
               result_disposition = $1, output_checksum = $2, safe_failure_code = NULL,\x20\
               elapsed_milliseconds = $3, lease_owner = NULL, lease_attempt_id = NULL,\x20\
               lease_fencing_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE id = $4 AND status = 'running' AND lease_owner = $5\x20\
               AND lease_attempt_id = $6 AND lease_fencing_token = $7\x20\
               AND lease_expires_at > clock_timestamp()",
            &[
                &disposition,
                &output_checksum,
                &metrics.elapsed_milliseconds,
                &claim.job_id,
                &worker_id,
                &claim.attempt_id,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(ControlError::OwnerLost);
    }
    transaction
        .execute(
            "UPDATE series_analysis_title_states SET\x20\
               pending_work = false, pending_forced_run_count = 0,\x20\
               last_failure_code = NULL, last_failure_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE game_title_id = $1",
            &[&claim.game_title_id],
        )
        .await?;
    fulfill_requests(transaction, claim, RequestOutcome::Succeeded).await?;
    schedule_follow_up(transaction, claim).await?;
    refresh_operation_projections(transaction, &claim.attempt_id).await?;
    release_slot_by(transaction, claim, worker_id).await?;
    Ok(())
}

async fn copy_artifact_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    totals: &ArtifactTotals,
) -> Result<(), ControlError> {
    copy_scope_resources(
        transaction,
        manifest,
        directory,
        ScopeResourceKind::Aggregate,
        totals.counts.aggregates,
    )
    .await?;
    copy_scope_resources(
        transaction,
        manifest,
        directory,
        ScopeResourceKind::Review,
        totals.counts.reviews,
    )
    .await?;
    copy_drilldown_resources(transaction, manifest, directory, totals.counts.drilldowns).await?;
    copy_match_context_resources(
        transaction,
        manifest,
        directory,
        totals.counts.match_contexts,
    )
    .await?;
    Ok(())
}

#[derive(Default)]
struct ArtifactCounts {
    aggregates: i32,
    reviews: i32,
    drilldowns: i32,
    match_contexts: i32,
}

impl ArtifactCounts {
    fn increment(&mut self, resource: &ResourceManifest) -> Result<(), ControlError> {
        let count = match resource {
            ResourceManifest::Aggregate { .. } => &mut self.aggregates,
            ResourceManifest::Review { .. } => &mut self.reviews,
            ResourceManifest::Drilldown { .. } => &mut self.drilldowns,
            ResourceManifest::MatchContext { .. } => &mut self.match_contexts,
        };
        *count = count.checked_add(1).ok_or(ControlError::NumericBound)?;
        Ok(())
    }
}

#[derive(Default)]
struct ArtifactTotals {
    counts: ArtifactCounts,
    encoded_bytes: i64,
    decoded_bytes: i64,
}

fn artifact_totals(manifest: &ArtifactManifest) -> Result<ArtifactTotals, ControlError> {
    manifest
        .resources
        .iter()
        .try_fold(ArtifactTotals::default(), |mut totals, resource| {
            totals.counts.increment(resource)?;
            let common = resource.common();
            let encoded = i64::try_from(common.encoded_bytes)?;
            let decoded = i64::try_from(common.decoded_bytes)?;
            totals.encoded_bytes = totals
                .encoded_bytes
                .checked_add(encoded)
                .ok_or(ControlError::NumericBound)?;
            totals.decoded_bytes = totals
                .decoded_bytes
                .checked_add(decoded)
                .ok_or(ControlError::NumericBound)?;
            Ok(totals)
        })
}

async fn insert_artifact_header(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    totals: &ArtifactTotals,
) -> Result<u64, ControlError> {
    Ok(transaction
        .execute(
            "INSERT INTO series_analysis_artifacts (\x20\
               id, game_title_id, attempt_id, input_revision, algorithm_version,\x20\
               artifact_schema_version, source_input_checksum, root_checksum, status,\x20\
               aggregate_chunk_count, review_chunk_count, drilldown_chunk_count,\x20\
               match_context_chunk_count, encoded_bytes, decoded_bytes\x20\
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'staging',$9,$10,$11,$12,$13,$14)\x20\
             ON CONFLICT (id) DO NOTHING",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &manifest.source_input_checksum,
                &manifest.root_checksum,
                &totals.counts.aggregates,
                &totals.counts.reviews,
                &totals.counts.drilldowns,
                &totals.counts.match_contexts,
                &totals.encoded_bytes,
                &totals.decoded_bytes,
            ],
        )
        .await?)
}

async fn replace_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    totals: &ArtifactTotals,
) -> Result<(), ControlError> {
    let deleted = transaction
        .execute(
            "DELETE FROM series_analysis_artifacts\x20\
             WHERE id = $1 AND game_title_id = $2 AND attempt_id = $3 AND status = 'staging'",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
            ],
        )
        .await?;
    require_publication_row(deleted)?;
    let inserted = insert_artifact_header(transaction, claim, manifest, totals).await?;
    require_publication_row(inserted)
}

async fn validate_staged_artifact_shape(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    totals: &ArtifactTotals,
) -> Result<(), ControlError> {
    let row = transaction
        .query_opt(
            "WITH child_shape AS (\x20\
               SELECT 'aggregate'::text AS kind, COUNT(*)::integer AS chunk_count,\x20\
                      COALESCE(SUM(encoded_bytes), 0)::bigint AS encoded_bytes,\x20\
                      COALESCE(SUM(decoded_bytes), 0)::bigint AS decoded_bytes\x20\
               FROM series_analysis_scope_aggregate_artifacts WHERE artifact_id = $1\x20\
               UNION ALL\x20\
               SELECT 'review', COUNT(*)::integer, COALESCE(SUM(encoded_bytes), 0)::bigint,\x20\
                      COALESCE(SUM(decoded_bytes), 0)::bigint\x20\
               FROM series_analysis_scope_review_artifacts WHERE artifact_id = $1\x20\
               UNION ALL\x20\
               SELECT 'drilldown', COUNT(*)::integer, COALESCE(SUM(encoded_bytes), 0)::bigint,\x20\
                      COALESCE(SUM(decoded_bytes), 0)::bigint\x20\
               FROM series_analysis_drilldown_artifacts WHERE artifact_id = $1\x20\
               UNION ALL\x20\
               SELECT 'match_context', COUNT(*)::integer,\x20\
                      COALESCE(SUM(encoded_bytes), 0)::bigint,\x20\
                      COALESCE(SUM(decoded_bytes), 0)::bigint\x20\
               FROM series_analysis_match_context_artifacts WHERE artifact_id = $1\x20\
             )\x20\
             SELECT a.game_title_id = $2 AND a.attempt_id = $3\x20\
                    AND a.input_revision = $4 AND a.algorithm_version = $5\x20\
                    AND a.artifact_schema_version = $6 AND a.source_input_checksum = $7\x20\
                    AND a.root_checksum = $8 AND a.status = 'staging'\x20\
                    AND a.aggregate_chunk_count = $9 AND a.review_chunk_count = $10\x20\
                    AND a.drilldown_chunk_count = $11 AND a.match_context_chunk_count = $12\x20\
                    AND a.encoded_bytes = $13 AND a.decoded_bytes = $14\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'aggregate') = $9\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'review') = $10\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'drilldown') = $11\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'match_context') = $12\x20\
                    AND (SELECT SUM(encoded_bytes) FROM child_shape) = $13\x20\
                    AND (SELECT SUM(decoded_bytes) FROM child_shape) = $14\x20\
             FROM series_analysis_artifacts a WHERE a.id = $1 FOR UPDATE OF a",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &manifest.source_input_checksum,
                &manifest.root_checksum,
                &totals.counts.aggregates,
                &totals.counts.reviews,
                &totals.counts.drilldowns,
                &totals.counts.match_contexts,
                &totals.encoded_bytes,
                &totals.decoded_bytes,
            ],
        )
        .await?;
    let Some(row) = row else {
        return Err(ControlError::InvalidMetadata);
    };
    let valid = row.try_get::<_, bool>(0)?;
    if valid {
        validate_staged_resource_metadata(transaction, manifest).await
    } else {
        Err(ControlError::InvalidMetadata)
    }
}

const fn require_publication_row(actual: u64) -> Result<(), ControlError> {
    if actual == 1 {
        Ok(())
    } else {
        Err(ControlError::PublicationRowCount)
    }
}

#[derive(Clone, Copy)]
enum ScopeResourceKind {
    Aggregate,
    Review,
}

impl ScopeResourceKind {
    const fn wire(self) -> &'static str {
        match self {
            Self::Aggregate => "aggregate",
            Self::Review => "review",
        }
    }

    const fn copy_statement(self) -> &'static str {
        match self {
            Self::Aggregate => {
                "COPY series_analysis_scope_aggregate_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
            Self::Review => {
                "COPY series_analysis_scope_review_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
        }
    }

    const fn common(self, resource: &ResourceManifest) -> Option<&CommonResource> {
        match (self, resource) {
            (Self::Aggregate, ResourceManifest::Aggregate { common })
            | (Self::Review, ResourceManifest::Review { common }) => Some(common),
            _ => None,
        }
    }
}

struct ResourceCopyRow<'a> {
    scope_key: String,
    scope_kind: &'static str,
    season_id: Option<&'a str>,
    map_id: Option<&'a str>,
    payload: Vec<u8>,
    encoded_bytes: i32,
    decoded_bytes: i32,
    item_count: i32,
    nesting_depth: i32,
    checksum: &'a str,
}

impl<'a> ResourceCopyRow<'a> {
    async fn load(directory: &Path, common: &'a CommonResource) -> Result<Self, ControlError> {
        let payload = tokio::fs::read(directory.join(&common.path)).await?;
        if u64::try_from(payload.len())? != common.encoded_bytes
            || sha256_prefixed(&payload) != common.checksum
        {
            return Err(ControlError::InvalidMetadata);
        }
        let (scope_kind, season_id, map_id) = scope_columns(&common.scope);
        Ok(Self {
            scope_key: common.scope.key(),
            scope_kind,
            season_id,
            map_id,
            payload,
            encoded_bytes: i32::try_from(common.encoded_bytes)?,
            decoded_bytes: i32::try_from(common.decoded_bytes)?,
            item_count: i32::try_from(common.item_count)?,
            nesting_depth: i32::try_from(common.nesting_depth)?,
            checksum: &common.checksum,
        })
    }
}

async fn copy_scope_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    kind: ScopeResourceKind,
    expected_count: i32,
) -> Result<(), ControlError> {
    if expected_count == 0 {
        return Ok(());
    }
    let resource_kind = kind.wire();
    let types = [
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let sink = transaction
        .copy_in(kind.copy_statement())
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let Some(common) = kind.common(resource) else {
            continue;
        };
        let row = ResourceCopyRow::load(directory, common)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        writer
            .as_mut()
            .write(&[
                &manifest.artifact_id,
                &row.scope_key,
                &row.scope_kind,
                &row.season_id,
                &row.map_id,
                &row.payload,
                &row.encoded_bytes,
                &row.decoded_bytes,
                &row.item_count,
                &row.nesting_depth,
                &row.checksum,
            ])
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
    let actual = writer
        .as_mut()
        .finish()
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    verify_copy_count(resource_kind, actual, expected_count)
}

async fn copy_drilldown_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    expected_count: i32,
) -> Result<(), ControlError> {
    if expected_count == 0 {
        return Ok(());
    }
    let types = [
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let resource_kind = "drilldown";
    let sink = transaction
        .copy_in(
            "COPY series_analysis_drilldown_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, member_id, metric_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY",
        )
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let ResourceManifest::Drilldown {
            common,
            member_id,
            metric_id,
        } = resource
        else {
            continue;
        };
        let row = ResourceCopyRow::load(directory, common)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        writer
            .as_mut()
            .write(&[
                &manifest.artifact_id,
                &row.scope_key,
                &row.scope_kind,
                &row.season_id,
                &row.map_id,
                member_id,
                metric_id,
                &row.payload,
                &row.encoded_bytes,
                &row.decoded_bytes,
                &row.item_count,
                &row.nesting_depth,
                &row.checksum,
            ])
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
    let actual = writer
        .as_mut()
        .finish()
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    verify_copy_count(resource_kind, actual, expected_count)
}

async fn copy_match_context_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    expected_count: i32,
) -> Result<(), ControlError> {
    if expected_count == 0 {
        return Ok(());
    }
    let types = [
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::INT8,
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let resource_kind = "match_context";
    let sink = transaction
        .copy_in(
            "COPY series_analysis_match_context_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, match_id, source_match_revision, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY",
        )
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let ResourceManifest::MatchContext {
            common,
            match_id,
            source_match_revision,
        } = resource
        else {
            continue;
        };
        let revision = source_match_revision.parse::<i64>()?;
        let row = ResourceCopyRow::load(directory, common)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        writer
            .as_mut()
            .write(&[
                &manifest.artifact_id,
                &row.scope_key,
                &row.scope_kind,
                &row.season_id,
                &row.map_id,
                match_id,
                &revision,
                &row.payload,
                &row.encoded_bytes,
                &row.decoded_bytes,
                &row.item_count,
                &row.nesting_depth,
                &row.checksum,
            ])
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
    let actual = writer
        .as_mut()
        .finish()
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    verify_copy_count(resource_kind, actual, expected_count)
}

fn verify_copy_count(
    resource_kind: &'static str,
    actual: u64,
    expected: i32,
) -> Result<(), ControlError> {
    if actual == u64::try_from(expected)? {
        info!(
            event = "analysis_artifact_copy_completed",
            phase = "publication_copy",
            resource_kind,
            row_count = actual,
            "analysis artifact resources were copied"
        );
        Ok(())
    } else {
        error!(
            event = "analysis_artifact_copy_failed",
            phase = "publication_copy",
            resource_kind,
            error_kind = "publication_row_count",
            expected_row_count = expected,
            actual_row_count = actual,
            "analysis artifact COPY row count was inconsistent"
        );
        Err(ControlError::PublicationRowCount)
    }
}

fn copy_failure(resource_kind: &'static str, failure: ControlError) -> ControlError {
    error!(
        event = "analysis_artifact_copy_failed",
        phase = "publication_copy",
        resource_kind,
        error_kind = failure.kind(),
        "analysis artifact COPY failed"
    );
    failure
}
