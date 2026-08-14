//! Classifies metric changes and comparison strength into contract signal vocabulary.

use crate::stats::sample_maturity;

pub(super) fn rank_spread_signal(spread: Option<f64>, match_count: usize) -> &'static str {
    let Some(spread) = spread else {
        return "insufficient";
    };
    let (flat, small, large) = if sample_maturity(match_count) == "mature" {
        (0.15, 0.25, 0.5)
    } else {
        (0.2, 0.35, 0.6)
    };
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
    let (slight_up, strong_up, slight_down, strong_down) = if mature {
        (0.52, 0.6, 0.48, 0.4)
    } else {
        (0.55, 0.65, 0.45, 0.35)
    };
    if better_rate.is_some_and(|value| value >= strong_up) {
        "strong_advantage"
    } else if better_rate.is_some_and(|value| value >= slight_up) {
        "slight_advantage"
    } else if better_rate.is_some_and(|value| value <= strong_down) {
        "strong_disadvantage"
    } else if better_rate.is_some_and(|value| value <= slight_down) {
        "slight_disadvantage"
    } else if mature && rank_diff.is_some_and(|value| value.abs() >= 0.25) {
        if rank_diff.unwrap_or(0.0) > 0.0 {
            "strong_advantage"
        } else {
            "strong_disadvantage"
        }
    } else {
        "neutral"
    }
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
