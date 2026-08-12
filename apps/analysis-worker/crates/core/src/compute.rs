use serde_json::Value;

use crate::{
    contract::ScopeRef,
    model::{MatchPlayerRow, NormalizedAnalysisInput, RowsByPlayer, player_order, rows_by_player},
    rank,
};

mod aggregate;
mod detail;
mod metrics;
mod panels;
mod quality;
mod support;
mod trends;

use aggregate::aggregate;
#[cfg(test)]
use detail::event_rank_rows;
use detail::{AggregateItemIds, MatchContextIndex, drilldown, match_context, review};
use support::{MatchGroup, match_groups};

#[cfg(test)]
use crate::model::AnalysisInput;
#[cfg(test)]
use serde_json::json;

#[derive(Clone, Debug)]
pub struct ComputedResource {
    pub scope: ScopeRef,
    pub kind: ComputedResourceKind,
    pub payload: Value,
    pub item_count: usize,
    pub source_match_revision: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ComputedResourceKind {
    Aggregate,
    Review,
    Drilldown {
        member_id: String,
        metric: DrilldownMetric,
    },
    MatchContext {
        match_id: String,
    },
}

/// The finite set of drilldown identities emitted by the analysis contract.
///
/// Keeping this vocabulary typed prevents a new resource from silently becoming a generic
/// string that is accepted by one layer and rejected by another.  `wire` remains the sole
/// boundary conversion for the persisted/API metric id.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DrilldownMetric {
    RankAverageHistory,
    PlayOrderRankHistory,
    RankSignals,
    UnexpectedWins,
}

impl DrilldownMetric {
    pub const ALL: [Self; 4] = [
        Self::RankAverageHistory,
        Self::PlayOrderRankHistory,
        Self::RankSignals,
        Self::UnexpectedWins,
    ];

    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::RankAverageHistory => "rank.averageHistory",
            Self::PlayOrderRankHistory => "playOrder.rankHistory",
            Self::RankSignals => "rankAnalysis.rankSignals",
            Self::UnexpectedWins => "rankAnalysis.unexpectedWins",
        }
    }
}

struct ScopeFacts<'a> {
    rows: Vec<&'a MatchPlayerRow>,
    players: Vec<String>,
    rows_by_player: RowsByPlayer<'a>,
    groups: Vec<MatchGroup<'a>>,
    rank_analysis: rank::RankAnalysis,
}

impl<'a> ScopeFacts<'a> {
    fn new(rows: Vec<&'a MatchPlayerRow>) -> Self {
        let players = player_order(&rows);
        let rows_by_player = rows_by_player(&rows, &players);
        let groups = match_groups(&rows);
        let rank_analysis = rank::analyze(&rows, &players);
        Self {
            rows,
            players,
            rows_by_player,
            groups,
            rank_analysis,
        }
    }

    fn contains_identical_rows(&self, rows: &[&MatchPlayerRow]) -> bool {
        self.rows.len() == rows.len()
            && self
                .rows
                .iter()
                .zip(rows)
                .all(|(left, right)| std::ptr::eq(*left, *right))
    }
}

#[must_use]
#[cfg(test)]
pub(crate) fn compute_all(input: &AnalysisInput) -> Vec<ComputedResource> {
    let input = input.normalized();
    let mut resources = Vec::new();
    match try_for_each_resource(&input, |resource| {
        resources.push(resource);
        Ok::<(), std::convert::Infallible>(())
    }) {
        Ok(()) => {}
        Err(never) => match never {},
    }
    resources
}

/// Computes resources in deterministic scope order while allowing the caller to consume and
/// release each payload immediately.
///
/// The type boundary guarantees that checksum and calculation use the same canonical row order.
/// Runtime callers should consume each resource immediately so artifact generation remains bounded.
///
/// # Errors
///
/// Returns the first error produced by the resource consumer without generating later resources.
pub fn try_for_each_resource<E>(
    input: &NormalizedAnalysisInput,
    mut consume: impl FnMut(ComputedResource) -> Result<(), E>,
) -> Result<(), E> {
    let mut previous_facts: Option<ScopeFacts<'_>> = None;
    for scope in input.scopes() {
        let rows = input.rows_for_scope(&scope);
        let facts = match previous_facts.take() {
            Some(facts) if facts.contains_identical_rows(&rows) => facts,
            Some(_) | None => ScopeFacts::new(rows),
        };
        let aggregate = aggregate(
            input,
            &scope,
            &facts.rows,
            &facts.players,
            &facts.rows_by_player,
            &facts.groups,
            &facts.rank_analysis,
        );
        let aggregate_item_ids = AggregateItemIds::from_aggregate(&aggregate);
        let review_data_quality = aggregate.get("dataQuality").cloned();
        consume(ComputedResource {
            scope: scope.clone(),
            kind: ComputedResourceKind::Aggregate,
            payload: aggregate,
            item_count: facts.rows.len(),
            source_match_revision: None,
        })?;
        let review = review(
            &scope,
            &facts.rows,
            &facts.players,
            &facts.rows_by_player,
            review_data_quality,
        );
        consume(ComputedResource {
            scope: scope.clone(),
            kind: ComputedResourceKind::Review,
            payload: review,
            item_count: facts.players.len(),
            source_match_revision: None,
        })?;
        for member_id in &facts.players {
            let player_rows = facts
                .rows_by_player
                .get(member_id)
                .map_or(&[][..], Vec::as_slice);
            for metric in DrilldownMetric::ALL {
                consume(ComputedResource {
                    scope: scope.clone(),
                    kind: ComputedResourceKind::Drilldown {
                        member_id: member_id.clone(),
                        metric,
                    },
                    payload: drilldown(
                        &scope,
                        &facts.rows,
                        player_rows,
                        facts.groups.len(),
                        member_id,
                        metric.wire(),
                        &facts.rank_analysis,
                    ),
                    item_count: player_rows.len(),
                    source_match_revision: None,
                })?;
            }
        }
        let context_index = MatchContextIndex::new(&facts.rows);
        for (group_offset, group) in facts.groups.iter().enumerate() {
            consume(ComputedResource {
                scope: scope.clone(),
                kind: ComputedResourceKind::MatchContext {
                    match_id: String::from(group.match_id),
                },
                payload: match_context(
                    &scope,
                    &group.rows,
                    &context_index,
                    &aggregate_item_ids,
                    group.match_id,
                    group_offset + 1,
                ),
                item_count: group.rows.len(),
                source_match_revision: Some(group.match_revision),
            })?;
        }
        previous_facts = Some(facts);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::model::IncidentCounts;

    fn item_ids(node: &Value) -> BTreeSet<String> {
        let mut result = BTreeSet::new();
        match node {
            Value::Array(values) => {
                for child in values {
                    result.extend(item_ids(child));
                }
            }
            Value::Object(object) => {
                if let Some(item_id) = object.get("itemId").and_then(Value::as_str) {
                    result.insert(String::from(item_id));
                }
                for child in object.values() {
                    result.extend(item_ids(child));
                }
            }
            Value::Bool(_) | Value::Null | Value::Number(_) | Value::String(_) => {}
        }
        result
    }

    fn row(match_index: i32, player: i32) -> MatchPlayerRow {
        MatchPlayerRow {
            match_id: format!("match-{match_index}"),
            match_revision: 0,
            played_at: format!("2026-01-{match_index:02}T00:00:00.000000Z"),
            held_event_id: format!("event-{match_index}"),
            match_no_in_event: match_index,
            season_master_id: String::from("season-1"),
            map_master_id: String::from("map-1"),
            member_id: format!("member-{player}"),
            play_order: player,
            rank: player,
            total_assets_man_yen: player * 100,
            revenue_man_yen: player * 10,
            incidents: IncidentCounts::default(),
        }
    }

    #[test]
    fn recent_rank_window_keeps_the_latest_twenty_matches_in_order() {
        let owned_rows = (1..=24)
            .map(|match_index| row(match_index, 1))
            .collect::<Vec<_>>();
        let rows = owned_rows.iter().collect::<Vec<_>>();
        let players = vec![String::from("member-1")];
        let grouped_rows = rows_by_player(&rows, &players);

        let recent = metrics::recent_ranks(&players, &grouped_rows);
        let entry = recent.first();
        assert!(entry.is_some(), "recent rank entry missing");
        let Some(entry) = entry else {
            return;
        };
        assert_eq!(entry.get("windowSize").and_then(Value::as_u64), Some(20));
        assert_eq!(entry.get("targetCount").and_then(Value::as_u64), Some(20));
        assert_eq!(
            entry.get("usedFallback").and_then(Value::as_bool),
            Some(false)
        );
        let recent_rows = entry.get("rows").and_then(Value::as_array);
        assert!(recent_rows.is_some(), "recent rank rows missing");
        let Some(recent_rows) = recent_rows else {
            return;
        };
        let match_ids = recent_rows
            .iter()
            .filter_map(|value| value.get("matchId").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(match_ids.len(), 20);
        assert_eq!(match_ids.first(), Some(&"match-5"));
        assert_eq!(match_ids.last(), Some(&"match-24"));
    }

    fn overall_aggregate(resources: &[ComputedResource]) -> Option<&Value> {
        resources.iter().find_map(|resource| {
            (resource.scope == ScopeRef::Overall
                && resource.kind == ComputedResourceKind::Aggregate)
                .then_some(&resource.payload)
        })
    }

    #[test]
    fn empty_title_still_produces_overall_aggregate_and_review() {
        let input = AnalysisInput {
            game_title_id: String::from("title-empty"),
            input_revision: 0,
            rows: Vec::new(),
        };
        let resources = compute_all(&input);
        match resources.as_slice() {
            [aggregate, review] => {
                assert_eq!(aggregate.scope, ScopeRef::Overall);
                assert_eq!(aggregate.kind, ComputedResourceKind::Aggregate);
                assert_eq!(aggregate.item_count, 0);
                assert_eq!(aggregate.source_match_revision, None);
                assert_eq!(
                    aggregate.payload.pointer("/scope/matchCount"),
                    Some(&json!(0))
                );
                assert_eq!(review.scope, ScopeRef::Overall);
                assert_eq!(review.kind, ComputedResourceKind::Review);
                assert_eq!(review.item_count, 0);
                assert_eq!(review.source_match_revision, None);
            }
            _ => assert_eq!(resources.len(), 2, "empty title resource set changed"),
        }
    }

    #[test]
    fn every_match_context_is_generated_for_each_real_scope() {
        let input = AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            rows: (1..=4).map(|player| row(1, player)).collect(),
        };
        let resources = compute_all(&input);
        let contexts = resources
            .iter()
            .filter_map(|resource| match &resource.kind {
                ComputedResourceKind::MatchContext { match_id } => Some((
                    resource.scope.clone(),
                    match_id.clone(),
                    resource.item_count,
                    resource.source_match_revision,
                )),
                ComputedResourceKind::Aggregate
                | ComputedResourceKind::Review
                | ComputedResourceKind::Drilldown { .. } => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            contexts,
            vec![
                (ScopeRef::Overall, String::from("match-1"), 4, Some(0)),
                (
                    ScopeRef::Season {
                        season_master_id: String::from("season-1"),
                    },
                    String::from("match-1"),
                    4,
                    Some(0),
                ),
                (
                    ScopeRef::Map {
                        map_master_id: String::from("map-1"),
                    },
                    String::from("match-1"),
                    4,
                    Some(0),
                ),
                (
                    ScopeRef::SeasonMap {
                        season_master_id: String::from("season-1"),
                        map_master_id: String::from("map-1"),
                    },
                    String::from("match-1"),
                    4,
                    Some(0),
                ),
            ]
        );
    }

    #[test]
    fn match_context_focus_references_only_items_in_the_same_aggregate() {
        let input = AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            rows: (1..=2)
                .flat_map(|match_index| (1..=4).map(move |player| row(match_index, player)))
                .collect(),
        };
        let resources = compute_all(&input);
        let aggregate = resources.iter().find(|resource| {
            resource.scope == ScopeRef::Overall && resource.kind == ComputedResourceKind::Aggregate
        });
        assert!(aggregate.is_some(), "overall aggregate missing");
        let Some(aggregate) = aggregate else {
            return;
        };
        let context = resources.iter().find(|resource| {
            resource.scope == ScopeRef::Overall
                && resource.kind
                    == ComputedResourceKind::MatchContext {
                        match_id: String::from("match-2"),
                    }
        });
        assert!(context.is_some(), "overall match context missing");
        let Some(context) = context else {
            return;
        };
        let aggregate_ids = item_ids(&aggregate.payload);
        let focused = context
            .payload
            .pointer("/match/focusedItemIds")
            .and_then(Value::as_array);
        assert!(focused.is_some(), "focused item ids missing");
        let Some(focused) = focused else {
            return;
        };
        let focused_ids = focused
            .iter()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>();

        assert_eq!(
            focused.len(),
            focused_ids.len(),
            "focused IDs must be unique"
        );
        assert_eq!(
            focused.len(),
            49,
            "four players use the complete focus bound"
        );
        assert!(
            crate::payload::validate_computed(context).is_ok(),
            "the complete focus set must pass staging validation"
        );
        assert!(
            focused_ids
                .iter()
                .all(|item_id| aggregate_ids.contains(*item_id))
        );
        assert!(focused_ids.contains("strategy-point:match-2:member-1"));
        assert!(focused_ids.contains("revenue-rank:member-1:4:1"));
        assert!(focused_ids.contains("momentum:member-1:1:1"));
        assert!(focused_ids.contains("card-shop:member-1:no_destination_without_shop"));
        assert!(focused_ids.contains("trend:rank_cumulative_average:member-1:match-2"));
        assert!(focused_ids.contains("match:match-2"));
    }

    #[test]
    fn match_context_players_are_presented_in_result_order() {
        let input = AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            rows: (1..=4)
                .map(|player| {
                    let mut value = row(1, player);
                    value.rank = 5 - player;
                    value
                })
                .collect(),
        };
        let resources = compute_all(&input);
        let context = resources.iter().find(|resource| {
            resource.scope == ScopeRef::Overall
                && matches!(resource.kind, ComputedResourceKind::MatchContext { .. })
        });
        assert!(context.is_some(), "overall match context missing");
        let Some(context) = context else {
            return;
        };
        let ranks = context
            .payload
            .pointer("/match/players")
            .and_then(Value::as_array);
        assert!(ranks.is_some(), "match context players missing");
        let Some(ranks) = ranks else {
            return;
        };
        let ranks = ranks
            .iter()
            .filter_map(|player| player.get("rank").and_then(Value::as_i64))
            .collect::<Vec<_>>();

        assert_eq!(ranks, vec![1, 2, 3, 4]);
    }

    #[test]
    fn event_history_preserves_chronology_instead_of_identifier_order() {
        let mut first = row(1, 1);
        first.held_event_id = String::from("event-z");
        let mut second = row(2, 1);
        second.held_event_id = String::from("event-a");
        let rows = [&first, &second];

        let events = event_rank_rows(&rows);

        assert_eq!(
            events
                .iter()
                .filter_map(|event| event.get("heldEventId").and_then(Value::as_str))
                .collect::<Vec<_>>(),
            vec!["event-z", "event-a"]
        );
    }

    #[test]
    fn revenue_histogram_isolates_zero_between_negative_and_positive_bins() {
        let rows = (1..=4)
            .map(|player| {
                let mut value = row(1, player);
                value.revenue_man_yen = match player {
                    1 => -5,
                    2 => 0,
                    3 => 1,
                    _ => 5,
                };
                value
            })
            .collect();
        let resources = compute_all(&AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            rows,
        });
        let aggregate = overall_aggregate(&resources);
        assert!(aggregate.is_some(), "overall aggregate missing");
        let Some(aggregate) = aggregate else {
            return;
        };
        let bins = aggregate
            .pointer("/histograms/revenue/bins")
            .and_then(Value::as_array);
        assert!(bins.is_some(), "revenue histogram bins missing");
        let Some(bins) = bins else {
            return;
        };
        let zero_bins = bins
            .iter()
            .filter(|bin| {
                bin.get("lowerInclusive").and_then(Value::as_i64) == Some(0)
                    && bin.get("upperExclusive").and_then(Value::as_i64) == Some(1)
            })
            .collect::<Vec<_>>();
        assert_eq!(
            zero_bins.len(),
            1,
            "zero must have exactly one dedicated bin"
        );
        assert!(bins.len() <= 8, "histogram must stay within the bin limit");
        for pair in bins.windows(2) {
            let [left, right] = pair else {
                continue;
            };
            let left_upper = left.get("upperExclusive").and_then(Value::as_i64);
            let right_lower = right.get("lowerInclusive").and_then(Value::as_i64);
            assert!(
                left_upper
                    .zip(right_lower)
                    .is_some_and(|(upper, lower)| upper <= lower),
                "revenue histogram bins must be non-overlapping and ordered"
            );
        }
        let zero_index = zero_bins
            .first()
            .and_then(|bin| bin.get("index"))
            .and_then(Value::as_u64)
            .and_then(|index| usize::try_from(index).ok());
        assert!(zero_index.is_some(), "zero bin index missing");
        let Some(zero_index) = zero_index else {
            return;
        };
        let series = aggregate
            .pointer("/histograms/revenue/series")
            .and_then(Value::as_array);
        assert!(series.is_some(), "revenue histogram series missing");
        let Some(series) = series else {
            return;
        };
        for player_series in series {
            let member_id = player_series.get("memberId").and_then(Value::as_str);
            let zero_count = player_series
                .get("counts")
                .and_then(Value::as_array)
                .and_then(|counts| counts.get(zero_index))
                .and_then(Value::as_u64);
            let expected = u64::from(member_id == Some("member-2"));
            assert_eq!(
                zero_count,
                Some(expected),
                "zero revenue must only count in the dedicated player bin"
            );
        }
    }

    #[test]
    fn all_zero_revenue_produces_only_the_dedicated_bin() {
        let rows = (1..=4)
            .map(|player| {
                let mut value = row(1, player);
                value.revenue_man_yen = 0;
                value
            })
            .collect();
        let resources = compute_all(&AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            rows,
        });
        let aggregate = overall_aggregate(&resources);
        assert!(aggregate.is_some(), "overall aggregate missing");
        let Some(aggregate) = aggregate else {
            return;
        };

        assert_eq!(
            aggregate.pointer("/histograms/revenue/bins"),
            Some(&json!([{
                "index": 0,
                "lowerInclusive": 0,
                "upperExclusive": 1,
                "label": "0〜0",
            }])),
            "all-zero revenue must not generate empty surrounding bins"
        );
        let counts = aggregate
            .pointer("/histograms/revenue/series")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|series| series.get("counts"))
            .collect::<Vec<_>>();
        assert_eq!(
            counts,
            vec![&json!([1]), &json!([1]), &json!([1]), &json!([1])]
        );
    }
}
