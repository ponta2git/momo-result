use std::{collections::HashSet, path::PathBuf};

use crate::{
    config::WorkerRuntimeConfig,
    control::{ClaimedJob, ControlError},
    process::available_filesystem_bytes,
};

use super::ConsumerError;

pub(super) async fn validate_temporary_root(
    config: &WorkerRuntimeConfig,
) -> Result<(), ConsumerError> {
    tokio::fs::create_dir_all(&config.temporary_root).await?;
    let metadata = tokio::fs::symlink_metadata(&config.temporary_root).await?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ConsumerError::TemporaryStorageBound);
    }
    if available_filesystem_bytes(&config.temporary_root)?
        < config.publication_limits.temporary_bytes_limit.get()
    {
        return Err(ConsumerError::TemporaryStorageBound);
    }
    Ok(())
}

pub(super) async fn cleanup_stale_attempt_directories(
    config: &WorkerRuntimeConfig,
    client: &tokio_postgres::Client,
) -> Result<(), ConsumerError> {
    let active_attempts = client
        .query(
            "SELECT attempt_id FROM worker_execution_slots\x20\
             WHERE attempt_id IS NOT NULL AND lease_expires_at > clock_timestamp()",
            &[],
        )
        .await
        .map_err(ControlError::Postgres)?
        .into_iter()
        .map(|row| row.try_get::<_, String>(0))
        .collect::<Result<HashSet<_>, _>>()
        .map_err(ControlError::Postgres)?;
    let minimum_age = config
        .lease_duration
        .checked_mul(2)
        .ok_or(ConsumerError::DurationBound)?;
    let mut entries = tokio::fs::read_dir(&config.temporary_root).await?;
    while let Some(entry) = entries.next_entry().await? {
        let Some(name) = entry.file_name().to_str().map(String::from) else {
            continue;
        };
        let Some(attempt_id) = name.strip_prefix("analysis-attempt-") else {
            continue;
        };
        let metadata = tokio::fs::symlink_metadata(entry.path()).await?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(ConsumerError::TemporaryStorageBound);
        }
        if active_attempts.contains(attempt_id) {
            continue;
        }
        let old_enough = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= minimum_age);
        if old_enough {
            tokio::fs::remove_dir_all(entry.path()).await?;
        }
    }
    Ok(())
}

pub(super) async fn create_attempt_directory(
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
) -> Result<PathBuf, ConsumerError> {
    if available_filesystem_bytes(&config.temporary_root)?
        < config.publication_limits.temporary_bytes_limit.get()
    {
        return Err(ConsumerError::TemporaryStorageBound);
    }
    let path = config
        .temporary_root
        .join(format!("analysis-attempt-{}", claim.attempt_id));
    tokio::fs::create_dir(&path).await?;
    Ok(path)
}
