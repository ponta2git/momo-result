use serde::{Deserialize, Serialize};

use super::RadarError;
use crate::{
    achievements::{self, AchievementCurve, AchievementPayload, AchievementUnavailableReason},
    model::NormalizedAnalysisInput,
    stats::percentile_f64,
};

const METHOD: &str = "achievement-points-spread-v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementGenerationPlayer {
    pub member_id: String,
    pub earned_points: u32,
}

/// Frozen lifetime points, independent of later catalog and proof changes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementGenerationSource {
    pub method_version: String,
    pub total_points: u32,
    pub players: [AchievementGenerationPlayer; 4],
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementGeneration {
    pub source: AchievementGenerationSource,
    pub q10: Option<f64>,
    pub median: Option<f64>,
    pub q90: Option<f64>,
    pub point_thresholds: Option<[f64; 9]>,
    pub unavailable_reason: Option<AchievementUnavailableReason>,
}

impl AchievementGenerationSource {
    /// # Errors
    /// Rejects a missing or malformed overall four-member summary.
    pub fn from_payload(payload: &AchievementPayload) -> Result<Self, RadarError> {
        let summary = payload
            .summaries
            .iter()
            .find(|summary| summary.map_master_id.is_none())
            .ok_or(RadarError::InvalidSource)?;
        let source = Self {
            method_version: METHOD.to_owned(),
            total_points: summary.total_points,
            players: summary
                .players
                .iter()
                .map(|player| AchievementGenerationPlayer {
                    member_id: player.member_id.clone(),
                    earned_points: player.earned_points,
                })
                .collect::<Vec<_>>()
                .try_into()
                .map_err(|_invalid| RadarError::InvalidRoster)?,
        };
        if !source.is_valid() {
            return Err(RadarError::InvalidSource);
        }
        Ok(source)
    }

    /// # Errors
    /// Rejects a malformed overall achievement summary.
    pub fn from_input(input: &NormalizedAnalysisInput) -> Result<Self, RadarError> {
        Self::from_payload(&achievements::calculate(
            input.game_title_id(),
            input.achievements(),
            input.player_matches(),
            AchievementCurve::default(),
        ))
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.method_version == METHOD
            && self.total_points <= 102_400
            && self.players.iter().all(|p| {
                crate::model::valid_input_id(&p.member_id) && p.earned_points <= self.total_points
            })
            && self.players.windows(2).all(|pair| {
                pair.first()
                    .zip(pair.get(1))
                    .is_some_and(|(a, b)| a.member_id < b.member_id)
            })
    }

    #[must_use]
    pub fn generate(&self) -> AchievementGeneration {
        let values = self
            .players
            .iter()
            .map(|p| f64::from(p.earned_points))
            .collect::<Vec<_>>();
        let (q10, median, q90) = if self.total_points == 0 {
            (None, None, None)
        } else {
            (
                percentile_f64(&values, 0.1),
                percentile_f64(&values, 0.5),
                percentile_f64(&values, 0.9),
            )
        };
        let point_thresholds = q10
            .zip(median)
            .zip(q90)
            .and_then(|((q10, median), q90)| thresholds(q10, median, q90, self.total_points));
        let unavailable_reason = if self.total_points == 0 {
            Some(AchievementUnavailableReason::NoTarget)
        } else if point_thresholds.is_none() {
            Some(AchievementUnavailableReason::DegenerateDistribution)
        } else {
            None
        };
        AchievementGeneration {
            source: self.clone(),
            q10,
            median,
            q90,
            point_thresholds,
            unavailable_reason,
        }
    }
}

impl AchievementGeneration {
    #[must_use]
    pub fn curve(&self) -> AchievementCurve {
        self.point_thresholds.map_or_else(
            || AchievementCurve::Unavailable {
                unavailable_reason: self
                    .unavailable_reason
                    .unwrap_or(AchievementUnavailableReason::DegenerateDistribution),
            },
            |point_thresholds| AchievementCurve::Points { point_thresholds },
        )
    }

    #[must_use]
    pub fn permits_basis(&self) -> bool {
        self.unavailable_reason != Some(AchievementUnavailableReason::DegenerateDistribution)
    }
}

#[expect(
    clippy::suboptimal_flops,
    reason = "versioned generation formula preserves operation order"
)]
fn thresholds(q10: f64, median: f64, q90: f64, total: u32) -> Option<[f64; 9]> {
    if !(q10 < median && median < q90) {
        return None;
    }
    let maximum = f64::from(total);
    let lower = (median - q10).min(median / 1.6);
    let upper = (q90 - median).min((maximum - median) / 1.6);
    let mut result = [0.0; 9];
    for (threshold, score) in result.iter_mut().zip(2_u8..=10) {
        let width = if score < 6 { lower } else { upper };
        let raw = median + (f64::from(score) - 6.0) / 2.5 * width;
        *threshold = if score == 2 {
            raw.max(0.0)
        } else if score == 10 {
            raw.min(maximum)
        } else {
            raw
        };
    }
    (AchievementCurve::Points {
        point_thresholds: result,
    }
    .is_valid()
        && result.iter().all(|value| (0.0..=maximum).contains(value)))
    .then_some(result)
}
