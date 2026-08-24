//! Builds a scope review by selecting and presenting actionable player-analysis candidates.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::{
    competition_rank::{
        CompetitionRanks, calculate_by_match as competition_ranks_by_match,
        rank_for as competition_rank_for,
    },
    contract::ScopeRef,
    model::{PlayerMatchInput, PlayerMatchesByMember},
    numeric::count_as_f64,
    stats::{average, cliffs_delta, percentile_i32, quality_status, rate, round},
};

mod presentation;
mod statistics;
mod template;

#[cfg(test)]
use presentation::conditional_quality_status;
use presentation::{candidate_json, common_topic_json};
use template::action_connection;

const PRIOR_WEIGHT: f64 = 8.0;
const MINIMUM_CONDITIONAL_COUNT: usize = 3;
const PRIMARY_CONDITIONAL_COUNT: usize = 8;
const PRIMARY_DRIVER_EFFECT: f64 = 0.30;
const REFERENCE_DRIVER_EFFECT: f64 = 0.50;
const MINIMUM_SHRUNK_SYMPTOM: f64 = 0.02;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Category {
    Revenue,
    Destination,
    Assets,
    PlayOrder,
    Ginji,
    Recovery,
    DestinationPositive,
    Accident,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Driver {
    RevenueRank,
    Destination,
    IncidentAvoidance,
    CardShop,
}

#[derive(Clone, Copy, Debug)]
enum OutcomeSplit {
    Win,
    Podium,
}

#[derive(Clone, Debug)]
struct DriverContrast {
    driver: Driver,
    effect: f64,
    mean_difference: f64,
    positive_count: usize,
    negative_count: usize,
}

#[derive(Clone, Debug)]
struct Candidate {
    member_id: String,
    category: Category,
    raw_symptom: f64,
    normalized_symptom: f64,
    shrunk_symptom: f64,
    contrast: DriverContrast,
    confidence_high: Option<f64>,
    confidence_low: Option<f64>,
    event_stability: Option<f64>,
    target_count: usize,
    baseline_count: usize,
    action_connection: f64,
    peer_distinctiveness: f64,
    commonness_penalty: f64,
    retained: bool,
    action_advice_score: f64,
}

#[derive(Clone, Debug)]
struct CommonTopic {
    category: Category,
    player_ids: Vec<String>,
    candidate_count: usize,
    strongest_score: f64,
}

pub(super) fn build(
    scope: &ScopeRef,
    rows: &[&PlayerMatchInput],
    players: &[String],
    player_matches_by_member: &PlayerMatchesByMember<'_>,
    data_quality: Option<Value>,
) -> Value {
    let revenue_ranks = competition_ranks_by_match(rows, |row| row.revenue_man_yen);
    let mut candidates = players
        .iter()
        .flat_map(|member_id| {
            player_candidates(
                member_id,
                player_matches_by_member
                    .get(member_id)
                    .map_or(&[][..], Vec::as_slice),
                &revenue_ranks,
            )
        })
        .collect::<Vec<_>>();
    let common_topics = apply_peer_selection(&mut candidates, players);

    let playbook = players
        .iter()
        .map(|member_id| {
            let mut selected = candidates
                .iter()
                .filter(|candidate| candidate.member_id == *member_id && candidate.retained)
                .collect::<Vec<_>>();
            selected.sort_by(|left, right| {
                right
                    .action_advice_score
                    .total_cmp(&left.action_advice_score)
                    .then_with(|| left.category.cmp(&right.category))
            });
            let cards = selected
                .into_iter()
                .take(3)
                .map(candidate_json)
                .collect::<Vec<_>>();
            json!({
                "player": { "memberId": member_id },
                "primaryCard": cards.first().cloned(),
                "secondaryCards": cards.into_iter().skip(1).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let match_count = rows
        .iter()
        .map(|row| row.match_id.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let mut scope_value = scope.json_value();
    if let Some(object) = scope_value.as_object_mut() {
        object.insert(String::from("matchCount"), json!(match_count));
    }

    json!({
        "schemaVersion": 2,
        "scope": scope_value,
        "baseline": {
            "matchCount": match_count,
            "playerCount": players.len(),
            "qualityStatus": quality_status(match_count),
        },
        "commonPlaybookTopics": common_topics.iter().take(2).map(common_topic_json).collect::<Vec<_>>(),
        "playbookByPlayer": playbook,
        "dataQuality": data_quality.unwrap_or_else(|| json!({
            "items": [],
            "summary": { "okCount": 0, "referenceCount": 0, "noTargetCount": 0 },
        })),
    })
}

fn player_candidates(
    member_id: &str,
    rows: &[&PlayerMatchInput],
    revenue_ranks: &CompetitionRanks<'_>,
) -> Vec<Candidate> {
    if rows.len() < MINIMUM_CONDITIONAL_COUNT {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    push_matching_candidate(
        &mut candidates,
        CandidateContext::new(
            member_id,
            Category::Revenue,
            rows,
            revenue_ranks,
            OutcomeSplit::Win,
        ),
        |row| revenue_rank_score(revenue_ranks, row).is_some_and(|score| score >= 3.5),
    );
    push_matching_candidate(
        &mut candidates,
        CandidateContext::new(
            member_id,
            Category::Destination,
            rows,
            revenue_ranks,
            OutcomeSplit::Podium,
        ),
        |row| row.incidents.destination == 0,
    );
    push_low_asset_candidate(&mut candidates, member_id, rows, revenue_ranks);
    push_worst_order_candidate(&mut candidates, member_id, rows, revenue_ranks);
    push_matching_candidate(
        &mut candidates,
        CandidateContext::new(
            member_id,
            Category::Ginji,
            rows,
            revenue_ranks,
            OutcomeSplit::Podium,
        ),
        |row| row.incidents.suri_no_ginji > 0,
    );
    let recovery = recovery_rows(rows);
    push_candidate(
        &mut candidates,
        make_candidate(
            member_id,
            Category::Recovery,
            &recovery,
            rows,
            revenue_ranks,
            OutcomeSplit::Podium,
        ),
    );
    push_matching_candidate(
        &mut candidates,
        CandidateContext::new(
            member_id,
            Category::DestinationPositive,
            rows,
            revenue_ranks,
            OutcomeSplit::Podium,
        ),
        |row| row.incidents.destination > 0,
    );
    push_matching_candidate(
        &mut candidates,
        CandidateContext::new(
            member_id,
            Category::Accident,
            rows,
            revenue_ranks,
            OutcomeSplit::Podium,
        ),
        |row| row.incidents.suri_no_ginji > 0 || row.incidents.minus_station > 0,
    );
    candidates
}

#[derive(Clone, Copy)]
struct CandidateContext<'a> {
    member_id: &'a str,
    category: Category,
    baseline_rows: &'a [&'a PlayerMatchInput],
    revenue_ranks: &'a CompetitionRanks<'a>,
    split: OutcomeSplit,
}

impl<'a> CandidateContext<'a> {
    const fn new(
        member_id: &'a str,
        category: Category,
        baseline_rows: &'a [&'a PlayerMatchInput],
        revenue_ranks: &'a CompetitionRanks<'a>,
        split: OutcomeSplit,
    ) -> Self {
        Self {
            member_id,
            category,
            baseline_rows,
            revenue_ranks,
            split,
        }
    }
}

fn push_matching_candidate(
    candidates: &mut Vec<Candidate>,
    context: CandidateContext<'_>,
    predicate: impl Fn(&PlayerMatchInput) -> bool,
) {
    let target_rows = context
        .baseline_rows
        .iter()
        .copied()
        .filter(|row| predicate(row))
        .collect::<Vec<_>>();
    push_candidate(
        candidates,
        make_candidate(
            context.member_id,
            context.category,
            &target_rows,
            context.baseline_rows,
            context.revenue_ranks,
            context.split,
        ),
    );
}

fn push_low_asset_candidate(
    candidates: &mut Vec<Candidate>,
    member_id: &str,
    rows: &[&PlayerMatchInput],
    revenue_ranks: &CompetitionRanks<'_>,
) {
    let assets = rows
        .iter()
        .map(|row| row.total_assets_man_yen)
        .collect::<Vec<_>>();
    if let Some(limit) = percentile_i32(&assets, 0.25) {
        push_matching_candidate(
            candidates,
            CandidateContext::new(
                member_id,
                Category::Assets,
                rows,
                revenue_ranks,
                OutcomeSplit::Podium,
            ),
            |row| f64::from(row.total_assets_man_yen) <= limit,
        );
    }
}

fn push_worst_order_candidate(
    candidates: &mut Vec<Candidate>,
    member_id: &str,
    rows: &[&PlayerMatchInput],
    revenue_ranks: &CompetitionRanks<'_>,
) {
    if let Some(worst_order) = worst_play_order(rows) {
        push_matching_candidate(
            candidates,
            CandidateContext::new(
                member_id,
                Category::PlayOrder,
                rows,
                revenue_ranks,
                OutcomeSplit::Podium,
            ),
            |row| row.play_order == worst_order,
        );
    }
}

fn push_candidate(candidates: &mut Vec<Candidate>, candidate: Option<Candidate>) {
    if let Some(candidate) = candidate {
        candidates.push(candidate);
    }
}

fn make_candidate(
    member_id: &str,
    category: Category,
    target_rows: &[&PlayerMatchInput],
    baseline_rows: &[&PlayerMatchInput],
    revenue_ranks: &CompetitionRanks<'_>,
    split: OutcomeSplit,
) -> Option<Candidate> {
    let target_count = target_rows.len();
    if target_count < MINIMUM_CONDITIONAL_COUNT {
        return None;
    }
    let raw_symptom = symptom(category, target_rows, baseline_rows)?;
    let normalized_symptom = if category == Category::Revenue {
        raw_symptom
    } else {
        raw_symptom / 3.0
    };
    let shrunk_symptom = shrink(normalized_symptom, target_count);
    if shrunk_symptom.abs() < MINIMUM_SHRUNK_SYMPTOM {
        return None;
    }

    let positive = target_rows
        .iter()
        .copied()
        .filter(|row| match split {
            OutcomeSplit::Win => row.rank == 1,
            OutcomeSplit::Podium => row.rank <= 2,
        })
        .collect::<Vec<_>>();
    let negative = target_rows
        .iter()
        .copied()
        .filter(|row| match split {
            OutcomeSplit::Win => row.rank != 1,
            OutcomeSplit::Podium => row.rank >= 3,
        })
        .collect::<Vec<_>>();
    if positive.is_empty() || negative.is_empty() {
        return None;
    }
    let contrast = strongest_driver(category, &positive, &negative, revenue_ranks)?;
    let minimum_effect = if target_count >= PRIMARY_CONDITIONAL_COUNT {
        PRIMARY_DRIVER_EFFECT
    } else {
        REFERENCE_DRIVER_EFFECT
    };
    if contrast.effect < minimum_effect {
        return None;
    }
    let event_stability = statistics::event_stability(
        target_rows,
        baseline_rows,
        raw_symptom,
        |reduced_target, reduced_baseline| symptom(category, reduced_target, reduced_baseline),
    );
    let interval = matches!(category, Category::Accident | Category::DestinationPositive)
        .then(|| {
            statistics::event_bootstrap_interval(
                member_id,
                category.code(),
                contrast.driver.metric_id(),
                target_rows,
                |sampled| driver_effect(contrast.driver, sampled, split, revenue_ranks),
            )
        })
        .flatten();

    Some(Candidate {
        member_id: String::from(member_id),
        category,
        raw_symptom,
        normalized_symptom,
        shrunk_symptom,
        contrast,
        confidence_high: interval.map(|value| value.high),
        confidence_low: interval.map(|value| value.low),
        event_stability,
        target_count,
        baseline_count: baseline_rows.len(),
        action_connection: action_connection(category),
        peer_distinctiveness: 1.0,
        commonness_penalty: 1.0,
        retained: true,
        action_advice_score: 0.0,
    })
}

fn driver_effect(
    driver: Driver,
    rows: &[&PlayerMatchInput],
    split: OutcomeSplit,
    revenue_ranks: &CompetitionRanks<'_>,
) -> Option<f64> {
    let positive = rows
        .iter()
        .copied()
        .filter(|row| match split {
            OutcomeSplit::Win => row.rank == 1,
            OutcomeSplit::Podium => row.rank <= 2,
        })
        .collect::<Vec<_>>();
    let negative = rows
        .iter()
        .copied()
        .filter(|row| match split {
            OutcomeSplit::Win => row.rank != 1,
            OutcomeSplit::Podium => row.rank >= 3,
        })
        .collect::<Vec<_>>();
    if positive.is_empty() || negative.is_empty() {
        return None;
    }
    let positive_values = driver_values(driver, &positive, revenue_ranks);
    let negative_values = driver_values(driver, &negative, revenue_ranks);
    (positive_values.len() == positive.len() && negative_values.len() == negative.len())
        .then(|| cliffs_delta(&positive_values, &negative_values))
}

fn symptom(
    category: Category,
    target_rows: &[&PlayerMatchInput],
    baseline_rows: &[&PlayerMatchInput],
) -> Option<f64> {
    if category == Category::Revenue {
        let target_rate = rate(
            target_rows.iter().filter(|row| row.rank == 1).count(),
            target_rows.len(),
        )?;
        let baseline_rate = rate(
            baseline_rows.iter().filter(|row| row.rank == 1).count(),
            baseline_rows.len(),
        )?;
        Some(target_rate - baseline_rate)
    } else {
        let target_score = average(target_rows.iter().map(|row| rank_score(row)))?;
        let baseline_score = average(baseline_rows.iter().map(|row| rank_score(row)))?;
        Some(target_score - baseline_score)
    }
}

fn strongest_driver(
    category: Category,
    positive: &[&PlayerMatchInput],
    negative: &[&PlayerMatchInput],
    revenue_ranks: &CompetitionRanks<'_>,
) -> Option<DriverContrast> {
    drivers(category)
        .iter()
        .filter_map(|driver| {
            let positive_values = driver_values(*driver, positive, revenue_ranks);
            let negative_values = driver_values(*driver, negative, revenue_ranks);
            if positive_values.len() != positive.len() || negative_values.len() != negative.len() {
                return None;
            }
            let effect = cliffs_delta(&positive_values, &negative_values);
            let mean_difference = average(&positive_values)? - average(&negative_values)?;
            (effect > 0.0).then_some(DriverContrast {
                driver: *driver,
                effect,
                mean_difference,
                positive_count: positive.len(),
                negative_count: negative.len(),
            })
        })
        .max_by(|left, right| {
            left.effect
                .total_cmp(&right.effect)
                .then_with(|| right.driver.cmp(&left.driver))
        })
}

const fn drivers(category: Category) -> &'static [Driver] {
    match category {
        Category::Revenue => &[
            Driver::Destination,
            Driver::IncidentAvoidance,
            Driver::CardShop,
        ],
        Category::Destination | Category::PlayOrder | Category::Recovery => &[
            Driver::RevenueRank,
            Driver::IncidentAvoidance,
            Driver::CardShop,
        ],
        Category::Assets | Category::Ginji | Category::DestinationPositive | Category::Accident => {
            &[
                Driver::RevenueRank,
                Driver::Destination,
                Driver::IncidentAvoidance,
            ]
        }
    }
}

fn driver_values(
    driver: Driver,
    rows: &[&PlayerMatchInput],
    revenue_ranks: &CompetitionRanks<'_>,
) -> Vec<f64> {
    rows.iter()
        .filter_map(|row| match driver {
            Driver::RevenueRank => revenue_rank_score(revenue_ranks, row),
            Driver::Destination => Some(f64::from(row.incidents.destination)),
            Driver::IncidentAvoidance => Some(-f64::from(
                row.incidents.suri_no_ginji + row.incidents.minus_station,
            )),
            Driver::CardShop => Some(f64::from(row.incidents.card_shop)),
        })
        .collect()
}

fn apply_peer_selection(candidates: &mut [Candidate], players: &[String]) -> Vec<CommonTopic> {
    let player_position = players
        .iter()
        .enumerate()
        .map(|(index, member_id)| (member_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut indexes_by_category = BTreeMap::<Category, Vec<usize>>::new();
    for (index, candidate) in candidates.iter().enumerate() {
        indexes_by_category
            .entry(candidate.category)
            .or_default()
            .push(index);
    }
    let mut topics = Vec::new();
    for (category, mut indexes) in indexes_by_category {
        indexes.sort_by(|left, right| {
            candidates
                .get(*right)
                .zip(candidates.get(*left))
                .map_or_else(
                    || left.cmp(right),
                    |(right_candidate, left_candidate)| {
                        candidate_strength(right_candidate)
                            .total_cmp(&candidate_strength(left_candidate))
                            .then_with(|| {
                                player_position
                                    .get(left_candidate.member_id.as_str())
                                    .cmp(&player_position.get(right_candidate.member_id.as_str()))
                            })
                    },
                )
        });
        let is_common = indexes.len() >= 3;
        for (position, index) in indexes.iter().copied().enumerate() {
            if let Some(candidate) = candidates.get_mut(index) {
                candidate.peer_distinctiveness = peer_weight(position);
                if is_common {
                    candidate.commonness_penalty = if position == 0 { 0.90 } else { 0.75 };
                    if position >= 2 {
                        candidate.retained = false;
                    }
                }
                candidate.action_advice_score = action_advice_score(candidate);
            }
        }
        if is_common {
            let mut player_ids = indexes
                .iter()
                .filter_map(|index| {
                    candidates
                        .get(*index)
                        .map(|candidate| candidate.member_id.clone())
                })
                .collect::<Vec<_>>();
            player_ids.sort_by_key(|member_id| {
                player_position
                    .get(member_id.as_str())
                    .copied()
                    .unwrap_or(usize::MAX)
            });
            topics.push(CommonTopic {
                category,
                player_ids,
                candidate_count: indexes.len(),
                strongest_score: indexes
                    .first()
                    .and_then(|index| candidates.get(*index))
                    .map_or(0.0, candidate_strength),
            });
        }
    }
    for candidate in candidates
        .iter_mut()
        .filter(|candidate| candidate.action_advice_score == 0.0)
    {
        candidate.action_advice_score = action_advice_score(candidate);
    }
    topics.sort_by(|left, right| {
        right
            .candidate_count
            .cmp(&left.candidate_count)
            .then_with(|| right.strongest_score.total_cmp(&left.strongest_score))
            .then_with(|| left.category.cmp(&right.category))
    });
    topics
}

fn action_advice_score(candidate: &Candidate) -> f64 {
    let Some(exposure) = count_as_f64(candidate.target_count)
        .zip(count_as_f64(candidate.baseline_count))
        .and_then(|(target, baseline)| (baseline > 0.0).then_some(target / baseline))
    else {
        return 0.0;
    };
    let reliability = if candidate.target_count >= PRIMARY_CONDITIONAL_COUNT {
        1.0
    } else {
        0.6
    };
    round(
        candidate.shrunk_symptom.abs()
            * candidate.contrast.effect
            * exposure
            * reliability
            * candidate.action_connection
            * candidate.peer_distinctiveness
            * candidate.commonness_penalty,
        8,
    )
}

fn candidate_strength(candidate: &Candidate) -> f64 {
    candidate.shrunk_symptom.abs() * candidate.contrast.effect
}

const fn peer_weight(position: usize) -> f64 {
    match position {
        0 => 1.0,
        1 => 0.85,
        2 => 0.70,
        _ => 0.60,
    }
}

fn shrink(value: f64, target_count: usize) -> f64 {
    let Some(target_count) = count_as_f64(target_count) else {
        return 0.0;
    };
    value * target_count / (target_count + PRIOR_WEIGHT)
}

fn rank_score(row: &PlayerMatchInput) -> f64 {
    f64::from(5 - row.rank)
}

fn worst_play_order(rows: &[&PlayerMatchInput]) -> Option<i32> {
    let mut rows_by_order = BTreeMap::<i32, Vec<f64>>::new();
    for row in rows {
        rows_by_order
            .entry(row.play_order)
            .or_default()
            .push(rank_score(row));
    }
    rows_by_order
        .into_iter()
        .filter(|(_, values)| values.len() >= MINIMUM_CONDITIONAL_COUNT)
        .filter_map(|(play_order, values)| average(&values).map(|score| (play_order, score)))
        .min_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.0.cmp(&right.0))
        })
        .map(|value| value.0)
}

fn recovery_rows<'a>(rows: &[&'a PlayerMatchInput]) -> Vec<&'a PlayerMatchInput> {
    let mut ordered = rows.to_vec();
    ordered.sort_by(|left, right| {
        left.played_at
            .cmp(&right.played_at)
            .then_with(|| left.match_id.cmp(&right.match_id))
    });
    ordered
        .windows(2)
        .filter_map(|pair| match pair {
            [previous, current] if previous.rank >= 3 => Some(*current),
            _ => None,
        })
        .collect()
}

fn revenue_rank_score(ranks: &CompetitionRanks<'_>, row: &PlayerMatchInput) -> Option<f64> {
    competition_rank_for(ranks, row).map(|rank| 5.0 - rank)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::ScopeRef;
    use crate::model::{IncidentCounts, ordered_member_ids, player_matches_by_member};

    fn build_for_test(rows: &[&PlayerMatchInput], data_quality: Option<Value>) -> Value {
        let players = ordered_member_ids(rows);
        let player_matches_by_member = player_matches_by_member(rows, &players);
        build(
            &ScopeRef::Overall,
            rows,
            &players,
            &player_matches_by_member,
            data_quality,
        )
    }

    fn row(index: i32, player: i32, rank: i32) -> PlayerMatchInput {
        PlayerMatchInput {
            match_id: format!("match-{index:02}"),
            match_revision: 1,
            played_at: format!("2026-01-{index:02}T00:00:00.000000Z"),
            held_event_id: format!("event-{index:02}"),
            match_no_in_event: index,
            season_master_id: String::from("season-1"),
            map_master_id: String::from("map-1"),
            member_id: format!("member-{player}"),
            play_order: player,
            rank,
            total_assets_man_yen: (5 - rank) * 100,
            revenue_man_yen: (5 - rank) * 10,
            incidents: IncidentCounts {
                destination: i32::from(rank <= 2),
                card_shop: i32::from(rank <= 2),
                ..IncidentCounts::default()
            },
        }
    }

    #[test]
    fn conditional_confidence_boundaries_are_fixed() {
        assert_eq!(conditional_quality_status(0), "no_target");
        assert_eq!(conditional_quality_status(2), "reference");
        assert_eq!(conditional_quality_status(3), "reference");
        assert_eq!(conditional_quality_status(7), "reference");
        assert_eq!(conditional_quality_status(8), "ok");
        assert!((shrink(1.0, 8) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn cards_use_contract_classifications_and_never_exceed_three() {
        let owned = (1..=12)
            .flat_map(|index| {
                (1..=4).map(move |player| {
                    let rank = ((index + player - 2) % 4) + 1;
                    row(index, player, rank)
                })
            })
            .collect::<Vec<_>>();
        let rows = owned.iter().collect::<Vec<_>>();
        let payload = build_for_test(&rows, Some(json!({ "items": [], "summary": {} })));
        let entries = payload
            .get("playbookByPlayer")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        assert_eq!(entries.len(), 4);
        let mut card_count = 0_usize;
        for entry in entries {
            let mut cards = Vec::new();
            if let Some(primary) = entry.get("primaryCard").filter(|card| !card.is_null()) {
                cards.push(primary);
            }
            cards.extend(
                entry
                    .get("secondaryCards")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten(),
            );
            card_count += cards.len();
            assert!(cards.len() <= 3);
            let categories = cards
                .iter()
                .filter_map(|card| card.get("category").and_then(Value::as_str))
                .collect::<BTreeSet<_>>();
            assert_eq!(categories.len(), cards.len());
            assert!(cards.iter().all(|card| matches!(
                card.get("classification").and_then(Value::as_str),
                Some("reproduce" | "revise" | "verify")
            )));
        }
        assert!(card_count > 0, "card assertions must not pass vacuously");
    }

    #[test]
    fn fewer_than_three_matches_produces_an_empty_playbook() {
        let owned = (1..=2)
            .flat_map(|index| (1..=4).map(move |player| row(index, player, player)))
            .collect::<Vec<_>>();
        let rows = owned.iter().collect::<Vec<_>>();
        let payload = build_for_test(&rows, Some(json!({})));
        let entries = payload
            .get("playbookByPlayer")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        assert_eq!(entries.len(), 4);
        assert_eq!(
            entries
                .iter()
                .filter_map(|entry| entry.pointer("/player/memberId").and_then(Value::as_str))
                .collect::<Vec<_>>(),
            vec!["member-1", "member-2", "member-3", "member-4"]
        );
        assert!(
            entries.iter().all(|entry| {
                entry.get("primaryCard").is_some_and(Value::is_null)
                    && entry
                        .get("secondaryCards")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty)
            }),
            "sub-threshold players must retain an explicit empty playbook"
        );
    }
}
