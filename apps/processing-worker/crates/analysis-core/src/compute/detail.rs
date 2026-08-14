use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::{
    competition_rank::{
        calculate_by_match as competition_ranks_by_match, rank_for as competition_rank_for,
    },
    contract::ScopeRef,
    model::{PlayerMatchInput, PlayerMatchesByMember},
    numeric::count_as_f64,
    outcome_model::OutcomeModelAnalysis,
    stats::{average, quality_status, rate},
};

use super::support::{
    change_direction, distribution, evidence, member_ref_json, revenue_asset_rate, scope_json,
};

pub(super) fn review(
    scope: &ScopeRef,
    rows: &[&PlayerMatchInput],
    players: &[String],
    player_matches_by_member: &PlayerMatchesByMember<'_>,
    data_quality: Option<Value>,
) -> Value {
    crate::playbook::build(scope, rows, players, player_matches_by_member, data_quality)
}

pub(super) fn drilldown(
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

#[derive(Clone, Copy)]
struct PlayerMatchHistory {
    previous_rank: Option<i32>,
    cumulative_average_before: Option<f64>,
    cumulative_average_after: f64,
}

pub(super) struct MatchContextIndex<'a> {
    match_count: usize,
    player_history: BTreeMap<(&'a str, &'a str), PlayerMatchHistory>,
}

pub(super) struct AggregateItemIds(BTreeSet<String>);

impl AggregateItemIds {
    pub(super) fn from_aggregate(aggregate: &Value) -> Self {
        let mut item_ids = BTreeSet::new();
        collect_item_ids(aggregate, &mut item_ids);
        Self(item_ids)
    }

    fn contains(&self, item_id: &str) -> bool {
        self.0.contains(item_id)
    }
}

fn collect_item_ids(node: &Value, item_ids: &mut BTreeSet<String>) {
    match node {
        Value::Array(values) => {
            for child in values {
                collect_item_ids(child, item_ids);
            }
        }
        Value::Object(object) => {
            if let Some(item_id) = object.get("itemId").and_then(Value::as_str) {
                item_ids.insert(String::from(item_id));
            }
            for child in object.values() {
                collect_item_ids(child, item_ids);
            }
        }
        Value::Bool(_) | Value::Null | Value::Number(_) | Value::String(_) => {}
    }
}

impl<'a> MatchContextIndex<'a> {
    pub(super) fn new(rows: &[&'a PlayerMatchInput]) -> Self {
        let mut match_ids = BTreeSet::new();
        let mut player_history = BTreeMap::new();
        let mut running = BTreeMap::<&str, (f64, f64, Option<i32>)>::new();
        for row in rows {
            match_ids.insert(row.match_id.as_str());
            let state = running
                .entry(row.member_id.as_str())
                .or_insert((0.0, 0.0, None));
            let before = (state.1 > 0.0).then(|| state.0 / state.1);
            state.0 += f64::from(row.rank);
            state.1 += 1.0;
            let after = state.0 / state.1;
            player_history.insert(
                (row.match_id.as_str(), row.member_id.as_str()),
                PlayerMatchHistory {
                    previous_rank: state.2,
                    cumulative_average_before: before,
                    cumulative_average_after: after,
                },
            );
            state.2 = Some(row.rank);
        }
        Self {
            match_count: match_ids.len(),
            player_history,
        }
    }
}

pub(super) fn match_context(
    scope: &ScopeRef,
    group: &[&PlayerMatchInput],
    index: &MatchContextIndex<'_>,
    aggregate_item_ids: &AggregateItemIds,
    match_id: &str,
    match_index: usize,
) -> Value {
    let revenue_ranks = competition_ranks_by_match(group, |row| row.revenue_man_yen);
    let mut ordered_group = group.to_vec();
    ordered_group.sort_by(|left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| left.member_id.cmp(&right.member_id))
    });
    let players = ordered_group
        .iter()
        .map(|row| {
            let history = index
                .player_history
                .get(&(row.match_id.as_str(), row.member_id.as_str()))
                .copied()
                .unwrap_or_else(|| PlayerMatchHistory {
                    previous_rank: None,
                    cumulative_average_before: None,
                    cumulative_average_after: f64::from(row.rank),
                });
            let before = history.cumulative_average_before;
            let after = history.cumulative_average_after;
            json!({
                "memberId": row.member_id,
                "rank": row.rank,
                "totalAssetsManYen": row.total_assets_man_yen,
                "revenueManYen": row.revenue_man_yen,
                "revenueRank": competition_rank_for(&revenue_ranks, row),
                "revenueAssetRate": revenue_asset_rate(row),
                "previousRank": history.previous_rank,
                "cumulativeAverageBefore": before,
                "cumulativeAverageAfter": after,
                "cumulativeAverageDelta": before.map(|before| after - before),
                "cumulativeAverageDirection": change_direction(before, after, true),
            })
        })
        .collect::<Vec<_>>();
    let focused = ordered_group
        .iter()
        .flat_map(|row| {
            let history = index
                .player_history
                .get(&(row.match_id.as_str(), row.member_id.as_str()));
            let revenue_rank = competition_rank_for(&revenue_ranks, row).and_then(|rank| {
                (1..=4).find(|expected| (rank - f64::from(*expected)).abs() < f64::EPSILON)
            });
            let mut item_ids = vec![
                format!("rank-distribution:{}:{}", row.member_id, row.rank),
                format!("play-order:{}:{}", row.member_id, row.play_order),
                format!("recent-rank:{}:{}", row.member_id, row.match_id),
                format!("strategy-point:{}:{}", row.match_id, row.member_id),
            ];
            if let Some(revenue_rank) = revenue_rank {
                item_ids.push(format!(
                    "revenue-rank:{}:{revenue_rank}:{}",
                    row.member_id, row.rank
                ));
            }
            if let Some(previous_rank) = history.and_then(|value| value.previous_rank) {
                item_ids.push(format!(
                    "momentum:{}:{previous_rank}:{}",
                    row.member_id, row.rank
                ));
            }
            let card_shop_kind = match (row.incidents.destination > 0, row.incidents.card_shop > 0)
            {
                (true, true) => "destination_with_shop",
                (true, false) => "destination_without_shop",
                (false, true) => "no_destination_with_shop",
                (false, false) => "no_destination_without_shop",
            };
            item_ids.push(format!("card-shop:{}:{card_shop_kind}", row.member_id));
            for kind in [
                "rank_cumulative_average",
                "rank_cumulative_standard_deviation",
                "podium_cumulative_rate",
                "lower_half_cumulative_rate",
                "ginji_cumulative_count",
            ] {
                item_ids.push(format!("trend:{kind}:{}:{}", row.member_id, row.match_id));
            }
            item_ids
        })
        .chain(std::iter::once(format!("match:{match_id}")))
        .filter(|item_id| aggregate_item_ids.contains(item_id))
        .collect::<Vec<_>>();
    json!({
        "schemaVersion": 1,
        "scope": scope_json(scope, index.match_count),
        "matchId": match_id,
        "sourceMatchRevision": group.first().map_or(0, |row| row.match_revision).to_string(),
        "match": {
            "matchIndex": match_index,
            "playedAt": group.first().map(|row| &row.played_at),
            "players": players,
            "focusedItemIds": focused,
            "features": match_features(group),
        },
    })
}

fn match_features(group: &[&PlayerMatchInput]) -> Vec<Value> {
    let winner = group.iter().copied().find(|row| row.rank == 1);
    let second = group.iter().copied().find(|row| row.rank == 2);
    let last = group.iter().copied().find(|row| row.rank == 4);
    let max_revenue = group.iter().map(|row| row.revenue_man_yen).max();
    let mut features = asset_gap_features(winner, second, last);
    let revenue_no_win = group
        .iter()
        .filter(|row| max_revenue == Some(row.revenue_man_yen) && row.rank != 1)
        .map(|row| row.member_id.clone())
        .collect::<Vec<_>>();
    if !revenue_no_win.is_empty() {
        features.push((
            30,
            feature(
                "revenue_top_no_win",
                "match",
                30,
                "notice",
                revenue_no_win,
                vec![],
            ),
        ));
    }
    let ginji_total = group
        .iter()
        .map(|row| i64::from(row.incidents.suri_no_ginji))
        .sum::<i64>();
    let ginji_value = group
        .iter()
        .map(|row| f64::from(row.incidents.suri_no_ginji))
        .sum::<f64>();
    if ginji_total >= 2 {
        features.push((
            40,
            feature(
                "ginji_storm",
                "match",
                40,
                "notice",
                group
                    .iter()
                    .filter(|row| row.incidents.suri_no_ginji > 0)
                    .map(|row| row.member_id.clone())
                    .collect(),
                vec![evidence("ginji.count", "count", Some(ginji_value), None)],
            ),
        ));
    }
    push_member_condition_feature(
        &mut features,
        group,
        50,
        "negative_assets",
        "notice",
        |row| row.total_assets_man_yen < 0,
    );
    push_member_condition_feature(
        &mut features,
        group,
        60,
        "no_destination",
        "neutral",
        |row| row.incidents.destination == 0,
    );
    features.sort_by_key(|value| value.0);
    features.into_iter().take(6).map(|value| value.1).collect()
}

fn asset_gap_features(
    winner: Option<&PlayerMatchInput>,
    second: Option<&PlayerMatchInput>,
    last: Option<&PlayerMatchInput>,
) -> Vec<(i32, Value)> {
    let mut features = Vec::new();
    if winner.zip(second).is_some_and(|(winner, second)| {
        i64::from(winner.total_assets_man_yen) - i64::from(second.total_assets_man_yen) <= 5_000
    }) {
        features.push((
            10,
            feature("close_finish", "match", 10, "neutral", vec![], vec![]),
        ));
    }
    if winner.zip(last).is_some_and(|(winner, last)| {
        i64::from(winner.total_assets_man_yen) - i64::from(last.total_assets_man_yen) >= 100_000
    }) {
        features.push((
            20,
            feature(
                "asset_blowout",
                "match",
                20,
                "notice",
                winner
                    .map(|row| vec![row.member_id.clone()])
                    .unwrap_or_default(),
                vec![],
            ),
        ));
    }
    features
}

fn push_member_condition_feature(
    features: &mut Vec<(i32, Value)>,
    group: &[&PlayerMatchInput],
    priority: i32,
    code: &str,
    tone: &str,
    predicate: impl Fn(&PlayerMatchInput) -> bool,
) {
    let members = group
        .iter()
        .filter(|row| predicate(row))
        .map(|row| row.member_id.clone())
        .collect::<Vec<_>>();
    if !members.is_empty() {
        features.push((
            priority,
            feature(code, "match", priority, tone, members, vec![]),
        ));
    }
}

fn feature(
    code: &str,
    source: &str,
    priority: i32,
    tone: &str,
    member_ids: Vec<String>,
    evidence: Vec<Value>,
) -> Value {
    let member_ids = Value::Array(member_ids.into_iter().map(Value::String).collect());
    let evidence = Value::Array(evidence);
    json!({ "featureCode": code, "source": source, "priority": priority, "tone": tone, "memberIds": member_ids, "evidence": evidence })
}
