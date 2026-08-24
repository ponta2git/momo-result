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

use super::{
    metrics::rank_distribution_cells,
    presentation::{member_ref_json, scope_summary_json},
    signals::change_direction,
};

struct EventRankHistory {
    rows: Vec<Value>,
    latest_cumulative_average_delta: Option<f64>,
}

struct PlayOrderBreakdown {
    play_order: i32,
    target_count: usize,
    rank_average: Option<f64>,
    rank_distribution: Vec<Value>,
    podium_count: usize,
    lower_half_count: usize,
    baseline_rank_average: Option<f64>,
}

impl PlayOrderBreakdown {
    fn to_json(&self) -> Value {
        json!({
            "playOrder": self.play_order,
            "targetCount": self.target_count,
            "rankAverage": self.rank_average,
            "rankDistribution": self.rank_distribution,
            "podiumCount": self.podium_count,
            "podiumRate": rate(self.podium_count, self.target_count),
            "lowerHalfCount": self.lower_half_count,
            "lowerHalfRate": rate(self.lower_half_count, self.target_count),
            "baselineRankAverage": self.baseline_rank_average,
            "baselineDelta": self.rank_average.zip(self.baseline_rank_average).map(|(rank, baseline)| rank - baseline),
            "qualityStatus": quality_status(self.target_count),
        })
    }
}

pub(super) fn build(
    scope: &ScopeRef,
    member_matches: &[&PlayerMatchInput],
    all_scope_matches: &[&PlayerMatchInput],
    match_count: usize,
    member_id: &str,
    metric_id: &str,
    outcome_model: &OutcomeModelAnalysis,
) -> Value {
    let payload = match metric_id {
        "rank.averageHistory" => rank_history_payload(member_matches),
        "playOrder.rankHistory" => play_order_history_payload(member_matches, all_scope_matches),
        "rankAnalysis.rankSignals" => outcome_model.signal_drilldown_json(member_id),
        _ => outcome_model.unexpected_wins_drilldown_json(member_id),
    };
    json!({
        "schemaVersion": 3,
        "scope": scope_summary_json(scope, match_count),
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
    let average_rank_delta_from_first = rows
        .first()
        .map(|row| f64::from(row.rank))
        .zip(current)
        .filter(|_| match_rows.len() >= 2)
        .map(|(first, current)| current - first);
    let event_history = event_rank_history(rows);
    json!({
        "kind": "rank_average_history",
        "summary": {
            "targetCount": rows.len(),
            "currentAverageRank": current,
            "averageRankDeltaFromFirst": average_rank_delta_from_first,
            "latestHeldEventAverageRankDelta": event_history.latest_cumulative_average_delta,
            "qualityStatus": quality_status(rows.len()),
        },
        "matchRows": match_rows,
        "eventRows": event_history.rows,
    })
}

fn play_order_history_payload(
    rows: &[&PlayerMatchInput],
    all_scope_rows: &[&PlayerMatchInput],
) -> Value {
    let series = play_order_series(rows);
    let rows_by_order = play_order_breakdown(rows, all_scope_rows);
    let summary = play_order_summary(rows, &rows_by_order);
    let rows_by_order = rows_by_order
        .iter()
        .map(PlayOrderBreakdown::to_json)
        .collect::<Vec<_>>();
    json!({
        "kind": "play_order_rank_history",
        "summary": summary,
        "seriesByPlayOrder": series,
        "rows": rows_by_order,
    })
}

fn play_order_series(rows: &[&PlayerMatchInput]) -> Vec<Value> {
    let mut by_order = BTreeMap::<i32, (f64, usize)>::new();
    rows.iter()
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
        .collect()
}

fn play_order_breakdown(
    rows: &[&PlayerMatchInput],
    all_scope_rows: &[&PlayerMatchInput],
) -> Vec<PlayOrderBreakdown> {
    let mut rows_by_order: [Vec<&PlayerMatchInput>; 4] = std::array::from_fn(|_| Vec::new());
    let mut baseline_rank_totals = [0.0_f64; 4];
    let mut baseline_counts = [0_usize; 4];
    for row in rows {
        if let Some(target) =
            play_order_index(row.play_order).and_then(|index| rows_by_order.get_mut(index))
        {
            target.push(row);
        }
    }
    for row in all_scope_rows {
        if let Some(index) = play_order_index(row.play_order) {
            let total = baseline_rank_totals.get_mut(index);
            let count = baseline_counts.get_mut(index);
            if let (Some(total), Some(count)) = (total, count) {
                *total += f64::from(row.rank);
                *count = count.saturating_add(1);
            }
        }
    }
    rows_by_order
        .into_iter()
        .zip(baseline_rank_totals)
        .zip(baseline_counts)
        .enumerate()
        .map(|(index, ((target, baseline_rank_total), baseline_count))| {
            let target_count = target.len();
            let podium_count = target.iter().filter(|row| row.rank <= 2).count();
            let lower_half_count = target.iter().filter(|row| row.rank >= 3).count();
            PlayOrderBreakdown {
                play_order: i32::try_from(index).map_or(1, |value| value + 1),
                target_count,
                rank_average: average(target.iter().map(|row| f64::from(row.rank))),
                rank_distribution: rank_distribution_cells(&target),
                podium_count,
                lower_half_count,
                baseline_rank_average: average_total(baseline_rank_total, baseline_count),
            }
        })
        .collect()
}

fn play_order_summary(rows: &[&PlayerMatchInput], rows_by_order: &[PlayOrderBreakdown]) -> Value {
    let ranked_rows = rows_by_order
        .iter()
        .filter_map(|row| row.rank_average.map(|average| (row, average)))
        .collect::<Vec<_>>();
    let best_entry = ranked_rows
        .iter()
        .min_by(|left, right| left.1.total_cmp(&right.1));
    let worst_entry = ranked_rows
        .iter()
        .max_by(|left, right| left.1.total_cmp(&right.1));
    let best_play_order = best_entry.map(|(row, _)| row.play_order);
    let best_play_order_average_rank = best_entry.map(|(_, average)| *average);
    let worst_play_order = worst_entry.map(|(row, _)| row.play_order);
    let worst_play_order_average_rank = worst_entry.map(|(_, average)| *average);
    let spread = best_play_order_average_rank
        .zip(worst_play_order_average_rank)
        .filter(|_| ranked_rows.len() >= 2)
        .map(|(best_average, worst_average)| worst_average - best_average);
    json!({
        "targetCount": rows.len(),
        "currentAverageRank": average(rows.iter().map(|row| f64::from(row.rank))),
        "bestPlayOrder": best_play_order,
        "bestPlayOrderAverageRank": best_play_order_average_rank,
        "worstPlayOrder": worst_play_order,
        "worstPlayOrderAverageRank": worst_play_order_average_rank,
        "spread": spread,
        "countsByPlayOrder": (1..=4).map(|order| json!({
            "playOrder": order,
            "matchCount": rows.iter().filter(|row| row.play_order == order).count(),
        })).collect::<Vec<_>>(),
        "qualityStatus": quality_status(rows.len()),
    })
}

fn play_order_index(play_order: i32) -> Option<usize> {
    usize::try_from(play_order.checked_sub(1)?)
        .ok()
        .filter(|index| *index < 4)
}

#[cfg(test)]
pub(super) fn event_rank_rows(rows: &[&PlayerMatchInput]) -> Vec<Value> {
    event_rank_history(rows).rows
}

fn event_rank_history(rows: &[&PlayerMatchInput]) -> EventRankHistory {
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
    let rows_with_delta = event_order
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
            let event_rank_delta = ranks
                .first()
                .zip(ranks.last())
                .filter(|_| ranks.len() >= 2)
                .map(|(first, last)| last - first);
            let cumulative_average_delta = before.map(|before| after - before);
            (
                json!({
                    "heldEventId": held_event_id,
                    "firstPlayedAt": event_rows.first().map(|row| &row.played_at),
                    "matchCount": event_rows.len(),
                    "ranks": ranks,
                    "eventAverageRank": event_average,
                    "eventAverageRankDelta": event_delta,
                    "eventRankDelta": event_rank_delta,
                    "cumulativeAverageBefore": before,
                    "cumulativeAverageAfter": after,
                    "cumulativeAverageDelta": cumulative_average_delta,
                    "changeDirection": change_direction(before, after, true),
                }),
                cumulative_average_delta,
            )
        })
        .collect::<Vec<_>>();
    let latest_cumulative_average_delta = rows_with_delta.last().and_then(|(_, delta)| *delta);
    EventRankHistory {
        rows: rows_with_delta.into_iter().map(|(row, _)| row).collect(),
        latest_cumulative_average_delta,
    }
}

fn average_total(total: f64, count: usize) -> Option<f64> {
    count_as_f64(count)
        .filter(|value| *value > 0.0)
        .map(|value| total / value)
}
