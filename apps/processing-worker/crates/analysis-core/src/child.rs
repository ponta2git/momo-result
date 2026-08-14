//! Versioned logical report emitted by the Analysis child.
//!
//! The report schema and validation are capability contract knowledge. File creation, canonical
//! JSON I/O, cleanup, and process exit classification remain in the runtime shell.

use serde::{Deserialize, Serialize};

const REPORT_SCHEMA_VERSION: u32 = 3;

/// Logical identity of one Analysis child computation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnalysisChildRequest {
    pub game_title_id: String,
    pub input_revision: i64,
    pub artifact_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChildPhase {
    Startup,
    InputSnapshot,
    ArtifactBuild,
    Complete,
}

impl ChildPhase {
    #[must_use]
    pub const fn wire(self) -> &'static str {
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
pub enum ChildReportOutcome {
    Succeeded,
    Superseded,
    InputInvalid,
    ArtifactTooLarge,
    DependencyFailed,
    CalculationFailed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ChildReport {
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
    pub const fn new(
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

    /// Validates the closed report schema and its monotonic metric invariants.
    ///
    /// # Errors
    ///
    /// Returns [`ChildReportError::Invalid`] when the schema version, phase, or metric bounds are
    /// inconsistent.
    pub fn validate(&self) -> Result<(), ChildReportError> {
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
pub struct ChildReportMetrics {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChildReportError {
    Invalid,
}
