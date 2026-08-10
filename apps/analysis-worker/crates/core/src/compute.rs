use serde_json::Value;

use crate::{
    contract::ScopeRef,
    model::{MatchPlayerRow, NormalizedAnalysisInput, RowsByPlayer, player_order, rows_by_player},
    rank,
};

const METRIC_IDS: [&str; 4] = [
    "rank.averageHistory",
    "playOrder.rankHistory",
    "rankAnalysis.rankSignals",
    "rankAnalysis.unexpectedWins",
];

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
        metric_id: String,
    },
    MatchContext {
        match_id: String,
    },
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
            for metric_id in METRIC_IDS {
                consume(ComputedResource {
                    scope: scope.clone(),
                    kind: ComputedResourceKind::Drilldown {
                        member_id: member_id.clone(),
                        metric_id: String::from(metric_id),
                    },
                    payload: drilldown(
                        &scope,
                        &facts.rows,
                        player_rows,
                        facts.groups.len(),
                        member_id,
                        metric_id,
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

    fn item_ids(value: &Value) -> BTreeSet<String> {
        let mut result = BTreeSet::new();
        match value {
            Value::Array(values) => {
                for value in values {
                    result.extend(item_ids(value));
                }
            }
            Value::Object(object) => {
                if let Some(item_id) = object.get("itemId").and_then(Value::as_str) {
                    result.insert(String::from(item_id));
                }
                for value in object.values() {
                    result.extend(item_ids(value));
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
        let aggregate = resources
            .iter()
            .find(|resource| {
                resource.scope == ScopeRef::Overall
                    && resource.kind == ComputedResourceKind::Aggregate
            })
            .unwrap_or_else(|| panic!("overall aggregate missing"));
        let context = resources
            .iter()
            .find(|resource| {
                resource.scope == ScopeRef::Overall
                    && resource.kind
                        == ComputedResourceKind::MatchContext {
                            match_id: String::from("match-2"),
                        }
            })
            .unwrap_or_else(|| panic!("overall match context missing"));
        let aggregate_ids = item_ids(&aggregate.payload);
        let focused = context
            .payload
            .pointer("/match/focusedItemIds")
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("focused item ids missing"));
        let focused_ids = focused
            .iter()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>();

        assert_eq!(
            focused.len(),
            focused_ids.len(),
            "focused IDs must be unique"
        );
        assert!(
            focused_ids
                .iter()
                .all(|item_id| aggregate_ids.contains(*item_id))
        );
        assert!(focused_ids.contains("strategy-point:match-2:member-1"));
        assert!(focused_ids.contains("revenue-rank:member-1:4:1"));
        assert!(focused_ids.contains("momentum:member-1:1:1"));
        assert!(focused_ids.contains("trend:rank_cumulative_average:member-1:match-2"));
        assert!(focused_ids.contains("match:match-2"));
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
}
