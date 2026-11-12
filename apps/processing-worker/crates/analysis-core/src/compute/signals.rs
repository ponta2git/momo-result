//! Classifies metric changes and comparison strength into contract signal vocabulary.
//!
//! Rank-based signals are calibrated against chance: the same statistic computed when every
//! match assigns ranks 1-4 to the four players uniformly at random. A weaker label requires a
//! value that chance reaches in about one of four scopes (P75), a stronger label one that chance
//! reaches in about one of ten (P90), and `flat` covers the lower half (P50). Each sample band
//! uses the quantiles at its reference size, 20 matches for early scopes and 50 (the mature
//! boundary) for mature scopes, so smaller scopes in a band are treated more permissively than
//! the reference and larger scopes more strictly.

use crate::stats::sample_maturity;

/// Chance-level cut points of one statistic for the early and mature sample bands.
#[derive(Clone, Copy)]
struct BandCuts<const N: usize> {
    early: [f64; N],
    mature: [f64; N],
}

impl<const N: usize> BandCuts<N> {
    fn for_count(self, match_count: usize) -> [f64; N] {
        if sample_maturity(match_count) == "mature" {
            self.mature
        } else {
            self.early
        }
    }
}

/// Spread between the best and worst average rank: P50, P75 and P90 under chance.
const RANK_SPREAD_CUTS: BandCuts<3> = BandCuts {
    early: [0.55, 0.75, 0.95],
    mature: [0.36, 0.48, 0.60],
};

/// Distance of the head-to-head better-rank rate from one half: P75 and P90 under chance.
const HEAD_TO_HEAD_RATE_CUTS: BandCuts<2> = BandCuts {
    early: [0.15, 0.20],
    mature: [0.08, 0.12],
};

/// Mature average rank difference that is strong even when the better-rank rate is neutral
/// (P90 under chance).
const HEAD_TO_HEAD_MATURE_RANK_DIFF: f64 = 0.42;

/// Spread between the best and worst play-order average rank: P75 and P90 under chance.
const PLAY_ORDER_SPREAD_CUTS: BandCuts<2> = BandCuts {
    early: [1.2, 1.6],
    mature: [0.85, 1.0],
};

/// Distance of a momentum rate from the player's own baseline: P90 under chance.
const MOMENTUM_DELTA_CUTS: BandCuts<1> = BandCuts {
    early: [0.19],
    mature: [0.12],
};

pub(super) fn rank_spread_signal(spread: Option<f64>, match_count: usize) -> &'static str {
    let Some(spread) = spread else {
        return "insufficient";
    };
    let [flat, small, large] = RANK_SPREAD_CUTS.for_count(match_count);
    if spread < flat {
        "flat"
    } else if spread < small {
        "small"
    } else if spread < large {
        "visible"
    } else {
        "large"
    }
}

pub(super) fn head_to_head_signal(
    match_count: usize,
    better_rate: Option<f64>,
    rank_diff: Option<f64>,
) -> &'static str {
    if match_count == 0 {
        return "no_target";
    }
    if match_count <= 2 {
        return "reference";
    }
    let mature = sample_maturity(match_count) == "mature";
    let [slight, strong] = HEAD_TO_HEAD_RATE_CUTS.for_count(match_count);
    let (slight_up, strong_up, slight_down, strong_down) =
        (0.5 + slight, 0.5 + strong, 0.5 - slight, 0.5 - strong);
    if better_rate.is_some_and(|value| value >= strong_up) {
        "strong_advantage"
    } else if better_rate.is_some_and(|value| value >= slight_up) {
        "slight_advantage"
    } else if better_rate.is_some_and(|value| value <= strong_down) {
        "strong_disadvantage"
    } else if better_rate.is_some_and(|value| value <= slight_down) {
        "slight_disadvantage"
    } else if mature && rank_diff.is_some_and(|value| value.abs() >= HEAD_TO_HEAD_MATURE_RANK_DIFF)
    {
        if rank_diff.unwrap_or(0.0) > 0.0 {
            "strong_advantage"
        } else {
            "strong_disadvantage"
        }
    } else {
        "neutral"
    }
}

pub(super) fn play_order_spread_signal(spread: Option<f64>, match_count: usize) -> &'static str {
    let Some(spread) = spread else {
        return "no_target";
    };
    let [visible, large] = PLAY_ORDER_SPREAD_CUTS.for_count(match_count);
    if spread >= large {
        "large"
    } else if spread >= visible {
        "visible"
    } else {
        "flat"
    }
}

/// Minimum distance from the baseline rate for a momentum strength or risk.
pub(super) fn momentum_signal_delta(match_count: usize) -> f64 {
    let [delta] = MOMENTUM_DELTA_CUTS.for_count(match_count);
    delta
}

pub(super) fn signal_intensity(signal: &str) -> &'static str {
    match signal {
        "strong_advantage" | "strong_disadvantage" => "high",
        "slight_advantage" | "slight_disadvantage" => "medium",
        "neutral" => "low",
        _ => "none",
    }
}

pub(super) fn relative_intensity(value: Option<f64>) -> &'static str {
    match value.map(f64::abs) {
        Some(value) if value >= 0.75 => "high",
        Some(value) if value >= 0.5 => "medium",
        Some(value) if value > 0.0 => "low",
        _ => "none",
    }
}

pub(super) fn change_direction(
    before: Option<f64>,
    after: f64,
    lower_is_better: bool,
) -> &'static str {
    before.map_or("first_observation", |before| {
        let delta = after - before;
        if delta.abs() < 1e-12 {
            "unchanged"
        } else if (delta < 0.0) == lower_is_better {
            "improved"
        } else {
            "declined"
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rank_signal_cut_points_switch_at_the_mature_boundary() {
        assert_eq!(rank_spread_signal(None, 50), "insufficient");
        for (spread, count, expected) in [
            (0.54, 49, "flat"),
            (0.55, 49, "small"),
            (0.75, 49, "visible"),
            (0.95, 49, "large"),
            (0.35, 50, "flat"),
            (0.36, 50, "small"),
            (0.48, 50, "visible"),
            (0.60, 50, "large"),
        ] {
            assert_eq!(
                rank_spread_signal(Some(spread), count),
                expected,
                "{spread} / {count}"
            );
        }

        for (count, rate, rank_diff, expected) in [
            (2, Some(1.0), Some(3.0), "reference"),
            (49, Some(0.64), None, "neutral"),
            (49, Some(0.65), None, "slight_advantage"),
            (49, Some(0.70), None, "strong_advantage"),
            (49, Some(0.30), None, "strong_disadvantage"),
            (49, Some(0.50), Some(1.0), "neutral"),
            (50, Some(0.57), None, "neutral"),
            (50, Some(0.58), None, "slight_advantage"),
            (50, Some(0.42), None, "slight_disadvantage"),
            (50, Some(0.62), None, "strong_advantage"),
            (50, Some(0.50), Some(0.41), "neutral"),
            (50, Some(0.50), Some(-0.42), "strong_disadvantage"),
        ] {
            assert_eq!(
                head_to_head_signal(count, rate, rank_diff),
                expected,
                "{count} / {rate:?} / {rank_diff:?}"
            );
        }

        assert_eq!(play_order_spread_signal(None, 50), "no_target");
        for (spread, count, expected) in [
            (1.19, 49, "flat"),
            (1.2, 49, "visible"),
            (1.6, 49, "large"),
            (0.84, 50, "flat"),
            (0.85, 50, "visible"),
            (1.0, 50, "large"),
        ] {
            assert_eq!(
                play_order_spread_signal(Some(spread), count),
                expected,
                "{spread} / {count}"
            );
        }

        assert!((momentum_signal_delta(49) - 0.19).abs() < f64::EPSILON);
        assert!((momentum_signal_delta(50) - 0.12).abs() < f64::EPSILON);
    }
}
