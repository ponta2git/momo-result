use std::{
    env,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime},
};

use momo_analysis_core::contract::ArtifactManifest;
use serde::Serialize;
use thiserror::Error;
use tokio::time;

use crate::{
    artifact::validate_artifact_directory,
    child_report,
    database::{DatabaseError, connect},
    process::{
        AnalysisChildOutcome, AnalysisChildSpec, ManagedAnalysisChild, ProcessError,
        current_process_peak_resident_bytes, current_process_resident_bytes,
    },
};

#[derive(Clone, Debug)]
pub struct ShadowRequest {
    pub game_title_id: String,
    pub runs: u32,
    pub child_memory_limit_bytes: u64,
    pub calculation_timeout: Duration,
    pub maximum_chunk_bytes: u64,
    pub maximum_chunk_count: u64,
    pub maximum_total_bytes: u64,
    pub maximum_file_count: u64,
    pub temporary_root: PathBuf,
    pub external_runtime_peak_file: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowReport {
    pub evidence_complete: bool,
    pub run_count: usize,
    pub input_revision: i64,
    pub semantic_root_checksum: String,
    pub elapsed_milliseconds: Distribution,
    pub input_milliseconds: Distribution,
    pub kernel_milliseconds: Distribution,
    pub encoding_milliseconds: Distribution,
    pub child_peak_bytes: Distribution,
    pub worker_peak_bytes: Distribution,
    pub worker_resident_bytes_after_cleanup: Distribution,
    pub worker_resident_trend: ResidentTrend,
    pub external_runtime_peak_bytes: u64,
    pub artifact_payload_bytes: u64,
    pub artifact_temporary_bytes: u64,
    pub maximum_chunk_bytes: u64,
    pub chunk_count: usize,
    pub temporary_residue_count: usize,
    pub runs: Vec<ShadowRun>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowRun {
    pub run: u32,
    pub elapsed_milliseconds: u64,
    pub input_milliseconds: u64,
    pub kernel_milliseconds: u64,
    pub encoding_milliseconds: u64,
    pub input_row_count: u64,
    pub child_peak_bytes: u64,
    pub worker_peak_bytes: u64,
    pub worker_resident_bytes_after_cleanup: u64,
    pub artifact_payload_bytes: u64,
    pub artifact_temporary_bytes: u64,
    pub maximum_chunk_bytes: u64,
    pub chunk_count: usize,
    pub root_checksum: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Distribution {
    pub p50: u64,
    pub p95: u64,
    pub p99: u64,
    pub maximum: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentTrend {
    pub window_runs: usize,
    pub initial_p50_bytes: u64,
    pub terminal_p50_bytes: u64,
    pub terminal_delta_bytes: i64,
    pub maximum_after_initial_window_bytes: u64,
}

#[derive(Debug, Error)]
pub enum ShadowError {
    #[error("MOMO_ANALYSIS_READ_DATABASE_URL must be set for shadow calculation")]
    MissingReadDatabaseUrl,
    #[error("shadow run count must be between 1 and 1000")]
    InvalidRunCount,
    #[error("shadow temporary root must be an owned empty directory")]
    UnsafeTemporaryRoot,
    #[error("shadow database operation failed")]
    Database(#[from] DatabaseError),
    #[error("shadow database query failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("shadow child process failed")]
    Process(#[from] ProcessError),
    #[error("shadow child diagnostic report failed")]
    ChildReport,
    #[error("shadow file-system operation failed")]
    Io(#[from] std::io::Error),
    #[error("shadow artifact validation failed")]
    Artifact(#[from] crate::artifact::ArtifactError),
    #[error("shadow calculation exceeded its hard timeout")]
    TimedOut,
    #[error("shadow calculation did not succeed")]
    ChildFailed,
    #[error("shadow child RSS metric was unavailable")]
    MissingChildMetric,
    #[error("shadow worker RSS metric was unavailable")]
    MissingWorkerMetric,
    #[error("shadow worker post-cleanup resident metric was unavailable")]
    MissingWorkerResidentMetric,
    #[error("external runtime peak metric is missing or invalid")]
    MissingExternalMetric,
    #[error("external runtime peak metric could not be read")]
    ExternalMetricRead(#[source] std::io::Error),
    #[error("same-version shadow runs produced different semantic checksums")]
    NonDeterministic,
    #[error("shadow metric exceeds a supported numeric bound")]
    NumericBound,
    #[error("shadow metric conversion exceeds a supported numeric bound")]
    NumericConversion(#[from] std::num::TryFromIntError),
    #[error("system clock is earlier than the Unix epoch")]
    Clock(#[from] std::time::SystemTimeError),
}

/// Runs the release child repeatedly without publishing and summarizes bounded resource evidence.
///
/// The caller must provide a dedicated empty temporary directory and an external runtime peak file
/// (for example a cgroup peak counter). Missing process-external evidence is a hard failure.
///
/// # Errors
///
/// Returns a safe error for timeout, non-determinism, missing metrics, residue, or failed children.
pub async fn run(request: &ShadowRequest) -> Result<ShadowReport, ShadowError> {
    if !(1..=1_000).contains(&request.runs) {
        return Err(ShadowError::InvalidRunCount);
    }
    validate_empty_root(&request.temporary_root)?;
    let read_database_url = env::var("MOMO_ANALYSIS_READ_DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ShadowError::MissingReadDatabaseUrl)?;
    let client = connect(&read_database_url).await?;
    let input_revision = client
        .query_opt(
            "SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&request.game_title_id],
        )
        .await?
        .ok_or(DatabaseError::TitleNotFound)?
        .try_get(0)?;
    let mut runs = Vec::with_capacity(usize::try_from(request.runs)?);
    for run_number in 1..=request.runs {
        runs.push(run_once(request, &read_database_url, input_revision, run_number).await?);
    }
    let checksums = runs
        .iter()
        .map(|run| run.root_checksum.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if checksums.len() != 1 {
        return Err(ShadowError::NonDeterministic);
    }
    let external_runtime_peak_bytes =
        read_external_peak(&request.external_runtime_peak_file).await?;
    let temporary_residue_count = directory_entry_count(&request.temporary_root)?;
    if temporary_residue_count != 0 {
        return Err(ShadowError::UnsafeTemporaryRoot);
    }
    Ok(ShadowReport {
        evidence_complete: true,
        run_count: runs.len(),
        input_revision,
        semantic_root_checksum: runs
            .first()
            .map_or_else(String::new, |run| run.root_checksum.clone()),
        elapsed_milliseconds: distribution(
            runs.iter().map(|run| run.elapsed_milliseconds).collect(),
        )?,
        input_milliseconds: distribution(runs.iter().map(|run| run.input_milliseconds).collect())?,
        kernel_milliseconds: distribution(
            runs.iter().map(|run| run.kernel_milliseconds).collect(),
        )?,
        encoding_milliseconds: distribution(
            runs.iter().map(|run| run.encoding_milliseconds).collect(),
        )?,
        child_peak_bytes: distribution(runs.iter().map(|run| run.child_peak_bytes).collect())?,
        worker_peak_bytes: distribution(runs.iter().map(|run| run.worker_peak_bytes).collect())?,
        worker_resident_bytes_after_cleanup: distribution(
            runs.iter()
                .map(|run| run.worker_resident_bytes_after_cleanup)
                .collect(),
        )?,
        worker_resident_trend: resident_trend(
            &runs
                .iter()
                .map(|run| run.worker_resident_bytes_after_cleanup)
                .collect::<Vec<_>>(),
        )?,
        external_runtime_peak_bytes,
        artifact_payload_bytes: runs
            .iter()
            .map(|run| run.artifact_payload_bytes)
            .max()
            .unwrap_or(0),
        artifact_temporary_bytes: runs
            .iter()
            .map(|run| run.artifact_temporary_bytes)
            .max()
            .unwrap_or(0),
        maximum_chunk_bytes: runs
            .iter()
            .map(|run| run.maximum_chunk_bytes)
            .max()
            .unwrap_or(0),
        chunk_count: runs.iter().map(|run| run.chunk_count).max().unwrap_or(0),
        temporary_residue_count,
        runs,
    })
}

async fn run_once(
    request: &ShadowRequest,
    read_database_url: &str,
    input_revision: i64,
    run_number: u32,
) -> Result<ShadowRun, ShadowError> {
    let directory = request.temporary_root.join(format!(
        "shadow-{}-{run_number}-{}",
        std::process::id(),
        unique_suffix()?
    ));
    tokio::fs::create_dir(&directory).await?;
    let mut owned_directory = OwnedRunDirectory::new(directory);
    let spec = AnalysisChildSpec {
        read_database_url: String::from(read_database_url),
        game_title_id: request.game_title_id.clone(),
        input_revision,
        artifact_id: format!("shadow-artifact-{run_number}"),
        output_directory: owned_directory.path().to_path_buf(),
        maximum_chunk_bytes: request.maximum_chunk_bytes,
        maximum_chunk_count: request.maximum_chunk_count,
        maximum_total_bytes: request.maximum_total_bytes,
        maximum_file_count: request.maximum_file_count,
        parent_liveness_timeout: Duration::from_secs(2),
    };
    let started = Instant::now();
    let mut child = ManagedAnalysisChild::spawn(&spec, request.child_memory_limit_bytes)?;
    child.refresh_liveness()?;
    child.sample_resident_bytes().await;
    let outcome = loop {
        if let Some(outcome) = child.try_wait()? {
            break outcome;
        }
        if started.elapsed() >= request.calculation_timeout {
            let _status = child.terminate(Duration::from_secs(2)).await?;
            return Err(ShadowError::TimedOut);
        }
        if let Err(error) = child.refresh_liveness() {
            if let Some(outcome) = child.try_wait()? {
                break outcome;
            }
            return Err(error.into());
        }
        child.sample_resident_bytes().await;
        time::sleep(Duration::from_millis(5)).await;
    };
    child.sample_resident_bytes().await;
    if outcome != AnalysisChildOutcome::Succeeded {
        return Err(ShadowError::ChildFailed);
    }
    let child_report =
        child_report::take(owned_directory.path()).map_err(|_error| ShadowError::ChildReport)?;
    if !child_report.outcome.matches(outcome) {
        return Err(ShadowError::ChildFailed);
    }
    let elapsed_milliseconds = u64::try_from(started.elapsed().as_millis())?;
    let sampled_child_peak_bytes = child.peak_resident_bytes();
    let manifest = validate_artifact_directory(
        owned_directory.path(),
        request.maximum_chunk_count,
        request.maximum_chunk_bytes,
        request.maximum_total_bytes,
        request.maximum_file_count,
    )?;
    let (artifact_payload_bytes, artifact_temporary_bytes) =
        validate_artifact_evidence(owned_directory.path(), &manifest, &child_report)?;
    let maximum_chunk_bytes = manifest
        .resources
        .iter()
        .map(|resource| resource.common().encoded_bytes)
        .max()
        .unwrap_or(0);
    let child_peak_bytes =
        observed_child_peak(sampled_child_peak_bytes, child_report.peak_resident_bytes)?;
    let chunk_count = manifest.resources.len();
    let root_checksum = manifest.root_checksum.clone();
    drop(manifest);
    drop(child);
    owned_directory.remove().await?;
    let worker_peak_bytes = current_process_peak_resident_bytes()
        .await
        .filter(|value| *value > 0)
        .ok_or(ShadowError::MissingWorkerMetric)?;
    let worker_resident_bytes_after_cleanup = current_process_resident_bytes()
        .await
        .filter(|value| *value > 0)
        .ok_or(ShadowError::MissingWorkerResidentMetric)?;
    Ok(ShadowRun {
        run: run_number,
        elapsed_milliseconds,
        input_milliseconds: child_report.input_milliseconds,
        kernel_milliseconds: child_report.calculation_milliseconds,
        encoding_milliseconds: child_report.encoding_milliseconds,
        input_row_count: child_report.input_row_count,
        child_peak_bytes,
        worker_peak_bytes,
        worker_resident_bytes_after_cleanup,
        artifact_payload_bytes,
        artifact_temporary_bytes,
        maximum_chunk_bytes,
        chunk_count,
        root_checksum,
    })
}

fn validate_artifact_evidence(
    directory: &Path,
    manifest: &ArtifactManifest,
    report: &child_report::ChildReport,
) -> Result<(u64, u64), ShadowError> {
    let temporary_bytes = directory_total_bytes(directory)?;
    let payload_bytes = manifest
        .resources
        .iter()
        .try_fold(0_u64, |total, resource| {
            total
                .checked_add(resource.common().encoded_bytes)
                .ok_or(ShadowError::NumericBound)
        })?;
    if report.artifact_chunk_count != u64::try_from(manifest.resources.len())?
        || report.artifact_payload_bytes != payload_bytes
        || report.artifact_temporary_bytes != temporary_bytes
    {
        return Err(ShadowError::ChildFailed);
    }
    Ok((payload_bytes, temporary_bytes))
}

fn observed_child_peak(
    sampled: Option<u64>,
    self_reported: Option<u64>,
) -> Result<u64, ShadowError> {
    sampled
        .into_iter()
        .chain(self_reported)
        .max()
        .filter(|value| *value > 0)
        .ok_or(ShadowError::MissingChildMetric)
}

struct OwnedRunDirectory {
    path: PathBuf,
    present: bool,
}

impl OwnedRunDirectory {
    const fn new(path: PathBuf) -> Self {
        Self {
            path,
            present: true,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    async fn remove(&mut self) -> Result<(), std::io::Error> {
        tokio::fs::remove_dir_all(&self.path).await?;
        self.present = false;
        Ok(())
    }
}

impl Drop for OwnedRunDirectory {
    fn drop(&mut self) {
        if self.present {
            let _ignored = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn validate_empty_root(path: &Path) -> Result<(), ShadowError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.is_dir()
        && !metadata.file_type().is_symlink()
        && std::fs::read_dir(path)?.next().is_none()
    {
        Ok(())
    } else {
        Err(ShadowError::UnsafeTemporaryRoot)
    }
}

fn directory_total_bytes(path: &Path) -> Result<u64, ShadowError> {
    std::fs::read_dir(path)?.try_fold(0_u64, |total, entry| {
        let entry = entry?;
        let metadata = std::fs::symlink_metadata(entry.path())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(ShadowError::UnsafeTemporaryRoot);
        }
        total
            .checked_add(metadata.len())
            .ok_or(ShadowError::NumericBound)
    })
}

fn directory_entry_count(path: &Path) -> Result<usize, ShadowError> {
    let mut count = 0_usize;
    for entry in std::fs::read_dir(path)? {
        let _entry = entry?;
        count = count.checked_add(1).ok_or(ShadowError::NumericBound)?;
    }
    Ok(count)
}

async fn read_external_peak(path: &Path) -> Result<u64, ShadowError> {
    let raw = tokio::fs::read_to_string(path)
        .await
        .map_err(ShadowError::ExternalMetricRead)?;
    raw.trim()
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or(ShadowError::MissingExternalMetric)
}

fn distribution(mut values: Vec<u64>) -> Result<Distribution, ShadowError> {
    if values.is_empty() {
        return Err(ShadowError::InvalidRunCount);
    }
    values.sort_unstable();
    Ok(Distribution {
        p50: nearest_rank(&values, 50)?,
        p95: nearest_rank(&values, 95)?,
        p99: nearest_rank(&values, 99)?,
        maximum: values.last().copied().unwrap_or(0),
    })
}

fn resident_trend(values: &[u64]) -> Result<ResidentTrend, ShadowError> {
    if values.is_empty() {
        return Err(ShadowError::InvalidRunCount);
    }
    let window_runs = values.len().div_ceil(10);
    let initial = values.get(..window_runs).ok_or(ShadowError::NumericBound)?;
    let terminal_start = values
        .len()
        .checked_sub(window_runs)
        .ok_or(ShadowError::NumericBound)?;
    let terminal = values
        .get(terminal_start..)
        .ok_or(ShadowError::NumericBound)?;
    let initial_p50_bytes = distribution(initial.to_vec())?.p50;
    let terminal_p50_bytes = distribution(terminal.to_vec())?.p50;
    let terminal_delta_bytes = i64::try_from(terminal_p50_bytes)?
        .checked_sub(i64::try_from(initial_p50_bytes)?)
        .ok_or(ShadowError::NumericBound)?;
    let maximum_after_initial_window_bytes = values
        .get(window_runs..)
        .unwrap_or_default()
        .iter()
        .copied()
        .max()
        .unwrap_or(terminal_p50_bytes);
    Ok(ResidentTrend {
        window_runs,
        initial_p50_bytes,
        terminal_p50_bytes,
        terminal_delta_bytes,
        maximum_after_initial_window_bytes,
    })
}

fn nearest_rank(values: &[u64], percentile: usize) -> Result<u64, ShadowError> {
    let rank = values
        .len()
        .checked_mul(percentile)
        .and_then(|value| value.checked_add(99))
        .map(|value| value / 100)
        .ok_or(ShadowError::NumericBound)?;
    values
        .get(rank.saturating_sub(1))
        .copied()
        .ok_or(ShadowError::NumericBound)
}

fn unique_suffix() -> Result<u128, ShadowError> {
    Ok(SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_nanos())
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "distribution test setup aborts with the unexpected calculation error"
)]
mod tests {
    use super::*;

    #[test]
    fn nearest_rank_distribution_is_deterministic() {
        let result = distribution((1..=100).collect())
            .unwrap_or_else(|error| panic!("distribution: {error}"));
        assert_eq!(result.p50, 50);
        assert_eq!(result.p95, 95);
        assert_eq!(result.p99, 99);
        assert_eq!(result.maximum, 100);
    }

    #[test]
    fn resident_trend_compares_robust_end_windows() {
        let mut values = vec![10; 10];
        values.extend([20; 10]);
        let result =
            resident_trend(&values).unwrap_or_else(|error| panic!("resident trend: {error}"));
        assert_eq!(result.window_runs, 2);
        assert_eq!(result.initial_p50_bytes, 10);
        assert_eq!(result.terminal_p50_bytes, 20);
        assert_eq!(result.terminal_delta_bytes, 10);
        assert_eq!(result.maximum_after_initial_window_bytes, 20);
    }
}
