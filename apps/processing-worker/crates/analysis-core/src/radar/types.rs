use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::canonical::{CanonicalError, FramedSha256};

pub const RADAR_DEFINITION_VERSION: &str = "player-radar-six-axes-v1";
pub const RADAR_METHOD_VERSION: &str = "player-radar-spread-v1";
pub const RADAR_WINDOW_SIZE: usize = 20;
pub const RADAR_MINIMUM_MATCHES: usize = 40;
pub const RADAR_MINIMUM_EVENTS: usize = 8;
pub const RADAR_MINIMUM_SCORING_MATCHES: usize = 3;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RadarAxis {
    AverageRank,
    RevenueP90,
    RevenueAverage,
    TotalAssetsP10,
    TotalAssetsMedian,
    TotalAssetsP90,
}

impl RadarAxis {
    pub const ALL: [Self; 6] = [
        Self::AverageRank,
        Self::RevenueP90,
        Self::RevenueAverage,
        Self::TotalAssetsP10,
        Self::TotalAssetsMedian,
        Self::TotalAssetsP90,
    ];

    #[must_use]
    pub const fn orient(self, raw_value: f64) -> f64 {
        match self {
            Self::AverageRank => -raw_value,
            Self::RevenueP90
            | Self::RevenueAverage
            | Self::TotalAssetsP10
            | Self::TotalAssetsMedian
            | Self::TotalAssetsP90 => raw_value,
        }
    }
}

#[derive(Debug, Error)]
pub enum RadarError {
    #[error("radar requires the same four members in every match")]
    InvalidRoster,
    #[error("radar basis is incompatible or invalid")]
    InvalidBasis,
    #[error("radar snapshot does not belong to the basis source")]
    InvalidSource,
    #[error("radar metric is not finite or violates its domain")]
    InvalidMetric,
    #[error("radar canonical encoding failed: {0}")]
    Canonical(#[from] CanonicalError),
}

/// Comparison order follows the existing match order, without unrelated revision or incident data.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarMatchOrder {
    pub played_at: String,
    pub held_event_id: String,
    pub match_no_in_event: i32,
    pub match_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarSourcePlayer {
    pub member_id: String,
    pub rank: i32,
    pub total_assets_man_yen: i32,
    pub revenue_man_yen: i32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarSourceMatch {
    pub order: RadarMatchOrder,
    pub season_master_id: String,
    pub map_master_id: String,
    pub players: [RadarSourcePlayer; 4],
}

/// Durable private preparation input. Public summaries contain only its bounded metadata/hash.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarSourceSnapshot {
    pub game_title_id: String,
    pub matches: Vec<RadarSourceMatch>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarSourceSummary {
    pub game_title_id: String,
    pub source_checksum: String,
    pub match_count: usize,
    pub held_event_count: usize,
    pub first_match: Option<RadarMatchOrder>,
    pub last_match: Option<RadarMatchOrder>,
    pub map_master_ids: Vec<String>,
    pub map_counts: Vec<RadarMapCount>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarMapCount {
    pub map_master_id: String,
    pub match_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarAxisBasis {
    pub axis_id: RadarAxis,
    /// Distribution quantiles expressed in the original unit (rank therefore decreases).
    pub q10: f64,
    pub median: f64,
    pub q90: f64,
    /// Original-unit boundaries for scores 2 through 10, in that order.
    pub thresholds: [f64; 9],
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarBasis {
    pub definition_version: String,
    pub method_version: String,
    pub window_size: usize,
    pub window_stride: usize,
    pub source: RadarSourceSummary,
    pub axes: [RadarAxisBasis; 6],
}

impl RadarBasis {
    /// Calculation identity excludes the database basis id and every application timestamp.
    ///
    /// # Errors
    ///
    /// Returns an encoding error if the provided value is outside canonical JSON's domain.
    pub fn checksum(&self) -> Result<String, RadarError> {
        let mut digest = FramedSha256::new();
        digest.update_serialized(self, &mut Vec::new())?;
        Ok(digest.finalize())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RadarCandidateUnavailableReason {
    InsufficientMatches,
    InsufficientEvents,
    DegenerateDistribution,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarCandidateAxis {
    pub axis_id: RadarAxis,
    pub q10: Option<f64>,
    pub median: Option<f64>,
    pub q90: Option<f64>,
    pub thresholds: Option<[f64; 9]>,
    pub unavailable_reasons: Vec<RadarCandidateUnavailableReason>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarCandidate {
    pub source: RadarSourceSnapshot,
    pub source_summary: RadarSourceSummary,
    pub window_count: usize,
    pub values_per_axis: usize,
    pub axes: [RadarCandidateAxis; 6],
    pub basis: Option<RadarBasis>,
}

/// Admin-visible preparation result, excluding the complete source record snapshot.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarCandidateSummary {
    pub source_summary: RadarSourceSummary,
    pub window_count: usize,
    pub values_per_axis: usize,
    pub axes: [RadarCandidateAxis; 6],
    pub basis: Option<RadarBasis>,
}

impl RadarCandidate {
    #[must_use]
    pub fn summary(&self) -> RadarCandidateSummary {
        RadarCandidateSummary {
            source_summary: self.source_summary.clone(),
            window_count: self.window_count,
            values_per_axis: self.values_per_axis,
            axes: self.axes.clone(),
            basis: self.basis.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RadarSampleQuality {
    NoTarget,
    Insufficient,
    Reference,
    Standard,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarSample {
    pub match_count: usize,
    pub held_event_count: usize,
    pub quality: RadarSampleQuality,
    pub first_match: Option<RadarMatchOrder>,
    pub last_match: Option<RadarMatchOrder>,
    pub map_counts: Vec<RadarMapCount>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RadarScoreUnavailableReason {
    NoTarget,
    InsufficientMatches,
    BasisUnavailable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarCell {
    pub axis_id: RadarAxis,
    pub raw_value: Option<f64>,
    pub score: Option<u8>,
    pub sample_quality: RadarSampleQuality,
    pub score_unavailable_reasons: Vec<RadarScoreUnavailableReason>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarPlayer {
    pub member_id: String,
    pub axes: [RadarCell; 6],
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarEvaluation {
    pub definition_version: String,
    pub method_version: String,
    pub basis_checksum: Option<String>,
    pub sample: RadarSample,
    pub players: Vec<RadarPlayer>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RadarMonitoringStatus {
    BasisUnavailable,
    InsufficientMatches,
    InsufficientEvents,
    Ready,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RadarReviewReasonKind {
    InitialBasisEligible,
    SourceChanged,
    NewMap,
    HighScoreConcentration,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarReviewReason {
    pub kind: RadarReviewReasonKind,
    pub axis_ids: Vec<RadarAxis>,
    pub map_master_ids: Vec<String>,
    pub evidence_checksum: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarMonitoringWindow {
    pub first_match: RadarMatchOrder,
    pub last_match: RadarMatchOrder,
    pub evaluation: RadarEvaluation,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RadarMonitoring {
    pub status: RadarMonitoringStatus,
    pub post_source_match_count: usize,
    pub completed_window_count: usize,
    pub pending_match_count: usize,
    pub evaluated_match_count: usize,
    pub evaluated_held_event_count: usize,
    pub latest_windows: Vec<RadarMonitoringWindow>,
    pub reasons: Vec<RadarReviewReason>,
}
