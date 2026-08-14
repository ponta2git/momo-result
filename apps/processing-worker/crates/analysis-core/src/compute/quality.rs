use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    model::MatchPlayerRow,
    rankings::{MatchPlayerRanks, value as rank_value},
    stats::{average, quality_status, rate},
};

pub(super) fn highlights(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
) -> Vec<Value> {
    let metrics = [
        ("rank.average", false),
        ("assets.average", true),
        ("revenue.average", true),
        ("podium.rate", true),
    ];
    metrics
        .into_iter()
        .filter_map(|(metric_id, larger_is_better)| {
            let values = players.iter().filter_map(|member_id| {
                let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
                let value = match metric_id {
                    "rank.average" => average(rows.iter().map(|row| f64::from(row.rank))),
                    "assets.average" => average(rows.iter().map(|row| f64::from(row.total_assets_man_yen))),
                    "revenue.average" => average(rows.iter().map(|row| f64::from(row.revenue_man_yen))),
                    _ => rate(rows.iter().filter(|row| row.rank <= 2).count(), rows.len()),
                };
                value.map(|value| (member_id, value, rows.len()))
            }).collect::<Vec<_>>();
            if values.is_empty() { return None; }
            let best = if larger_is_better { values.iter().map(|value| value.1).fold(f64::NEG_INFINITY, f64::max) } else { values.iter().map(|value| value.1).fold(f64::INFINITY, f64::min) };
            Some(json!({
                "highlightId": format!("highlight:{metric_id}"),
                "metricId": metric_id,
                "leaderMemberIds": values.iter().filter(|value| (value.1 - best).abs() < 1e-12).map(|value| value.0).collect::<Vec<_>>(),
                "value": best,
                "targetCount": values.iter().map(|value| value.2).min().unwrap_or(0),
                "qualityStatus": quality_status(values.iter().map(|value| value.2).min().unwrap_or(0)),
            }))
        })
        .collect()
}

pub(super) fn data_quality(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
    revenue_ranks: &MatchPlayerRanks<'_>,
    destination_ranks: &MatchPlayerRanks<'_>,
) -> Vec<Value> {
    let metric_ids = [
        "rank.average",
        "rank.distribution",
        "assets.average",
        "revenue.average",
        "podium.rate",
        "ginji.encounterRate",
        "destination.conversionDelta",
        "revenueOutcome.topWinRate",
    ];
    players
        .iter()
        .flat_map(|member_id| {
            let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
            metric_ids.into_iter().map(move |metric_id| {
                let target_count = if metric_id == "revenueOutcome.topWinRate" {
                    rows.iter()
                        .filter(|row| {
                            rank_value(revenue_ranks, row).is_some_and(|rank| rank <= 1.5)
                        })
                        .count()
                } else {
                    rows.len()
                };
                let has_ties = if metric_id.starts_with("revenue") {
                    revenue_ranks.values().any(|rank| rank.fract() != 0.0)
                } else if metric_id.starts_with("destination") {
                    destination_ranks.values().any(|rank| rank.fract() != 0.0)
                } else {
                    false
                };
                json!({
                    "metricId": metric_id,
                    "memberId": member_id,
                    "denominator": rows.len(),
                    "targetCount": target_count,
                    "qualityStatus": quality_status(target_count),
                    "hasTies": has_ties,
                })
            })
        })
        .collect()
}

pub(super) fn quality_summary(items: &[Value]) -> Value {
    let count = |status: &str| {
        items
            .iter()
            .filter(|item| item.get("qualityStatus").and_then(Value::as_str) == Some(status))
            .count()
    };
    json!({ "okCount": count("ok"), "referenceCount": count("reference"), "noTargetCount": count("no_target") })
}

pub(super) fn metric_definitions() -> Vec<Value> {
    [
        ("rank.average", "平均順位", "rank", "lower"),
        ("rank.distribution", "順位分布", "count", "contextual"),
        ("assets.average", "平均総資産", "man_yen", "higher"),
        ("revenue.average", "平均物件収益", "man_yen", "higher"),
        ("podium.rate", "入賞率", "rate", "higher"),
        ("ginji.encounterRate", "銀次遭遇率", "rate", "lower"),
        ("destination.conversionDelta", "目的地順位と最終順位の差", "rank", "higher"),
    ].into_iter().map(|(metric_id, label, unit, direction)| json!({ "metricId": metric_id, "label": label, "unit": unit, "preferredDirection": direction })).collect()
}
