use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use momo_analysis_core::canonical::{CanonicalError, parse_canonical_json, write_canonical};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::process::AnalysisChildOutcome;

pub(crate) const RESERVED_BYTES: u64 = 4_096;
pub(crate) const RESERVED_FILES: u64 = 1;
const REPORT_FILE_NAME: &str = ".child-report-v3.json";
const REPORT_SCHEMA_VERSION: u32 = 3;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChildPhase {
    Startup,
    InputSnapshot,
    ArtifactBuild,
    Complete,
}

impl ChildPhase {
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::InputSnapshot => "input_snapshot",
            Self::ArtifactBuild => "artifact_build",
            Self::Complete => "complete",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChildReportOutcome {
    Succeeded,
    Superseded,
    InputInvalid,
    ArtifactTooLarge,
    DependencyFailed,
    CalculationFailed,
}

impl ChildReportOutcome {
    pub(crate) const fn matches(self, outcome: AnalysisChildOutcome) -> bool {
        matches!(
            (self, outcome),
            (Self::Succeeded, AnalysisChildOutcome::Succeeded)
                | (Self::Superseded, AnalysisChildOutcome::Superseded)
                | (Self::InputInvalid, AnalysisChildOutcome::InputInvalid)
                | (
                    Self::ArtifactTooLarge,
                    AnalysisChildOutcome::ArtifactTooLarge
                )
                | (
                    Self::DependencyFailed,
                    AnalysisChildOutcome::DependencyFailed
                )
                | (
                    Self::CalculationFailed,
                    AnalysisChildOutcome::CalculationFailed
                )
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ChildReport {
    pub schema_version: u32,
    pub outcome: ChildReportOutcome,
    pub terminal_phase: ChildPhase,
    pub total_milliseconds: u64,
    pub input_milliseconds: u64,
    pub calculation_milliseconds: u64,
    pub encoding_milliseconds: u64,
    pub input_row_count: u64,
    pub artifact_chunk_count: u64,
    pub artifact_payload_bytes: u64,
    pub artifact_temporary_bytes: u64,
    pub peak_resident_bytes: Option<u64>,
}

impl ChildReport {
    #[must_use]
    pub(crate) const fn new(
        outcome: ChildReportOutcome,
        terminal_phase: ChildPhase,
        metrics: ChildReportMetrics,
    ) -> Self {
        Self {
            schema_version: REPORT_SCHEMA_VERSION,
            outcome,
            terminal_phase,
            total_milliseconds: metrics.total_milliseconds,
            input_milliseconds: metrics.input_milliseconds,
            calculation_milliseconds: metrics.calculation_milliseconds,
            encoding_milliseconds: metrics.encoding_milliseconds,
            input_row_count: metrics.input_row_count,
            artifact_chunk_count: metrics.artifact_chunk_count,
            artifact_payload_bytes: metrics.artifact_payload_bytes,
            artifact_temporary_bytes: metrics.artifact_temporary_bytes,
            peak_resident_bytes: metrics.peak_resident_bytes,
        }
    }

    fn validate(&self) -> Result<(), ChildReportError> {
        let phases = self
            .input_milliseconds
            .checked_add(self.calculation_milliseconds)
            .and_then(|value| value.checked_add(self.encoding_milliseconds))
            .ok_or(ChildReportError::Invalid)?;
        if self.schema_version != REPORT_SCHEMA_VERSION
            || phases > self.total_milliseconds
            || self.artifact_temporary_bytes < self.artifact_payload_bytes
            || self.peak_resident_bytes == Some(0)
            || (self.outcome == ChildReportOutcome::Succeeded
                && self.terminal_phase != ChildPhase::Complete)
        {
            return Err(ChildReportError::Invalid);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ChildReportMetrics {
    pub total_milliseconds: u64,
    pub input_milliseconds: u64,
    pub calculation_milliseconds: u64,
    pub encoding_milliseconds: u64,
    pub input_row_count: u64,
    pub artifact_chunk_count: u64,
    pub artifact_payload_bytes: u64,
    pub artifact_temporary_bytes: u64,
    pub peak_resident_bytes: Option<u64>,
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
    report.validate()?;
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
    report.validate()?;
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
