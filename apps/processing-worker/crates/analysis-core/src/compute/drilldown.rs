//! Builds the four per-player drilldown resource payloads without owning resource ordering.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    contract::ScopeRef,
    model::PlayerMatchInput,
    numeric::count_as_f64,
    outcome_model::OutcomeModelAnalysis,
    stats::{average, quality_status, rate},
};

use super::support::{change_direction, distribution, member_ref_json, scope_json};

pub(super) fn build(
    scope: &ScopeRef,
    member_matches: &[&PlayerMatchInput],
    match_count: usize,
    member_id: &str,
    metric_id: &str,
    outcome_model: &OutcomeModelAnalysis,
) -> Value {
    let payload = match metric_id {
        "rank.averageHistory" => rank_history_payload(member_matches),
        "playOrder.rankHistory" => play_order_history_payload(member_matches),
        "rankAnalysis.rankSignals" => outcome_model.signal_drilldown_json(member_id),
        _ => outcome_model.unexpected_wins_drilldown_json(member_id),
    };
    json!({
        "schemaVersion": 2,
        "scope": scope_json(scope, match_count),
        "player": member_ref_json(member_id),
        "payload": payload,
    })
}

fn rank_history_payload(rows: &[&PlayerMatchInput]) -> Value {
    let mut rank_sum = 0.0;
    let mut rank_count = 0_usize;
    let mut previous_rank = None;
    let match_rows = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let before = average_total(rank_sum, rank_count);
            rank_sum += f64::from(row.rank);
            rank_count = rank_count.saturating_add(1);
            let after = average_total(rank_sum, rank_count).unwrap_or_else(|| f64::from(row.rank));
            let previous_rank = previous_rank.replace(row.rank);
            json!({
                "itemId": format!("rank-history:{}", row.match_id),
                "matchIndex": index + 1,
                "matchId": row.match_id,
                "playedAt": row.played_at,
                "heldEventId": row.held_event_id,
                "matchNoInEvent": row.match_no_in_event,
                "rank": row.rank,
                "previousRank": previous_rank,
                "rankDelta": previous_rank.map(|previous| row.rank - previous),
                "cumulativeAverageRank": after,
                "cumulativeAverageRankDelta": before.map(|before| after - before),
                "changeDirection": change_direction(before, after, true),
            })
        })
        .collect::<Vec<_>>();
    let current = average_total(rank_sum, rank_count);
    json!({
        "kind": "rank_average_history",
        "summary": { "targetCount": rows.len(), "currentAverageRank": current, "qualityStatus": quality_status(rows.len()) },
        "matchRows": match_rows,
        "eventRows": event_rank_rows(rows),
    })
}

fn play_order_history_payload(rows: &[&PlayerMatchInput]) -> Value {
    let mut by_order = BTreeMap::<i32, (f64, usize)>::new();
    let series = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let (sum, count) = by_order.entry(row.play_order).or_default();
            let previous = average_total(*sum, *count);
            *sum += f64::from(row.rank);
            *count = count.saturating_add(1);
            let current = average_total(*sum, *count).unwrap_or_else(|| f64::from(row.rank));
            json!({
                "itemId": format!("play-order-history:{}", row.match_id),
                "matchIndex": index + 1,
                "matchId": row.match_id,
                "playedAt": row.played_at,
                "heldEventId": row.held_event_id,
                "matchNoInEvent": row.match_no_in_event,
                "playOrder": row.play_order,
                "rank": row.rank,
                "occurrenceIndex": *count,
                "cumulativeAverageRank": current,
                "previousCumulativeAverageRank": previous,
                "changeDirection": change_direction(previous, current, true),
            })
        })
        .collect::<Vec<_>>();
    let rows_by_order = (1..=4)
        .map(|order| {
            let target = rows
                .iter()
                .copied()
                .filter(|row| row.play_order == order)
                .collect::<Vec<_>>();
            json!({
                "playOrder": order,
                "targetCount": target.len(),
                "rankAverage": average(target.iter().map(|row| f64::from(row.rank))),
                "rankDistribution": distribution(&target),
                "podiumRate": rate(target.iter().filter(|row| row.rank <= 2).count(), target.len()),
                "lowerHalfRate": rate(target.iter().filter(|row| row.rank >= 3).count(), target.len()),
                "qualityStatus": quality_status(target.len()),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "kind": "play_order_rank_history",
        "summary": { "targetCount": rows.len(), "currentAverageRank": average(rows.iter().map(|row| f64::from(row.rank))), "qualityStatus": quality_status(rows.len()) },
        "seriesByPlayOrder": series,
        "rows": rows_by_order,
    })
}

pub(super) fn event_rank_rows(rows: &[&PlayerMatchInput]) -> Vec<Value> {
    let mut event_order = Vec::<&str>::new();
    let mut events = BTreeMap::<&str, Vec<&PlayerMatchInput>>::new();
    for row in rows {
        let event_id = row.held_event_id.as_str();
        match events.entry(event_id) {
            std::collections::btree_map::Entry::Occupied(mut entry) => entry.get_mut().push(row),
            std::collections::btree_map::Entry::Vacant(entry) => {
                event_order.push(event_id);
                entry.insert(vec![row]);
            }
        }
    }
    let mut previous: Option<f64> = None;
    let mut cumulative_sum = 0.0;
    let mut cumulative_count = 0_usize;
    event_order
        .into_iter()
        .filter_map(|event_id| {
            events
                .remove(event_id)
                .map(|event_rows| (event_id, event_rows))
        })
        .map(|(held_event_id, event_rows)| {
            let ranks = event_rows.iter().map(|row| row.rank).collect::<Vec<_>>();
            let event_sum = ranks.iter().map(|rank| f64::from(*rank)).sum::<f64>();
            let event_average = average_total(event_sum, ranks.len()).unwrap_or(0.0);
            let before = average_total(cumulative_sum, cumulative_count);
            cumulative_sum += event_sum;
            cumulative_count = cumulative_count.saturating_add(ranks.len());
            let after = average_total(cumulative_sum, cumulative_count).unwrap_or(event_average);
            let event_delta = previous.map(|previous| event_average - previous);
            previous = Some(event_average);
            json!({
                "heldEventId": held_event_id,
                "firstPlayedAt": event_rows.first().map(|row| &row.played_at),
                "matchCount": event_rows.len(),
                "ranks": ranks,
                "eventAverageRank": event_average,
                "eventAverageRankDelta": event_delta,
                "cumulativeAverageBefore": before,
                "cumulativeAverageAfter": after,
                "changeDirection": change_direction(before, after, true),
            })
        })
        .collect()
}

fn average_total(total: f64, count: usize) -> Option<f64> {
    count_as_f64(count)
        .filter(|value| *value > 0.0)
        .map(|value| total / value)
}
