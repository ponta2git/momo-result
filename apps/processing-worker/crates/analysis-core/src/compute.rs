use serde_json::Value;

use crate::{
    contract::ScopeRef,
    model::{
        NormalizedAnalysisInput, PlayerMatchInput, PlayerMatchesByMember, ordered_member_ids,
        player_matches_by_member,
    },
    outcome_model,
};

mod aggregate;
mod drilldown;
mod grouping;
mod match_context;
mod metrics;
mod panels;
mod presentation;
mod quality;
mod review;
mod signals;
mod trends;

use aggregate::aggregate;
use drilldown::build as build_drilldown;
use grouping::{MatchGroup, group_player_matches};
use match_context::{AggregateItemIds, MatchContextIndex, build as build_match_context};
use review::build as build_review;

#[cfg(test)]
use crate::model::AnalysisInput;

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
    const ALL: [Self; 4] = [
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

struct ScopeAnalysis<'a> {
    player_matches: Vec<&'a PlayerMatchInput>,
    member_ids: Vec<String>,
    player_matches_by_member: PlayerMatchesByMember<'a>,
    match_groups: Vec<MatchGroup<'a>>,
    outcome_model: outcome_model::OutcomeModelAnalysis,
}

impl<'a> ScopeAnalysis<'a> {
    fn new(player_matches: Vec<&'a PlayerMatchInput>) -> Self {
        let member_ids = ordered_member_ids(&player_matches);
        let player_matches_by_member = player_matches_by_member(&player_matches, &member_ids);
        let match_groups = group_player_matches(&player_matches);
        let outcome_model = outcome_model::analyze(&player_matches, &member_ids);
        Self {
            player_matches,
            member_ids,
            player_matches_by_member,
            match_groups,
            outcome_model,
        }
    }

    fn references_same_player_matches_in_order(
        &self,
        player_matches: &[&PlayerMatchInput],
    ) -> bool {
        self.player_matches.len() == player_matches.len()
            && self
                .player_matches
                .iter()
                .zip(player_matches)
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
/// The type boundary guarantees that checksum and calculation use the same canonical player-match order.
/// Runtime callers should consume each resource immediately so artifact generation remains bounded.
///
/// # Errors
///
/// Returns the first error produced by the resource consumer without generating later resources.
pub fn try_for_each_resource<E>(
    input: &NormalizedAnalysisInput,
    mut consume: impl FnMut(ComputedResource) -> Result<(), E>,
) -> Result<(), E> {
    let mut previous_analysis: Option<ScopeAnalysis<'_>> = None;
    for (scope, player_matches) in input.scopes() {
        let analysis = match previous_analysis.take() {
            Some(analysis) if analysis.references_same_player_matches_in_order(&player_matches) => {
                analysis
            }
            Some(_) | None => ScopeAnalysis::new(player_matches),
        };
        let aggregate = aggregate(
            input.game_title_id(),
            scope,
            &analysis.player_matches,
            &analysis.member_ids,
            &analysis.player_matches_by_member,
            &analysis.match_groups,
            &analysis.outcome_model,
        );
        let aggregate_item_ids = AggregateItemIds::from_aggregate(&aggregate);
        let review_data_quality = aggregate.get("dataQuality").cloned();
        consume(ComputedResource {
            scope: scope.clone(),
            kind: ComputedResourceKind::Aggregate,
            payload: aggregate,
            item_count: analysis.player_matches.len(),
            source_match_revision: None,
        })?;
        let review = build_review(
            scope,
            &analysis.player_matches,
            &analysis.member_ids,
            &analysis.player_matches_by_member,
            review_data_quality,
        );
        consume(ComputedResource {
            scope: scope.clone(),
            kind: ComputedResourceKind::Review,
            payload: review,
            item_count: analysis.member_ids.len(),
            source_match_revision: None,
        })?;
        for member_id in &analysis.member_ids {
            let member_matches = analysis
                .player_matches_by_member
                .get(member_id)
                .map_or(&[][..], Vec::as_slice);
            for metric in DrilldownMetric::ALL {
                consume(ComputedResource {
                    scope: scope.clone(),
                    kind: ComputedResourceKind::Drilldown {
                        member_id: member_id.clone(),
                        metric,
                    },
                    payload: build_drilldown(
                        scope,
                        member_matches,
                        &analysis.player_matches,
                        analysis.match_groups.len(),
                        member_id,
                        metric.wire(),
                        &analysis.outcome_model,
                    ),
                    item_count: member_matches.len(),
                    source_match_revision: None,
                })?;
            }
        }
        let context_index = MatchContextIndex::new(&analysis.player_matches);
        for (group_offset, group) in analysis.match_groups.iter().enumerate() {
            consume(ComputedResource {
                scope: scope.clone(),
                kind: ComputedResourceKind::MatchContext {
                    match_id: String::from(group.match_id),
                },
                payload: build_match_context(
                    scope,
                    &group.player_matches,
                    &context_index,
                    &aggregate_item_ids,
                    group.match_id,
                    group_offset + 1,
                ),
                item_count: group.player_matches.len(),
                source_match_revision: Some(group.match_revision),
            })?;
        }
        previous_analysis = Some(analysis);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
