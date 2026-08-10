use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    model::{MatchPlayerRow, Scope},
    stats::{quality_status, rate, sample_maturity},
};

pub(super) fn evidence(
    metric_id: &str,
    unit: &str,
    value: Option<f64>,
    denominator: Option<usize>,
) -> Value {
    json!({ "metricId": metric_id, "unit": unit, "value": value, "denominator": denominator, "qualityStatus": denominator.map_or("ok", quality_status) })
}

pub(super) fn scope_json(scope: &Scope, match_count: usize) -> Value {
    let mut value = scope.json_value();
    if let Some(object) = value.as_object_mut() {
        object.insert("matchCount".into(), json!(match_count));
    }
    value
}

pub(super) fn player_json(member_id: &str, _rows: &[&MatchPlayerRow]) -> Value {
    json!({ "memberId": member_id })
}

pub(super) struct MatchGroup<'a> {
    pub(super) match_id: &'a str,
    pub(super) match_revision: i64,
    pub(super) played_at: &'a str,
    pub(super) held_event_id: &'a str,
    pub(super) match_no_in_event: i32,
    pub(super) rows: Vec<&'a MatchPlayerRow>,
}

pub(super) fn match_groups<'a>(rows: &[&'a MatchPlayerRow]) -> Vec<MatchGroup<'a>> {
    let mut groups = Vec::<MatchGroup<'a>>::new();
    for row in rows {
        match groups.last_mut() {
            Some(group) if group.match_id == row.match_id => group.rows.push(row),
            _ => groups.push(MatchGroup {
                match_id: row.match_id.as_str(),
                match_revision: row.match_revision,
                played_at: row.played_at.as_str(),
                held_event_id: row.held_event_id.as_str(),
                match_no_in_event: row.match_no_in_event,
                rows: vec![row],
            }),
        }
    }
    groups
}

pub(super) fn maxima_by_match<'a>(
    rows: &[&'a MatchPlayerRow],
    value: impl Fn(&MatchPlayerRow) -> i32,
) -> BTreeMap<&'a str, i32> {
    let mut result = BTreeMap::<&str, i32>::new();
    for row in rows {
        result
            .entry(row.match_id.as_str())
            .and_modify(|maximum| *maximum = (*maximum).max(value(row)))
            .or_insert_with(|| value(row));
    }
    result
}

pub(super) fn distribution(rows: &[&MatchPlayerRow]) -> Vec<Value> {
    (1..=4)
        .map(|rank_value| {
            let count = rows.iter().filter(|row| row.rank == rank_value).count();
            json!({ "rank": rank_value, "count": count, "rate": rate(count, rows.len()) })
        })
        .collect()
}

pub(super) fn revenue_asset_rate(row: &MatchPlayerRow) -> Option<f64> {
    (row.total_assets_man_yen > 0)
        .then(|| f64::from(row.revenue_man_yen) / f64::from(row.total_assets_man_yen))
}

pub(super) fn suffix_count(
    rows: &[&MatchPlayerRow],
    predicate: impl Fn(&MatchPlayerRow) -> bool,
) -> usize {
    rows.iter().rev().take_while(|row| predicate(row)).count()
}

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
