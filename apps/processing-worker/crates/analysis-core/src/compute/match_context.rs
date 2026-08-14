//! Indexes match history and builds match-context payloads with valid aggregate-item links.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::{
    competition_rank::{
        calculate_by_match as competition_ranks_by_match, rank_for as competition_rank_for,
    },
    contract::ScopeRef,
    model::PlayerMatchInput,
};

use super::{
    metrics::revenue_asset_rate,
    presentation::{metric_evidence_json, scope_summary_json},
    signals::change_direction,
};

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

pub(super) fn build(
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
        "scope": scope_summary_json(scope, index.match_count),
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
                vec![metric_evidence_json(
                    "ginji.count",
                    "count",
                    Some(ginji_value),
                    None,
                )],
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
