use serde::{Deserialize, Serialize};

const LEGACY_SCORE_POINTS: [f64; 5] = [1.0, 3.0, 5.0, 7.0, 10.0];
const MAXIMUM_ACHIEVEMENT_POINTS: f64 = 102_400.0;

/// The field name preserves the unit and scoring method of immutable saved criteria.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum AchievementCurve {
    Points {
        /// Earned-point boundaries for scores 2 through 10, inclusive at each boundary.
        #[serde(rename = "pointThresholds")]
        point_thresholds: [f64; 9],
    },
    LegacyPercentage {
        /// Historical percentage knots for scores 1, 3, 5, 7 and 10.
        thresholds: [f64; 5],
    },
}

impl Default for AchievementCurve {
    fn default() -> Self {
        Self::Points {
            point_thresholds: [5.0, 10.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0, 200.0],
        }
    }
}

impl AchievementCurve {
    /// Missing curves in saved legacy bases used these percentages, not today's point defaults.
    #[must_use]
    pub const fn legacy_percentage_default() -> Self {
        Self::LegacyPercentage {
            thresholds: [0.0, 10.0, 25.0, 50.0, 80.0],
        }
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        let (thresholds, maximum): (&[f64], f64) = match self {
            Self::Points { point_thresholds } => (point_thresholds, MAXIMUM_ACHIEVEMENT_POINTS),
            Self::LegacyPercentage { thresholds } => (thresholds, 100.0),
        };
        thresholds
            .iter()
            .all(|value| value.is_finite() && (0.0..=maximum).contains(value))
            && thresholds
                .iter()
                .zip(thresholds.iter().skip(1))
                .all(|(left, right)| left < right)
    }

    /// Points use the same inclusive step boundaries as the six match-statistic axes.
    /// Legacy percentage curves retain their original interpolation when read or restored.
    #[must_use]
    pub fn score(&self, earned_points: u32, total_points: u32) -> Option<f64> {
        if total_points == 0 || !self.is_valid() {
            return None;
        }
        Some(match self {
            Self::Points { point_thresholds } => {
                f64::from(point_thresholds.iter().fold(1_u8, |score, threshold| {
                    score + u8::from(f64::from(earned_points) >= *threshold)
                }))
            }
            Self::LegacyPercentage { thresholds } => {
                let percentage = 100.0 * f64::from(earned_points) / f64::from(total_points);
                legacy_score(percentage, thresholds)
            }
        })
    }
}

fn legacy_score(percentage: f64, thresholds: &[f64; 5]) -> f64 {
    let points = thresholds.iter().copied().zip(LEGACY_SCORE_POINTS);
    let mut previous: Option<(f64, f64)> = None;
    for (threshold, score) in points {
        if percentage <= threshold {
            return previous.map_or(score, |(lower, lower_score)| {
                ((percentage - lower) / (threshold - lower))
                    .mul_add(score - lower_score, lower_score)
            });
        }
        previous = Some((threshold, score));
    }
    10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn point_scores_use_inclusive_steps_independent_of_available_points() {
        let curve = AchievementCurve::default();
        for (earned, expected) in [
            (0, 1.0),
            (4, 1.0),
            (5, 2.0),
            (9, 2.0),
            (10, 3.0),
            (19, 3.0),
            (20, 4.0),
            (30, 5.0),
            (50, 6.0),
            (75, 7.0),
            (100, 8.0),
            (150, 9.0),
            (199, 9.0),
            (200, 10.0),
            (250, 10.0),
        ] {
            assert_eq!(curve.score(earned, 300), Some(expected));
            assert_eq!(curve.score(earned, 500), Some(expected));
        }
        assert_eq!(curve.score(0, 0), None);
    }

    #[test]
    fn legacy_percentage_scores_preserve_interpolation_and_clamps() {
        let curve = AchievementCurve::legacy_percentage_default();
        for (earned, expected) in [
            (0, 1.0),
            (5, 2.0),
            (10, 3.0),
            (25, 5.0),
            (50, 7.0),
            (65, 8.5),
            (80, 10.0),
            (100, 10.0),
        ] {
            assert_eq!(curve.score(earned, 100), Some(expected));
        }
        assert_eq!(curve.score(0, 0), None);
        let edited = AchievementCurve::LegacyPercentage {
            thresholds: [5.0, 20.0, 40.0, 60.0, 90.0],
        };
        assert_eq!(edited.score(0, 100), Some(1.0));
        assert_eq!(edited.score(90, 100), Some(10.0));
        assert_eq!(edited.score(100, 100), Some(10.0));
        assert_ne!(edited.score(25, 100), curve.score(25, 100));
    }

    #[test]
    fn curve_units_keep_closed_wire_shapes_and_independent_bounds() {
        let legacy = serde_json::json!({"thresholds": [0, 10, 25, 50, 80]});
        let points = serde_json::json!({"pointThresholds": [5, 10, 20, 30, 50, 75, 100, 150, 200]});
        for (value, expected) in [
            (legacy, AchievementCurve::legacy_percentage_default()),
            (points, AchievementCurve::default()),
        ] {
            let decoded = serde_json::from_value::<AchievementCurve>(value);
            assert_eq!(decoded.ok(), Some(expected));
            assert!(expected.is_valid());
            let round_trip =
                serde_json::to_value(expected).and_then(serde_json::from_value::<AchievementCurve>);
            assert_eq!(round_trip.ok(), Some(expected));
        }
        for invalid in [
            serde_json::json!({"thresholds": [0, 10, 25, 50, 80], "pointThresholds": [5, 10, 20, 30, 50, 75, 100, 150, 200]}),
            serde_json::json!({"pointThresholds": [0, 10, 25, 50, 80]}),
            serde_json::json!({"thresholds": [5, 10, 20, 30, 50, 75, 100, 150, 200]}),
            serde_json::json!({"pointThresholds": [5, 10, 20, 30, 50, 75, 100, 150, 200], "unit": "points"}),
        ] {
            assert!(serde_json::from_value::<AchievementCurve>(invalid).is_err());
        }
        for (index, invalid) in [
            (0, -1.0),
            (4, 30.0),
            (4, f64::NAN),
            (4, f64::INFINITY),
            (8, MAXIMUM_ACHIEVEMENT_POINTS + 1.0),
        ] {
            let mut point_thresholds = [5.0, 10.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0, 200.0];
            if let Some(threshold) = point_thresholds.get_mut(index) {
                *threshold = invalid;
            }
            assert!(!AchievementCurve::Points { point_thresholds }.is_valid());
        }
        assert!(
            AchievementCurve::LegacyPercentage {
                thresholds: [0.0, 10.0, 25.0, 50.0, 101.0],
            }
            .score(50, 100)
            .is_none()
        );
    }
}
