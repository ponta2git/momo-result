use std::{path::Path, time::Instant};

use momo_analysis_core::contract::ArtifactManifest;
use tokio_postgres::{Client, Transaction};

use crate::{
    outbox::ControlOutcome, process::current_process_peak_resident_bytes,
    series_analysis::config::AnalysisConsumerConfig,
};

use super::{
    AttemptFailure, AttemptMetrics, ClaimedJob, ControlError, PublicationResult, ResultDisposition,
    TransactionEffects,
    lifecycle::{finish_terminal_failure, supersede},
    publication::{
        ExistingArtifact, discard_staged_artifact, existing_artifact, finish_success,
        publish_staged_artifact, requires_staging, stage_artifact, validate_staged_artifact,
        validated_manifest,
    },
    transaction::{bounded_transaction, lock_owned},
};

mod authoritative_input;

#[cfg(test)]
pub(super) use authoritative_input::validate_manifest as validate_authoritative_manifest;

/// Validates and atomically publishes a complete artifact for an owned attempt.
///
/// # Errors
///
/// Returns an error for invalid artifacts, stale ownership/revisions, nondeterministic output, or
/// a failed `PostgreSQL` publication transaction.
pub(crate) async fn publish(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    artifact_directory: &Path,
    metrics: &mut AttemptMetrics,
) -> Result<ControlOutcome<PublicationResult>, ControlError> {
    let (manifest, mut staged) =
        prepare_staging(client, claim, config, artifact_directory, metrics).await?;

    loop {
        // A commit error can mean that PostgreSQL committed and then closed the connection before
        // acknowledging it. Always begin B on a new connection after staging/reconciliation so a
        // durable staging artifact is not terminally failed merely because A's client is unusable.
        let mut publication_client = crate::postgres::connect(&config.database_url).await?;
        metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
        let publication_started = Instant::now();
        let transaction = bounded_transaction(
            &mut publication_client,
            config.execution_limits.finalization_timeout,
        )
        .await?;
        lock_owned(&transaction, claim, config).await?;
        let desired = desired_artifact(&transaction, claim).await?;
        if !desired.matches(claim) {
            transaction.rollback().await?;
            finish_publication_metrics(metrics, publication_started);
            return supersede(&mut publication_client, claim, config, metrics)
                .await
                .map(|outcome| outcome.map(|()| PublicationResult::Superseded));
        }
        validate_candidate(&transaction, claim, &manifest, staged).await?;
        match existing_artifact(
            &transaction,
            claim,
            &manifest,
            desired.current_artifact_id.as_deref(),
        )
        .await?
        {
            ExistingArtifact::DifferentVersion if !staged => {
                transaction.rollback().await?;
                finish_publication_metrics(metrics, publication_started);
                let retry_staging_started = Instant::now();
                let retry_staging = stage(
                    &mut publication_client,
                    claim,
                    config,
                    &manifest,
                    artifact_directory,
                )
                .await;
                staged = true;
                metrics.add_staging(retry_staging_started.elapsed());
                retry_staging?;
            }
            ExistingArtifact::DifferentVersion => {
                publish_staged_artifact(&transaction, claim, &manifest).await?;
                finish_publication_metrics(metrics, publication_started);
                return commit_successful_publication(
                    transaction,
                    claim,
                    config,
                    metrics,
                    &manifest.root_checksum,
                    ResultDisposition::Published,
                    PublicationResult::Published,
                )
                .await;
            }
            ExistingArtifact::Reusable => {
                if staged {
                    discard_staged_artifact(&transaction, claim, &manifest).await?;
                }
                finish_publication_metrics(metrics, publication_started);
                return commit_successful_publication(
                    transaction,
                    claim,
                    config,
                    metrics,
                    &manifest.root_checksum,
                    ResultDisposition::Reused,
                    PublicationResult::Reused,
                )
                .await;
            }
            ExistingArtifact::IntegrityFailure(failure_code) => {
                let mut effects = TransactionEffects::empty();
                finish_publication_metrics(metrics, publication_started);
                finish_terminal_failure(
                    &transaction,
                    claim,
                    config,
                    AttemptFailure::failed(failure_code),
                    metrics,
                    &mut effects,
                )
                .await?;
                return commit_publication(
                    transaction,
                    effects,
                    PublicationResult::IntegrityFailure(failure_code),
                )
                .await;
            }
        }
    }
}

async fn validate_candidate(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    staged: bool,
) -> Result<(), ControlError> {
    authoritative_input::validate_manifest(transaction, &claim.game_title_id, manifest).await?;
    if staged {
        validate_staged_artifact(transaction, claim, manifest).await?;
    }
    Ok(())
}

async fn commit_successful_publication(
    transaction: Transaction<'_>,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    metrics: &AttemptMetrics,
    output_checksum: &str,
    disposition: ResultDisposition,
    result: PublicationResult,
) -> Result<ControlOutcome<PublicationResult>, ControlError> {
    let mut effects = TransactionEffects::empty();
    finish_success(
        &transaction,
        claim,
        &config.worker_id,
        metrics,
        output_checksum,
        disposition,
        &mut effects,
    )
    .await?;
    commit_publication(transaction, effects, result).await
}

async fn commit_publication(
    transaction: Transaction<'_>,
    effects: TransactionEffects,
    result: PublicationResult,
) -> Result<ControlOutcome<PublicationResult>, ControlError> {
    transaction.commit().await?;
    Ok(effects.committed(result))
}

async fn prepare_staging(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    artifact_directory: &Path,
    metrics: &mut AttemptMetrics,
) -> Result<(ArtifactManifest, bool), ControlError> {
    let started = Instant::now();
    let manifest = validated_manifest(config, claim, artifact_directory).await?;
    validate_manifest_metrics(metrics, &manifest)?;
    let staged = requires_staging(client, claim).await?;
    let result = if staged {
        stage(client, claim, config, &manifest, artifact_directory).await
    } else {
        Ok(())
    };
    metrics.record_staging(started.elapsed());
    result?;
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    Ok((manifest, staged))
}

fn validate_manifest_metrics(
    metrics: &AttemptMetrics,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let artifact_chunk_count = i64::try_from(manifest.resources.len())?;
    let artifact_encoded_bytes = manifest
        .resources
        .iter()
        .try_fold(0_i64, |total, resource| {
            total
                .checked_add(i64::try_from(resource.common().encoded_bytes)?)
                .ok_or(ControlError::NumericBound)
        })?;
    validate_child_artifact_metrics(metrics, artifact_chunk_count, artifact_encoded_bytes)
}

struct DesiredArtifact {
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    current_artifact_id: Option<String>,
}

impl DesiredArtifact {
    fn matches(&self, claim: &ClaimedJob) -> bool {
        self.input_revision == claim.input_revision
            && self.algorithm_version == claim.algorithm_version
            && self.artifact_schema_version == claim.artifact_schema_version
    }
}

async fn desired_artifact(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
) -> Result<DesiredArtifact, ControlError> {
    let row = transaction
        .query_one(
            "SELECT input_revision, algorithm_version, artifact_schema_version, current_artifact_id\x20\
             FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&claim.game_title_id],
        )
        .await?;
    Ok(DesiredArtifact {
        input_revision: row.try_get(0)?,
        algorithm_version: row.try_get(1)?,
        artifact_schema_version: row.try_get(2)?,
        current_artifact_id: row.try_get(3)?,
    })
}

async fn stage(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    manifest: &ArtifactManifest,
    artifact_directory: &Path,
) -> Result<(), ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    stage_artifact(&transaction, claim, manifest, artifact_directory).await?;
    match transaction.commit().await {
        Ok(()) => Ok(()),
        Err(_ambiguous_commit) => {
            reconcile_staging(
                &config.database_url,
                config.execution_limits.finalization_timeout,
                claim,
                manifest,
                artifact_directory,
            )
            .await
        }
    }
}

pub(super) async fn reconcile_staging(
    database_url: &str,
    timeout: std::time::Duration,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    artifact_directory: &Path,
) -> Result<(), ControlError> {
    let mut client = crate::postgres::connect(database_url).await?;
    let transaction = bounded_transaction(&mut client, timeout).await?;
    if let Err(recovery_error) =
        stage_artifact(&transaction, claim, manifest, artifact_directory).await
    {
        let _rollback_result = transaction.rollback().await;
        return match verify_durable_staging(database_url, timeout, claim, manifest).await {
            Ok(()) => Ok(()),
            Err(_verification_error) => Err(recovery_error),
        };
    }
    match transaction.commit().await {
        Ok(()) => Ok(()),
        Err(commit_error) => {
            match verify_durable_staging(database_url, timeout, claim, manifest).await {
                Ok(()) => Ok(()),
                Err(_verification_error) => Err(ControlError::Postgres(commit_error)),
            }
        }
    }
}

async fn verify_durable_staging(
    database_url: &str,
    timeout: std::time::Duration,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
) -> Result<(), ControlError> {
    let mut verifier = crate::postgres::connect(database_url).await?;
    let verification = bounded_transaction(&mut verifier, timeout).await?;
    match validate_staged_artifact(&verification, claim, manifest).await {
        Ok(()) => {
            verification.rollback().await?;
            Ok(())
        }
        Err(error) => {
            let _rollback_result = verification.rollback().await;
            Err(error)
        }
    }
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
    metrics.add_publication(started.elapsed());
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
