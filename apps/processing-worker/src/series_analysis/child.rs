use std::{
    env,
    path::Path,
    time::{Duration, Instant},
};

use crate::{
    database::{DatabaseError, connect, load_analysis_input},
    process::{
        CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE, CHILD_CALCULATION_FAILED_EXIT_CODE,
        CHILD_DEPENDENCY_FAILED_EXIT_CODE, CHILD_INPUT_INVALID_EXIT_CODE,
        CHILD_SUPERSEDED_EXIT_CODE, current_process_peak_resident_bytes,
        start_parent_liveness_monitor,
    },
};

use super::{
    artifact::{ArtifactBuildRequest, ArtifactError, build_artifact},
    child_report::{self, ChildPhase, ChildReport, ChildReportMetrics, ChildReportOutcome},
    control::ALGORITHM_VERSION,
};

pub struct ChildComputeRequest<'a> {
    pub request: momo_analysis_core::child::AnalysisChildRequest,
    pub output_directory: &'a Path,
    pub maximum_chunk_bytes: u64,
    pub maximum_chunk_count: u64,
    pub maximum_total_bytes: u64,
    pub maximum_file_count: u64,
    pub parent_liveness_fd: i32,
    pub parent_liveness_timeout: Duration,
}

/// Executes the read-only calculation side of one worker attempt.
///
/// This boundary intentionally returns only documented exit codes. Connection details, query
/// errors, and artifact contents are never printed by the child.
#[must_use]
pub async fn execute(request: &ChildComputeRequest<'_>) -> i32 {
    let started = Instant::now();
    let mut telemetry = ChildTelemetry::default();
    let result = execute_inner(request, &mut telemetry).await;
    telemetry.metrics.peak_resident_bytes = current_process_peak_resident_bytes().await;
    telemetry.metrics.total_milliseconds = milliseconds(started.elapsed());
    let (outcome, exit_code) = match result {
        Ok(()) => (ChildReportOutcome::Succeeded, 0),
        Err(failure) => (failure.report_outcome(), failure.exit_code()),
    };
    let report = ChildReport::new(outcome, telemetry.phase, telemetry.metrics);
    if child_report::write(request.output_directory, &report).is_err() {
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
    request: &ChildComputeRequest<'_>,
    telemetry: &mut ChildTelemetry,
) -> Result<(), ChildFailure> {
    start_parent_liveness_monitor(request.parent_liveness_fd, request.parent_liveness_timeout)
        .map_err(|_liveness_error| ChildFailure::CalculationFailed)?;
    let read_database_url = env::var("MOMO_ANALYSIS_READ_DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ChildFailure::CalculationFailed)?;
    telemetry.phase = ChildPhase::InputSnapshot;
    let input_started = Instant::now();
    let mut client = match connect(&read_database_url).await {
        Ok(client) => client,
        Err(error) => {
            telemetry.metrics.input_milliseconds = milliseconds(input_started.elapsed());
            return Err(map_database_failure(&error));
        }
    };
    let input = match load_analysis_input(
        &mut client,
        &request.request.game_title_id,
        request.request.input_revision,
    )
    .await
    {
        Ok(input) => input,
        Err(error) => {
            telemetry.metrics.input_milliseconds = milliseconds(input_started.elapsed());
            return Err(map_database_failure(&error));
        }
    };
    telemetry.metrics.input_milliseconds = milliseconds(input_started.elapsed());
    telemetry.metrics.input_row_count =
        u64::try_from(input.rows.len()).map_err(|_error| ChildFailure::CalculationFailed)?;
    if input
        .resource_count()
        .is_none_or(|count| count > request.maximum_chunk_count)
    {
        return Err(ChildFailure::ArtifactTooLarge);
    }

    telemetry.phase = ChildPhase::ArtifactBuild;
    let maximum_total_bytes = request
        .maximum_total_bytes
        .checked_sub(child_report::RESERVED_BYTES)
        .ok_or(ChildFailure::ArtifactTooLarge)?;
    let maximum_file_count = request
        .maximum_file_count
        .checked_sub(child_report::RESERVED_FILES)
        .ok_or(ChildFailure::ArtifactTooLarge)?;
    let artifact = build_artifact(
        &input,
        &ArtifactBuildRequest {
            artifact_id: request.request.artifact_id.clone(),
            algorithm_version: String::from(ALGORITHM_VERSION),
            maximum_chunk_bytes: request.maximum_chunk_bytes,
            maximum_chunk_count: request.maximum_chunk_count,
            maximum_total_bytes,
            maximum_file_count,
        },
        request.output_directory,
    )
    .map_err(|error| map_artifact_failure(&error))?;
    telemetry.metrics.calculation_milliseconds = milliseconds(artifact.calculation_duration);
    telemetry.metrics.encoding_milliseconds = milliseconds(artifact.encoding_duration);
    telemetry.metrics.artifact_chunk_count = u64::try_from(artifact.manifest.resources.len())
        .map_err(|_error| ChildFailure::CalculationFailed)?;
    telemetry.metrics.artifact_payload_bytes = artifact.payload_bytes;
    telemetry.metrics.artifact_temporary_bytes = artifact.temporary_bytes;
    telemetry.phase = ChildPhase::Complete;
    Ok(())
}

fn milliseconds(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

const fn map_database_failure(error: &DatabaseError) -> ChildFailure {
    match error {
        DatabaseError::Superseded => ChildFailure::Superseded,
        DatabaseError::TitleNotFound | DatabaseError::InputContract(_) => {
            ChildFailure::InputInvalid
        }
        DatabaseError::InvalidConfiguration(_) | DatabaseError::TlsConfiguration(_) => {
            ChildFailure::CalculationFailed
        }
        DatabaseError::Postgres(_) => ChildFailure::DependencyFailed,
    }
}

const fn map_artifact_failure(error: &ArtifactError) -> ChildFailure {
    match error {
        ArtifactError::ResourceBound | ArtifactError::NumericConversion(_) => {
            ChildFailure::ArtifactTooLarge
        }
        ArtifactError::Canonical(_) | ArtifactError::Contract(_) => ChildFailure::InputInvalid,
        ArtifactError::UnsafeDirectory | ArtifactError::Io(_) | ArtifactError::Payload(_) => {
            ChildFailure::CalculationFailed
        }
    }
}
