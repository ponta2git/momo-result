use std::{
    env,
    path::Path,
    time::{Duration, Instant},
};

use momo_analysis_core::child::AnalysisAttemptIdentity;

use crate::{
    postgres::{PostgresError, open},
    process::{CHILD_DEPENDENCY_FAILED_EXIT_CODE, current_process_peak_resident_bytes},
};

use super::child_process::{
    CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE, CHILD_CALCULATION_FAILED_EXIT_CODE,
    CHILD_INPUT_INVALID_EXIT_CODE, CHILD_SUPERSEDED_EXIT_CODE,
};

use super::{
    artifact::{ArtifactBuildRequest, ArtifactError, build_artifact},
    child_report::{self, ChildPhase, ChildReport, ChildReportMetrics, ChildReportOutcome},
    control::ALGORITHM_VERSION,
    input_repository::{InputRepositoryError, LoadedInput, load_job_input},
};

pub(crate) struct AnalysisChildExecutionConfig<'a> {
    pub(crate) identity: AnalysisAttemptIdentity,
    pub(crate) output_directory: &'a Path,
    pub(crate) maximum_chunk_bytes: u64,
    pub(crate) maximum_chunk_count: u64,
    pub(crate) maximum_total_bytes: u64,
    pub(crate) maximum_file_count: u64,
}

/// Executes the read-only calculation side of one worker attempt.
///
/// This boundary intentionally returns only documented exit codes. Connection details, query
/// errors, and artifact contents are never printed by the child.
#[must_use]
pub(crate) async fn execute(config: &AnalysisChildExecutionConfig<'_>) -> i32 {
    let started = Instant::now();
    let mut telemetry = ChildTelemetry::default();
    let result = execute_inner(config, &mut telemetry).await;
    telemetry.metrics.peak_resident_bytes = current_process_peak_resident_bytes().await;
    telemetry.metrics.total_milliseconds = milliseconds(started.elapsed());
    let (outcome, exit_code) = match result {
        Ok(()) => (ChildReportOutcome::Succeeded, 0),
        Err(failure) => (failure.report_outcome(), failure.exit_code()),
    };
    let report = ChildReport::new(outcome, telemetry.phase, telemetry.metrics);
    if child_report::write(config.output_directory, &report).is_err() {
        return CHILD_CALCULATION_FAILED_EXIT_CODE;
    }
    exit_code
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChildFailure {
    Superseded,
    InputInvalid,
    ArtifactTooLarge,
    DependencyFailed,
    CalculationFailed,
}

impl ChildFailure {
    const fn report_outcome(self) -> ChildReportOutcome {
        match self {
            Self::Superseded => ChildReportOutcome::Superseded,
            Self::InputInvalid => ChildReportOutcome::InputInvalid,
            Self::ArtifactTooLarge => ChildReportOutcome::ArtifactTooLarge,
            Self::DependencyFailed => ChildReportOutcome::DependencyFailed,
            Self::CalculationFailed => ChildReportOutcome::CalculationFailed,
        }
    }

    const fn exit_code(self) -> i32 {
        match self {
            Self::Superseded => CHILD_SUPERSEDED_EXIT_CODE,
            Self::InputInvalid => CHILD_INPUT_INVALID_EXIT_CODE,
            Self::ArtifactTooLarge => CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE,
            Self::DependencyFailed => CHILD_DEPENDENCY_FAILED_EXIT_CODE,
            Self::CalculationFailed => CHILD_CALCULATION_FAILED_EXIT_CODE,
        }
    }
}

struct ChildTelemetry {
    phase: ChildPhase,
    metrics: ChildReportMetrics,
}

impl Default for ChildTelemetry {
    fn default() -> Self {
        Self {
            phase: ChildPhase::Startup,
            metrics: ChildReportMetrics::default(),
        }
    }
}

async fn execute_inner(
    config: &AnalysisChildExecutionConfig<'_>,
    telemetry: &mut ChildTelemetry,
) -> Result<(), ChildFailure> {
    let read_database_url = env::var("MOMO_ANALYSIS_READ_DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ChildFailure::CalculationFailed)?;
    telemetry.phase = ChildPhase::InputSnapshot;
    let input_started = Instant::now();
    let loaded_result = load_input_snapshot(&read_database_url, &config.identity).await;
    telemetry.metrics.input_milliseconds = milliseconds(input_started.elapsed());
    let loaded = loaded_result?;
    let mut input = loaded.input;
    if let Some(context) = loaded.context.as_ref()
        && context.work_kind == "radar_prepare"
    {
        telemetry.phase = ChildPhase::ArtifactBuild;
        let started = Instant::now();
        let preparation = super::radar_prepare::compute(&input, context)
            .map_err(|_error| ChildFailure::InputInvalid)?;
        telemetry.metrics.calculation_milliseconds = milliseconds(started.elapsed());
        let encoding_started = Instant::now();
        let bytes = super::radar_prepare::write(
            config.output_directory,
            &preparation,
            config
                .maximum_total_bytes
                .saturating_sub(child_report::RESERVED_BYTES),
        )
        .map_err(|_error| ChildFailure::ArtifactTooLarge)?;
        telemetry.metrics.encoding_milliseconds = milliseconds(encoding_started.elapsed());
        telemetry.metrics.input_row_count = u64::try_from(input.player_matches().len())
            .map_err(|_error| ChildFailure::ArtifactTooLarge)?;
        telemetry.metrics.artifact_chunk_count = 1;
        telemetry.metrics.artifact_payload_bytes = bytes;
        telemetry.metrics.artifact_temporary_bytes = bytes;
        telemetry.phase = ChildPhase::Complete;
        return Ok(());
    }
    if let Some(context) = loaded.context.as_ref() {
        let monitoring = momo_analysis_core::radar::monitor(
            &input,
            context.basis.as_ref(),
            context.source.as_ref(),
        )
        .map_err(|_error| ChildFailure::InputInvalid)?;
        input = input.with_radar_monitoring(monitoring);
    }
    telemetry.metrics.input_row_count = u64::try_from(input.player_matches().len())
        .map_err(|_error| ChildFailure::CalculationFailed)?;
    if input
        .resource_count()
        .is_none_or(|count| count > config.maximum_chunk_count)
    {
        return Err(ChildFailure::ArtifactTooLarge);
    }

    telemetry.phase = ChildPhase::ArtifactBuild;
    let maximum_total_bytes = config
        .maximum_total_bytes
        .checked_sub(child_report::RESERVED_BYTES)
        .ok_or(ChildFailure::ArtifactTooLarge)?;
    let maximum_file_count = config
        .maximum_file_count
        .checked_sub(child_report::RESERVED_FILES)
        .ok_or(ChildFailure::ArtifactTooLarge)?;
    let artifact = build_artifact(
        &input,
        &ArtifactBuildRequest {
            artifact_id: config.identity.artifact_id.clone(),
            algorithm_version: String::from(ALGORITHM_VERSION),
            maximum_chunk_bytes: config.maximum_chunk_bytes,
            maximum_chunk_count: config.maximum_chunk_count,
            maximum_total_bytes,
            maximum_file_count,
        },
        config.output_directory,
    )
    .map_err(|error| map_artifact_failure(&error))?;
    telemetry.metrics.calculation_milliseconds = milliseconds(artifact.calculation_duration);
    telemetry.metrics.encoding_milliseconds = milliseconds(artifact.encoding_duration);
    telemetry.metrics.artifact_chunk_count = u64::try_from(artifact.manifest.resources.len())
        .map_err(|_error| ChildFailure::CalculationFailed)?;
    telemetry.metrics.artifact_payload_bytes = artifact.chunk_bytes;
    telemetry.metrics.artifact_temporary_bytes = artifact.directory_bytes;
    telemetry.phase = ChildPhase::Complete;
    Ok(())
}

/// Owns the socket and query client only for the snapshot. The connection driver is polled in
/// this scope and dropped before synchronous calculation can monopolize the child runtime.
async fn load_input_snapshot(
    database_url: &str,
    identity: &AnalysisAttemptIdentity,
) -> Result<LoadedInput, ChildFailure> {
    let (mut client, mut connection) = open(database_url)
        .await
        .map_err(|error| map_postgres_failure(&error))?;
    tokio::select! {
        result = load_job_input(&mut client, identity) => {
            result.map_err(|error| map_input_repository_failure(&error))
        }
        _result = &mut connection => Err(ChildFailure::DependencyFailed),
    }
}

fn milliseconds(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

const fn map_postgres_failure(error: &PostgresError) -> ChildFailure {
    match error {
        PostgresError::InvalidConfiguration(_) | PostgresError::TlsConfiguration(_) => {
            ChildFailure::CalculationFailed
        }
        PostgresError::Postgres(_) | PostgresError::ConnectionTimeout => {
            ChildFailure::DependencyFailed
        }
    }
}

const fn map_input_repository_failure(error: &InputRepositoryError) -> ChildFailure {
    match error {
        InputRepositoryError::Superseded => ChildFailure::Superseded,
        InputRepositoryError::TitleNotFound | InputRepositoryError::InputContract(_) => {
            ChildFailure::InputInvalid
        }
        InputRepositoryError::Postgres(_) => ChildFailure::DependencyFailed,
    }
}

const fn map_artifact_failure(error: &ArtifactError) -> ChildFailure {
    match error {
        ArtifactError::ResourceBound | ArtifactError::NumericConversion(_) => {
            ChildFailure::ArtifactTooLarge
        }
        ArtifactError::Canonical(_) | ArtifactError::Contract(_) | ArtifactError::Radar(_) => {
            ChildFailure::InputInvalid
        }
        ArtifactError::UnsafeDirectory | ArtifactError::Io(_) | ArtifactError::Payload(_) => {
            ChildFailure::CalculationFailed
        }
    }
}
