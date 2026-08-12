use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use momo_analysis_core::canonical::{CanonicalError, parse_canonical_json, write_canonical};
use thiserror::Error;

use crate::process::AnalysisChildOutcome;
pub(crate) use momo_analysis_core::child::{
    ChildPhase, ChildReport, ChildReportMetrics, ChildReportOutcome,
};

pub(crate) const RESERVED_BYTES: u64 = 4_096;
pub(crate) const RESERVED_FILES: u64 = 1;
const REPORT_FILE_NAME: &str = ".child-report-v3.json";

pub(crate) const fn matches_process_outcome(
    report: ChildReportOutcome,
    outcome: AnalysisChildOutcome,
) -> bool {
    matches!(
        (report, outcome),
        (
            ChildReportOutcome::Succeeded,
            AnalysisChildOutcome::Succeeded
        ) | (
            ChildReportOutcome::Superseded,
            AnalysisChildOutcome::Superseded
        ) | (
            ChildReportOutcome::InputInvalid,
            AnalysisChildOutcome::InputInvalid
        ) | (
            ChildReportOutcome::ArtifactTooLarge,
            AnalysisChildOutcome::ArtifactTooLarge
        ) | (
            ChildReportOutcome::DependencyFailed,
            AnalysisChildOutcome::DependencyFailed
        ) | (
            ChildReportOutcome::CalculationFailed,
            AnalysisChildOutcome::CalculationFailed
        )
    )
}

#[derive(Debug, Error)]
pub(crate) enum ChildReportError {
    #[error("child diagnostic report file operation failed")]
    Io(#[from] std::io::Error),
    #[error("child diagnostic report canonicalization failed")]
    Canonical(#[from] CanonicalError),
    #[error("child diagnostic report decoding failed")]
    Decode(#[from] serde_json::Error),
    #[error("child diagnostic report is invalid")]
    Invalid,
}

impl ChildReportError {
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Io(_) => "child_report_io",
            Self::Canonical(_) => "child_report_canonical",
            Self::Decode(_) => "child_report_decode",
            Self::Invalid => "child_report_invalid",
        }
    }
}

pub(crate) fn write(directory: &Path, report: &ChildReport) -> Result<(), ChildReportError> {
    report
        .validate()
        .map_err(|_error| ChildReportError::Invalid)?;
    let mut bytes = Vec::with_capacity(512);
    write_canonical(report, &mut bytes)?;
    if u64::try_from(bytes.len()).map_or(true, |length| length > RESERVED_BYTES) {
        return Err(ChildReportError::Invalid);
    }
    let path = directory.join(REPORT_FILE_NAME);
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(&bytes)?;
    file.flush()?;
    Ok(())
}

pub(crate) fn take(directory: &Path) -> Result<ChildReport, ChildReportError> {
    let path = directory.join(REPORT_FILE_NAME);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > RESERVED_BYTES {
        return Err(ChildReportError::Invalid);
    }
    let bytes = fs::read(&path)?;
    fs::remove_file(path)?;
    let value = parse_canonical_json(&bytes)?;
    let report: ChildReport = serde_json::from_value(value)?;
    report
        .validate()
        .map_err(|_error| ChildReportError::Invalid)?;
    Ok(report)
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "temporary report fixture failures must expose their originating file error"
)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn report_round_trip_is_canonical_bounded_and_single_use() {
        let directory =
            TempDir::new().unwrap_or_else(|error| panic!("temporary directory: {error}"));
        let report = ChildReport::new(
            ChildReportOutcome::Succeeded,
            ChildPhase::Complete,
            ChildReportMetrics {
                total_milliseconds: 10,
                input_milliseconds: 2,
                calculation_milliseconds: 3,
                encoding_milliseconds: 4,
                input_row_count: 2_000,
                artifact_chunk_count: 42,
                artifact_payload_bytes: 8_192,
                artifact_temporary_bytes: 9_216,
                peak_resident_bytes: Some(32_768),
            },
        );

        write(directory.path(), &report).unwrap_or_else(|error| panic!("write report: {error}"));
        assert_eq!(
            take(directory.path()).unwrap_or_else(|error| panic!("take report: {error}")),
            report
        );
        assert!(matches!(
            take(directory.path()),
            Err(ChildReportError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound
        ));

        let mut contradictory = report;
        contradictory.artifact_temporary_bytes = contradictory.artifact_payload_bytes - 1;
        assert!(matches!(
            write(directory.path(), &contradictory),
            Err(ChildReportError::Invalid)
        ));
    }

    #[test]
    fn malformed_report_is_removed_before_decode_failure_is_returned() {
        let directory =
            TempDir::new().unwrap_or_else(|error| panic!("temporary directory: {error}"));
        fs::write(directory.path().join(REPORT_FILE_NAME), b"{ }")
            .unwrap_or_else(|error| panic!("write malformed report: {error}"));

        assert!(matches!(
            take(directory.path()),
            Err(ChildReportError::Canonical(CanonicalError::NonCanonical))
        ));
        assert_eq!(
            fs::read_dir(directory.path())
                .unwrap_or_else(|error| panic!("read temporary directory: {error}"))
                .count(),
            0
        );
    }
}
