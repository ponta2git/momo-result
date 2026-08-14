use std::{path::Path, time::Instant};

use tokio_postgres::Client;

use crate::process::current_process_peak_resident_bytes;
use crate::series_analysis::config::WorkerRuntimeConfig;

use super::{
    AttemptFailure, AttemptMetrics, ClaimedJob, ControlError, PublicationResult, ResultDisposition,
    lifecycle::{finish_terminal_failure, supersede},
    publication::{
        ExistingArtifact, existing_artifact, finish_success, publish_new_artifact,
        validated_manifest,
    },
    transaction::{bounded_transaction, lock_owned},
};

/// Validates and atomically publishes a complete artifact for an owned attempt.
///
/// # Errors
///
/// Returns an error for invalid artifacts, stale ownership/revisions, nondeterministic output, or
/// a failed `PostgreSQL` publication transaction.
pub(crate) async fn publish(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &WorkerRuntimeConfig,
    artifact_directory: &Path,
    metrics: &mut AttemptMetrics,
) -> Result<PublicationResult, ControlError> {
    let staging_started = Instant::now();
    let manifest = validated_manifest(config, claim, artifact_directory)?;
    metrics.record_staging(staging_started.elapsed());
    let artifact_chunk_count = i64::try_from(manifest.resources.len())?;
    let artifact_encoded_bytes = manifest
        .resources
        .iter()
        .try_fold(0_i64, |total, resource| {
            total
                .checked_add(i64::try_from(resource.common().encoded_bytes)?)
                .ok_or(ControlError::NumericBound)
        })?;
    validate_child_artifact_metrics(metrics, artifact_chunk_count, artifact_encoded_bytes)?;
    let publication_started = Instant::now();
    let transaction =
        bounded_transaction(client, config.publication_limits.finalization_timeout).await?;
    lock_owned(&transaction, claim, config).await?;
    let desired = transaction
        .query_one(
            "SELECT input_revision, algorithm_version, artifact_schema_version, current_artifact_id\x20\
             FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&claim.game_title_id],
        )
        .await?;
    let desired_revision = desired.try_get::<_, i64>(0)?;
    let desired_algorithm = desired.try_get::<_, String>(1)?;
    let desired_schema = desired.try_get::<_, i32>(2)?;
    if desired_revision != claim.input_revision
        || desired_algorithm != claim.algorithm_version
        || desired_schema != claim.artifact_schema_version
    {
        transaction.rollback().await?;
        finish_publication_metrics(metrics, publication_started);
        metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
        supersede(client, claim, config, metrics).await?;
        return Ok(PublicationResult::Superseded);
    }
    let current_artifact_id = desired.try_get::<_, Option<String>>(3)?;
    match existing_artifact(
        &transaction,
        claim,
        &manifest,
        current_artifact_id.as_deref(),
    )
    .await?
    {
        ExistingArtifact::DifferentVersion => {}
        ExistingArtifact::Reusable => {
            finish_publication_metrics(metrics, publication_started);
            metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
            finish_success(
                &transaction,
                claim,
                config,
                metrics,
                &manifest.root_checksum,
                ResultDisposition::Reused,
            )
            .await?;
            transaction.commit().await?;
            return Ok(PublicationResult::Reused);
        }
        ExistingArtifact::IntegrityFailure(failure_code) => {
            finish_publication_metrics(metrics, publication_started);
            metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
            finish_terminal_failure(
                &transaction,
                claim,
                config,
                AttemptFailure::failed(failure_code),
                metrics,
            )
            .await?;
            transaction.commit().await?;
            return Ok(PublicationResult::IntegrityFailure(failure_code));
        }
    }
    publish_new_artifact(
        &transaction,
        claim,
        config,
        &manifest,
        artifact_directory,
        metrics,
        publication_started,
    )
    .await?;
    transaction.commit().await?;
    Ok(PublicationResult::Published)
}

fn validate_child_artifact_metrics(
    metrics: &AttemptMetrics,
    artifact_chunk_count: i64,
    artifact_encoded_bytes: i64,
) -> Result<(), ControlError> {
    if metrics.artifact_chunk_count == Some(artifact_chunk_count)
        && metrics.artifact_encoded_bytes == Some(artifact_encoded_bytes)
    {
        Ok(())
    } else {
        Err(ControlError::ChildArtifactMetrics)
    }
}

fn finish_publication_metrics(metrics: &mut AttemptMetrics, started: Instant) {
    metrics.record_publication(started.elapsed());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_requires_child_metrics_to_match_the_validated_manifest() {
        let matching = AttemptMetrics {
            artifact_chunk_count: Some(42),
            artifact_encoded_bytes: Some(8_192),
            ..AttemptMetrics::default()
        };
        assert!(validate_child_artifact_metrics(&matching, 42, 8_192).is_ok());
        assert!(matches!(
            validate_child_artifact_metrics(&matching, 41, 8_192),
            Err(ControlError::ChildArtifactMetrics)
        ));
        assert!(matches!(
            validate_child_artifact_metrics(&matching, 42, 8_191),
            Err(ControlError::ChildArtifactMetrics)
        ));
        assert!(matches!(
            validate_child_artifact_metrics(&AttemptMetrics::default(), 0, 0),
            Err(ControlError::ChildArtifactMetrics)
        ));
    }
}
