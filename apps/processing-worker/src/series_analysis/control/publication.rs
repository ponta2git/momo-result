use std::path::Path;

use momo_analysis_core::contract::{
    ARTIFACT_VALIDATION_CONTRACT_ID, ArtifactManifest, ResourceManifest,
};
use tokio_postgres::{Client, Transaction};

use crate::series_analysis::{
    artifact::{ValidatedArtifact, validate_artifact_directory},
    config::AnalysisConsumerConfig,
};

use super::{
    AttemptMetrics, AttemptOutcome, ClaimedJob, ControlError, RequestOutcome, ResultDisposition,
    TransactionEffects,
    staging_metadata::validate_staged_resource_metadata,
    transaction::{
        artifact_id_for_attempt, finish_attempt, fulfill_requests, refresh_operation_projections,
        release_slot_by, schedule_follow_up,
    },
};

mod resource_copy;

use resource_copy::copy_artifact_resources;

pub(super) async fn validated_artifact(
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    artifact_directory: &Path,
) -> Result<ValidatedArtifact, ControlError> {
    if !claim.accepts_current_validation_contract() {
        return Err(ControlError::UnsupportedValidationContract);
    }
    let limits = &config.execution_limits;
    let artifact_directory = artifact_directory.to_path_buf();
    let maximum_chunk_count = limits.chunk_count_limit.get();
    let maximum_chunk_bytes = limits.chunk_bytes_limit.get();
    let maximum_total_bytes = limits.temporary_bytes_limit.get();
    let maximum_file_count = limits.temporary_file_count_limit.get();
    let expected_artifact_id = artifact_id_for_attempt(&claim.attempt_id);
    let expected_game_title_id = claim.game_title_id.clone();
    let expected_input_revision = claim.input_revision;
    let expected_algorithm_version = claim.algorithm_version.clone();
    let expected_artifact_schema_version = claim.artifact_schema_version;
    // Validation performs bounded synchronous file reads and JSON decoding. Keeping that work off
    // the current-thread runtime lets the enclosing finalization timeout and sibling coordinators
    // continue. The task is read-only, so timeout cancellation cannot publish or mutate a candidate.
    tokio::task::spawn_blocking(move || {
        let artifact = validate_artifact_directory(
            &artifact_directory,
            maximum_chunk_count,
            maximum_chunk_bytes,
            maximum_total_bytes,
            maximum_file_count,
        )?;
        let manifest = artifact.manifest();
        let manifest_revision = manifest.input_revision.parse::<i64>()?;
        let manifest_schema = i32::try_from(manifest.artifact_schema_version)?;
        if manifest.artifact_id != expected_artifact_id
            || manifest.game_title_id != expected_game_title_id
            || manifest_revision != expected_input_revision
            || manifest.algorithm_version != expected_algorithm_version
            || manifest_schema != expected_artifact_schema_version
        {
            return Err(ControlError::InvalidMetadata);
        }
        Ok(artifact)
    })
    .await
    .map_err(ControlError::ArtifactValidationTask)?
}

pub(super) enum ExistingArtifact {
    DifferentVersion,
    Reusable,
    IntegrityFailure(super::SafeFailureCode),
}

pub(super) async fn requires_staging(
    client: &Client,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
) -> Result<bool, ControlError> {
    let should_stage = client
        .query_one(
            "SELECT s.input_revision = $2 AND s.algorithm_version = $3\x20\
                    AND s.artifact_schema_version = $4\x20\
                    AND s.validation_contract_id IS NOT DISTINCT FROM $5 AND NOT EXISTS (\x20\
                      SELECT 1 FROM series_analysis_artifacts a\x20\
                      WHERE a.id = s.current_artifact_id AND a.status = 'published'\x20\
                        AND a.input_revision = $2 AND a.algorithm_version = $3\x20\
                        AND a.artifact_schema_version = $4\x20\
                        AND a.validation_contract_id = $6\x20\
                    )\x20\
             FROM series_analysis_title_states s WHERE s.game_title_id = $1",
            &[
                &claim.game_title_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &claim.validation_contract_id,
                &artifact.validation_contract_id(),
            ],
        )
        .await?
        .try_get::<_, bool>(0)?;
    Ok(should_stage)
}

pub(super) async fn existing_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
    current_artifact_id: Option<&str>,
) -> Result<ExistingArtifact, ControlError> {
    let Some(current_artifact_id) = current_artifact_id else {
        return Ok(ExistingArtifact::DifferentVersion);
    };
    let current = transaction
        .query_one(
            "SELECT input_revision, algorithm_version, artifact_schema_version,\x20\
                    source_input_checksum, root_checksum, validation_contract_id\x20\
             FROM series_analysis_artifacts WHERE id = $1 AND status = 'published'",
            &[&current_artifact_id],
        )
        .await?;
    let current_revision = current.try_get::<_, i64>(0)?;
    let current_algorithm = current.try_get::<_, String>(1)?;
    let current_schema = current.try_get::<_, i32>(2)?;
    let current_source_checksum = current.try_get::<_, String>(3)?;
    let current_root_checksum = current.try_get::<_, String>(4)?;
    let current_validation_contract = current.try_get::<_, Option<String>>(5)?;
    let same_version = current_revision == claim.input_revision
        && current_algorithm == claim.algorithm_version
        && current_schema == claim.artifact_schema_version;
    if !same_version
        || current_validation_contract.as_deref() != Some(artifact.validation_contract_id())
    {
        return Ok(ExistingArtifact::DifferentVersion);
    }
    let manifest = artifact.manifest();
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
    artifact: &ValidatedArtifact,
    artifact_directory: &Path,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
    let totals = artifact_totals(manifest)?;
    let inserted = insert_artifact_header(transaction, claim, artifact, &totals).await?;
    match inserted {
        1 => {}
        0 => replace_staged_artifact(transaction, claim, artifact, &totals).await?,
        _ => return Err(ControlError::PublicationRowCount),
    }
    copy_artifact_resources(transaction, manifest, artifact_directory, &totals).await?;
    validate_staged_artifact_shape(transaction, claim, artifact, &totals, None).await?;
    attest_staged_artifact(transaction, claim, artifact).await
}

pub(super) async fn validate_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
) -> Result<(), ControlError> {
    lock_staged_artifact(transaction, claim, artifact).await?;
    let totals = artifact_totals(artifact.manifest())?;
    validate_staged_artifact_shape(
        transaction,
        claim,
        artifact,
        &totals,
        Some(artifact.validation_contract_id()),
    )
    .await
}

async fn attest_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
    let attested = transaction
        .execute(
            "UPDATE series_analysis_artifacts\x20\
             SET validation_contract_id = $4\x20\
             WHERE id = $1 AND game_title_id = $2 AND attempt_id = $3\x20\
               AND status = 'staging' AND validation_contract_id IS NULL",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
                &artifact.validation_contract_id(),
            ],
        )
        .await?;
    require_publication_row(attested)
}

async fn lock_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
    let locked = transaction
        .query_opt(
            "SELECT id FROM series_analysis_artifacts\x20\
             WHERE id = $1 AND game_title_id = $2 AND attempt_id = $3 AND status = 'staging'\x20\
               AND validation_contract_id = $4\x20\
             FOR UPDATE",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
                &artifact.validation_contract_id(),
            ],
        )
        .await?;
    if locked.is_some() {
        Ok(())
    } else {
        Err(ControlError::InvalidMetadata)
    }
}

pub(super) async fn discard_staged_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
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
    artifact: &ValidatedArtifact,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
    let published = transaction
        .execute(
            "UPDATE series_analysis_artifacts\x20\
             SET status = 'published', published_at = clock_timestamp()\x20\
             WHERE id = $1 AND attempt_id = $2 AND status = 'staging'\x20\
               AND validation_contract_id = $3",
            &[
                &manifest.artifact_id,
                &claim.attempt_id,
                &artifact.validation_contract_id(),
            ],
        )
        .await?;
    require_publication_row(published)?;
    let pointed = transaction
        .execute(
            "UPDATE series_analysis_title_states SET\x20\
               previous_artifact_id = CASE\x20\
                 WHEN current_artifact_id IS DISTINCT FROM $1 AND EXISTS (\x20\
                   SELECT 1 FROM series_analysis_artifacts previous\x20\
                   WHERE previous.id = current_artifact_id AND previous.status = 'published'\x20\
                     AND previous.validation_contract_id = $7\x20\
                 ) THEN current_artifact_id\x20\
                 WHEN current_artifact_id IS DISTINCT FROM $1 THEN NULL\x20\
                 ELSE previous_artifact_id END,\x20\
               current_artifact_id = $1, pending_work = false, pending_forced_run_count = 0,\x20\
               last_failure_code = NULL, last_failure_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE game_title_id = $2 AND input_revision = $3\x20\
               AND algorithm_version = $4 AND artifact_schema_version = $5\x20\
               AND validation_contract_id IS NOT DISTINCT FROM $6",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &claim.validation_contract_id,
                &artifact.validation_contract_id(),
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
    effects: &mut TransactionEffects,
) -> Result<(), ControlError> {
    let disposition = disposition.wire();
    finish_attempt(transaction, claim, AttemptOutcome::Succeeded, metrics).await?;
    let updated = transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               status = 'succeeded', finished_at = clock_timestamp(),\x20\
               result_disposition = $1, output_checksum = $2, safe_failure_code = NULL,\x20\
               elapsed_milliseconds = $3, lease_owner = NULL, lease_attempt_id = NULL,\x20\
               lease_fencing_token = NULL, lease_expires_at = NULL,\x20\
               lease_validation_contract_id = NULL, updated_at = clock_timestamp()\x20\
             WHERE id = $4 AND status = 'running' AND lease_owner = $5\x20\
               AND lease_attempt_id = $6 AND lease_fencing_token = $7\x20\
               AND lease_validation_contract_id IS NOT DISTINCT FROM $8\x20\
               AND lease_expires_at > clock_timestamp()",
            &[
                &disposition,
                &output_checksum,
                &metrics.elapsed_milliseconds,
                &claim.job_id,
                &worker_id,
                &claim.attempt_id,
                &claim.fencing_token,
                &claim.validation_contract_id,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(ControlError::OwnerLost);
    }
    // A legacy current artifact may become `previous` during the first attested publication.
    // Keep rollback data only when Rust proved it under the same exact contract; otherwise clear
    // the pointer so release audit cannot mistake an unverified v2 payload for a safe fallback.
    transaction
        .execute(
            "UPDATE series_analysis_title_states SET\x20\
               previous_artifact_id = CASE\x20\
                 WHEN EXISTS (\x20\
                   SELECT 1 FROM series_analysis_artifacts a\x20\
                   WHERE a.id = series_analysis_title_states.previous_artifact_id\x20\
                     AND a.status = 'published' AND a.validation_contract_id = $2\x20\
                 ) THEN previous_artifact_id ELSE NULL END,\x20\
               pending_work = false, pending_forced_run_count = 0,\x20\
               last_failure_code = NULL, last_failure_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE game_title_id = $1",
            &[&claim.game_title_id, &ARTIFACT_VALIDATION_CONTRACT_ID],
        )
        .await?;
    fulfill_requests(transaction, claim, RequestOutcome::Succeeded).await?;
    schedule_follow_up(transaction, claim, effects).await?;
    refresh_operation_projections(transaction, &claim.attempt_id).await?;
    release_slot_by(transaction, claim, worker_id).await?;
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
    artifact: &ValidatedArtifact,
    totals: &ArtifactTotals,
) -> Result<u64, ControlError> {
    let manifest = artifact.manifest();
    let validation_contract_id: Option<&str> = None;
    Ok(transaction
        .execute(
            "INSERT INTO series_analysis_artifacts (\x20\
               id, game_title_id, attempt_id, input_revision, algorithm_version,\x20\
               artifact_schema_version, validation_contract_id, source_input_checksum,\x20\
               root_checksum, status,\x20\
               aggregate_chunk_count, review_chunk_count, drilldown_chunk_count,\x20\
               match_context_chunk_count, encoded_bytes, decoded_bytes\x20\
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staging',$10,$11,$12,$13,$14,$15)\x20\
             ON CONFLICT (id) DO NOTHING",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &validation_contract_id,
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
    artifact: &ValidatedArtifact,
    totals: &ArtifactTotals,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
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
    let inserted = insert_artifact_header(transaction, claim, artifact, totals).await?;
    require_publication_row(inserted)
}

async fn validate_staged_artifact_shape(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
    totals: &ArtifactTotals,
    expected_validation_contract_id: Option<&str>,
) -> Result<(), ControlError> {
    let manifest = artifact.manifest();
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
                    AND a.artifact_schema_version = $6\x20\
                    AND a.validation_contract_id IS NOT DISTINCT FROM $7\x20\
                    AND a.source_input_checksum = $8 AND a.root_checksum = $9\x20\
                    AND a.status = 'staging'\x20\
                    AND a.aggregate_chunk_count = $10 AND a.review_chunk_count = $11\x20\
                    AND a.drilldown_chunk_count = $12 AND a.match_context_chunk_count = $13\x20\
                    AND a.encoded_bytes = $14 AND a.decoded_bytes = $15\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'aggregate') = $10\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'review') = $11\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'drilldown') = $12\x20\
                    AND (SELECT chunk_count FROM child_shape WHERE kind = 'match_context') = $13\x20\
                    AND (SELECT SUM(encoded_bytes) FROM child_shape) = $14\x20\
                    AND (SELECT SUM(decoded_bytes) FROM child_shape) = $15\x20\
             FROM series_analysis_artifacts a WHERE a.id = $1",
            &[
                &manifest.artifact_id,
                &claim.game_title_id,
                &claim.attempt_id,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &expected_validation_contract_id,
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
