use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use crate::process::available_filesystem_bytes;

use super::{
    ConsumerError,
    config::AnalysisConsumerConfig,
    control::{ClaimedJob, ControlError},
};

pub(super) async fn validate_temporary_root(
    config: &AnalysisConsumerConfig,
) -> Result<(), ConsumerError> {
    tokio::fs::create_dir_all(&config.temporary_root).await?;
    let metadata = tokio::fs::symlink_metadata(&config.temporary_root).await?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ConsumerError::TemporaryStorageBound);
    }
    if available_filesystem_bytes(&config.temporary_root)?
        < config.execution_limits.temporary_bytes_limit.get()
    {
        return Err(ConsumerError::TemporaryStorageBound);
    }
    Ok(())
}

pub(super) async fn cleanup_stale_attempt_directories(
    config: &AnalysisConsumerConfig,
    client: &tokio_postgres::Client,
) -> Result<Option<Instant>, ConsumerError> {
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
    cleanup_attempt_directories(
        &config.temporary_root,
        &active_attempts,
        minimum_age,
        config.lease_duration,
    )
    .await
}

async fn cleanup_attempt_directories(
    temporary_root: &Path,
    active_attempts: &HashSet<String>,
    minimum_age: Duration,
    active_recheck_interval: Duration,
) -> Result<Option<Instant>, ConsumerError> {
    let scan_started = Instant::now();
    let mut next_cleanup_at = None;
    let mut saw_active_attempt = false;
    let mut entries = tokio::fs::read_dir(temporary_root).await?;
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
            // Active is a lease snapshot, not a permanent exemption. Re-read authoritative lease
            // state at one lease interval so a later release or expiry eventually exposes residue.
            saw_active_attempt = true;
            continue;
        }
        let modified = metadata.modified()?;
        let remaining = match modified.elapsed() {
            Ok(age) if age >= minimum_age => {
                tokio::fs::remove_dir_all(entry.path()).await?;
                continue;
            }
            Ok(age) => minimum_age.saturating_sub(age),
            Err(future_modified) => minimum_age
                .checked_add(future_modified.duration())
                .ok_or(ConsumerError::DurationBound)?,
        };
        let due_at = scan_started
            .checked_add(remaining)
            .ok_or(ConsumerError::DurationBound)?;
        if next_cleanup_at.is_none_or(|scheduled| due_at < scheduled) {
            next_cleanup_at = Some(due_at);
        }
    }
    if saw_active_attempt {
        let due_at = Instant::now()
            .checked_add(active_recheck_interval)
            .ok_or(ConsumerError::DurationBound)?;
        if next_cleanup_at.is_none_or(|scheduled| due_at < scheduled) {
            next_cleanup_at = Some(due_at);
        }
    }
    Ok(next_cleanup_at)
}

pub(super) async fn create_attempt_directory(
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
) -> Result<PathBuf, ConsumerError> {
    if available_filesystem_bytes(&config.temporary_root)?
        < config.execution_limits.temporary_bytes_limit.get()
    {
        return Err(ConsumerError::TemporaryStorageBound);
    }
    let path = config
        .temporary_root
        .join(format!("analysis-attempt-{}", claim.attempt_id));
    tokio::fs::create_dir(&path).await?;
    Ok(path)
}

#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    reason = "filesystem recovery assertions keep failures attached to the isolated temporary root"
)]
mod tests {
    use std::error::Error;

    use tempfile::TempDir;

    use super::*;

    #[tokio::test]
    async fn young_stale_directory_is_revisited_once_due_without_touching_active_work()
    -> Result<(), Box<dyn Error>> {
        let root = TempDir::new()?;
        let stale = root.path().join("analysis-attempt-stale");
        let active = root.path().join("analysis-attempt-active");
        tokio::fs::create_dir(&stale).await?;
        tokio::fs::create_dir(&active).await?;
        let active_attempts = HashSet::from([String::from("active")]);
        let minimum_age = Duration::from_millis(30);

        let due_at = cleanup_attempt_directories(
            root.path(),
            &active_attempts,
            minimum_age,
            Duration::from_millis(30),
        )
        .await?
        .ok_or("young stale attempt did not schedule its one-shot recovery")?;
        assert!(stale.is_dir());
        assert!(active.is_dir());

        tokio::time::sleep_until(
            tokio::time::Instant::from_std(due_at) + Duration::from_millis(20),
        )
        .await;
        assert!(
            cleanup_attempt_directories(
                root.path(),
                &active_attempts,
                minimum_age,
                Duration::from_millis(30),
            )
            .await?
            .is_some()
        );
        assert!(!stale.exists());
        assert!(active.is_dir());
        Ok(())
    }

    #[tokio::test]
    async fn active_directory_is_rescanned_after_its_lease_can_disappear()
    -> Result<(), Box<dyn Error>> {
        let root = TempDir::new()?;
        let attempt = root.path().join("analysis-attempt-active-then-stale");
        tokio::fs::create_dir(&attempt).await?;
        let active_attempts = HashSet::from([String::from("active-then-stale")]);

        let recheck_at = cleanup_attempt_directories(
            root.path(),
            &active_attempts,
            Duration::ZERO,
            Duration::from_millis(10),
        )
        .await?
        .ok_or("active attempt did not schedule a bounded lease recheck")?;
        assert!(attempt.is_dir());

        tokio::time::sleep_until(tokio::time::Instant::from_std(recheck_at)).await;
        assert_eq!(
            cleanup_attempt_directories(
                root.path(),
                &HashSet::new(),
                Duration::ZERO,
                Duration::from_millis(10),
            )
            .await?,
            None
        );
        assert!(!attempt.exists());
        Ok(())
    }
}
