use serde::{Deserialize, Serialize};

/// Fixed radar scores corresponding to the five entered achievement percentages.
pub const ACHIEVEMENT_SCORE_POINTS: [f64; 5] = [1.0, 3.0, 5.0, 7.0, 10.0];

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementCurve {
    /// Achievement percentages, ordered by the fixed scores 1, 3, 5, 7 and 10.
    pub thresholds: [f64; 5],
}

impl Default for AchievementCurve {
    fn default() -> Self {
        Self {
            thresholds: [0.0, 10.0, 25.0, 50.0, 80.0],
        }
    }
}

impl AchievementCurve {
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.thresholds
            .iter()
            .all(|value| value.is_finite() && (0.0..=100.0).contains(value))
            && self
                .thresholds
                .iter()
                .zip(self.thresholds.iter().skip(1))
                .all(|(left, right)| left < right)
    }

    /// Interpolates between explicit points and clamps values outside the entered range.
    #[must_use]
    pub fn score(&self, earned_points: u32, total_points: u32) -> Option<f64> {
        if total_points == 0 || !self.is_valid() {
            return None;
        }
        let percentage = 100.0 * f64::from(earned_points) / f64::from(total_points);
        let points = self.thresholds.into_iter().zip(ACHIEVEMENT_SCORE_POINTS);
        let mut previous: Option<(f64, f64)> = None;
        for (threshold, score) in points {
            if percentage <= threshold {
                return Some(previous.map_or(score, |(lower, lower_score)| {
                    ((percentage - lower) / (threshold - lower))
                        .mul_add(score - lower_score, lower_score)
                }));
            }
            previous = Some((threshold, score));
        }
        Some(10.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn achievement_scores_use_the_entered_points_interpolation_and_clamps() {
        let curve = AchievementCurve::default();
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
        let edited = AchievementCurve {
            thresholds: [5.0, 20.0, 40.0, 60.0, 90.0],
        };
        assert_eq!(edited.score(0, 100), Some(1.0));
        assert_eq!(edited.score(90, 100), Some(10.0));
        assert_eq!(edited.score(100, 100), Some(10.0));
        assert_ne!(edited.score(25, 100), curve.score(25, 100));
    }

    #[test]
    fn achievement_curve_requires_five_finite_ordered_percentages() {
        for thresholds in [
            [-1.0, 10.0, 25.0, 50.0, 80.0],
            [0.0, 10.0, 25.0, 50.0, 101.0],
            [0.0, 25.0, 25.0, 50.0, 80.0],
            [0.0, 30.0, 25.0, 50.0, 80.0],
            [0.0, f64::NAN, 25.0, 50.0, 80.0],
        ] {
            assert!(!AchievementCurve { thresholds }.is_valid());
        }
    }
}
