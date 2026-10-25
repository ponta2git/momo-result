use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
};

use super::{
    AchievementCurve, AchievementInput, AchievementItem, AchievementPayload, AchievementStatus,
    Claim, ClaimKind, ClaimState, DecimalThreshold, Definition, MAXIMUM_PROOFS, PlayerAchievement,
    PlayerPoints, PointSummary, Proof, ProofKind, ProofState, RuleKind,
};
use crate::{contract::ScopeRef, model::PlayerMatchInput};

/// Computes lifetime achievement points and scores independently of statistical scope eligibility.
#[must_use]
pub fn calculate(
    title: &str,
    input: &AchievementInput,
    rows: &[PlayerMatchInput],
    achievement_curve: AchievementCurve,
) -> AchievementPayload {
    let definitions = input
        .definitions
        .iter()
        .map(|item| (&item.achievement_id, item))
        .collect::<BTreeMap<_, _>>();
    let matches = rows
        .iter()
        .map(|row| (&row.match_id, row))
        .collect::<BTreeMap<_, _>>();
    let items = input
        .definitions
        .iter()
        .map(|item| {
            let players = if item.retired && item.rule_kind != RuleKind::Manual {
                input
                    .retired_achievements
                    .iter()
                    .find(|saved| saved.achievement_id == item.achievement_id)
                    .map_or_else(Vec::new, |saved| saved.players.clone())
            } else {
                input
                    .member_ids
                    .iter()
                    .map(|member_id| {
                        let mut proofs = Vec::new();
                        for claim in input.claims.iter().filter(|claim| {
                            item.rule_kind == RuleKind::Manual && claim.member_id == *member_id
                        }) {
                            if claim.state == ClaimState::Cancelled {
                                continue;
                            }
                            if claim.achievement_id == item.achievement_id {
                                proofs.push(claim_proof(claim, false));
                            } else if claim.state == ClaimState::Achieved {
                                let source = definitions.get(&claim.achievement_id);
                                let permitted = !item.retired
                                    || input.retired_manual_sources.iter().any(|allowed| {
                                        allowed.achievement_id == item.achievement_id
                                            && allowed.claim_id == claim.claim_id
                                            && allowed.generation_id == claim.generation_id
                                    });
                                if permitted && source.is_some_and(|source| implies(source, item)) {
                                    proofs.push(claim_proof(claim, true));
                                }
                            }
                        }
                        if !item.retired
                            && let Some(proof) = automatic(item, member_id, input, rows)
                        {
                            proofs.push(proof);
                        }
                        proofs.sort_by(|left, right| proof_order(left, right, &matches, rows));
                        merge(member_id, proofs)
                    })
                    .collect()
            };
            AchievementItem {
                achievement_id: item.achievement_id.clone(),
                stars: item.stars,
                rule_kind: item.rule_kind.clone(),
                threshold: item.threshold.clone(),
                common: item.common,
                map_master_ids: item.map_master_ids.clone(),
                applies_from: item.applies_from.clone(),
                retired: item.retired,
                players,
            }
        })
        .collect::<Vec<_>>();
    let summaries = std::iter::once(None)
        .chain(input.map_master_ids.iter().cloned().map(Some))
        .map(|map| summarize(map, &items, &input.member_ids, achievement_curve))
        .collect();
    AchievementPayload {
        schema_version: 2,
        scope: ScopeRef::Overall,
        game_title_id: title.into(),
        achievement_curve,
        items,
        summaries,
    }
}

fn claim_proof(claim: &Claim, derived: bool) -> Proof {
    Proof {
        kind: if derived {
            ProofKind::Derived
        } else if claim.source_kind == ClaimKind::Direct {
            ProofKind::Manual
        } else {
            ProofKind::Import
        },
        state: if claim.state == ClaimState::Unconfirmed {
            ProofState::Unconfirmed
        } else {
            ProofState::Achieved
        },
        claim_id: Some(claim.claim_id.clone()),
        generation_id: Some(claim.generation_id.clone()),
        source_achievement_id: derived.then(|| claim.achievement_id.clone()),
        match_id: claim.match_id.clone(),
        held_event_id: None,
        achieved_at: claim.achieved_at.clone(),
    }
}

fn implies(source: &Definition, target: &Definition) -> bool {
    source.rule_kind == RuleKind::Manual
        && target.rule_kind == RuleKind::Manual
        && target.common
        && matches!(
            (source.fixed_key.as_deref(), target.fixed_key.as_deref()),
            (
                Some("momotetsu2-patrol-four"),
                Some("momotetsu2-patrol-dubbing-four")
            ) | (
                Some("momotetsu2-no-one-six-months"),
                Some("momotetsu2-no-one-three-months")
            )
        )
}

fn threshold(item: &Definition) -> u32 {
    // Normalization has already validated the decimal in the rule's bounded domain.
    item.threshold
        .as_ref()
        .and_then(|value| DecimalThreshold::parse(value))
        .map_or(0, |value| {
            if item.rule_kind == RuleKind::EventAverageRank {
                value.rank_sum_limit()
            } else {
                value.whole
            }
        })
}

fn applicable(item: &Definition, row: &PlayerMatchInput) -> bool {
    item.common
        || item
            .map_master_ids
            .binary_search(&row.map_master_id)
            .is_ok()
}

fn automatic(
    item: &Definition,
    member: &str,
    input: &AchievementInput,
    rows: &[PlayerMatchInput],
) -> Option<Proof> {
    if item.rule_kind == RuleKind::Manual {
        return None;
    }
    let value = threshold(item);
    let matched = if item.rule_kind == RuleKind::EventAverageRank {
        let mut events = BTreeMap::<&str, Vec<&PlayerMatchInput>>::new();
        for row in rows.iter().filter(|row| row.member_id == member) {
            events.entry(&row.held_event_id).or_default().push(row);
        }
        events
            .into_iter()
            .filter_map(|(id, event)| {
                let eligible = input
                    .event_compositions
                    .binary_search_by(|composition| composition.held_event_id.as_str().cmp(id))
                    .ok()
                    .and_then(|index| input.event_compositions.get(index))
                    .is_some_and(|composition| {
                        composition.match_count == 4 && composition.title_count == 1
                    });
                if eligible
                    && event.len() == 4
                    && event.iter().all(|row| applicable(item, row))
                    && i64::from(event.iter().map(|row| row.rank).sum::<i32>()) <= i64::from(value)
                {
                    event.last().copied()
                } else {
                    None
                }
            })
            .min_by(|a, b| row_order(a, b))
    } else {
        rows.iter()
            .filter(|row| row.member_id == member && applicable(item, row))
            .find(|row| match item.rule_kind {
                RuleKind::TotalAssets => i64::from(row.total_assets_man_yen) >= i64::from(value),
                RuleKind::Destination => i64::from(row.incidents.destination) >= i64::from(value),
                RuleKind::SuriNoGinji => i64::from(row.incidents.suri_no_ginji) >= i64::from(value),
                RuleKind::Manual | RuleKind::EventAverageRank => false,
            })
    }?;
    let event = item.rule_kind == RuleKind::EventAverageRank;
    Some(Proof {
        kind: ProofKind::Automatic,
        state: ProofState::Achieved,
        claim_id: None,
        generation_id: None,
        source_achievement_id: None,
        match_id: (!event).then(|| matched.match_id.clone()),
        held_event_id: event.then(|| matched.held_event_id.clone()),
        achieved_at: Some(matched.played_at.clone()),
    })
}

fn row_order(left: &PlayerMatchInput, right: &PlayerMatchInput) -> Ordering {
    (
        &left.played_at,
        &left.held_event_id,
        left.match_no_in_event,
        &left.match_id,
    )
        .cmp(&(
            &right.played_at,
            &right.held_event_id,
            right.match_no_in_event,
            &right.match_id,
        ))
}

fn proof_order(
    left: &Proof,
    right: &Proof,
    matches: &BTreeMap<&String, &PlayerMatchInput>,
    rows: &[PlayerMatchInput],
) -> Ordering {
    let anchor = |proof: &Proof| {
        proof
            .match_id
            .as_ref()
            .and_then(|id| matches.get(id).copied())
            .or_else(|| {
                proof
                    .held_event_id
                    .as_ref()
                    .and_then(|id| rows.iter().rev().find(|row| row.held_event_id == *id))
            })
    };
    left.achieved_at
        .is_none()
        .cmp(&right.achieved_at.is_none())
        .then_with(|| left.achieved_at.cmp(&right.achieved_at))
        .then_with(|| match (anchor(left), anchor(right)) {
            (Some(a), Some(b)) => row_order(a, b),
            _ => Ordering::Equal,
        })
        .then_with(|| {
            (
                &left.source_achievement_id,
                &left.claim_id,
                &left.match_id,
                &left.held_event_id,
            )
                .cmp(&(
                    &right.source_achievement_id,
                    &right.claim_id,
                    &right.match_id,
                    &right.held_event_id,
                ))
        })
}

fn merge(member: &str, proofs: Vec<Proof>) -> PlayerAchievement {
    let achieved = proofs
        .iter()
        .filter(|proof| proof.state == ProofState::Achieved)
        .collect::<Vec<_>>();
    let status = if !achieved.is_empty() {
        AchievementStatus::Achieved
    } else if proofs.is_empty() {
        AchievementStatus::NotRecorded
    } else {
        AchievementStatus::Unconfirmed
    };
    let first_achieved_at = achieved
        .iter()
        .filter_map(|proof| proof.achieved_at.as_ref())
        .min()
        .cloned();
    let date_unknown = achieved.iter().any(|proof| proof.achieved_at.is_none());
    PlayerAchievement {
        member_id: member.into(),
        status,
        first_achieved_at,
        date_unknown,
        proofs,
    }
}

pub(super) fn summarize(
    map: Option<String>,
    items: &[AchievementItem],
    members: &[String],
    achievement_curve: AchievementCurve,
) -> PointSummary {
    let eligible = items
        .iter()
        .filter(|item| {
            !item.retired
                && map
                    .as_ref()
                    .is_none_or(|id| item.common || item.map_master_ids.binary_search(id).is_ok())
        })
        .collect::<Vec<_>>();
    let total_points = eligible
        .iter()
        .map(|item| u32::from(item.stars).pow(2))
        .sum();
    let players = members
        .iter()
        .map(|member| {
            let earned_points = eligible
                .iter()
                .filter(|item| {
                    item.players.iter().any(|player| {
                        player.member_id == *member && player.status == AchievementStatus::Achieved
                    })
                })
                .map(|item| u32::from(item.stars).pow(2))
                .sum();
            PlayerPoints {
                member_id: member.clone(),
                earned_points,
                score: achievement_curve.score(earned_points, total_points),
            }
        })
        .collect();
    PointSummary {
        map_master_id: map,
        total_points,
        players,
    }
}

/// Validates the durable player snapshot without depending on any current artifact wire version.
#[must_use]
pub fn valid_player(player: &PlayerAchievement) -> bool {
    if !crate::model::valid_input_id(&player.member_id)
        || player.proofs.len() > MAXIMUM_PROOFS
        || [ProofKind::Manual, ProofKind::Import, ProofKind::Automatic]
            .into_iter()
            .any(|kind| {
                player
                    .proofs
                    .iter()
                    .filter(|proof| proof.kind == kind)
                    .count()
                    > 1
            })
    {
        return false;
    }
    let mut identities = BTreeSet::new();
    if player.proofs.iter().any(|proof| {
        let auto = proof.kind == ProofKind::Automatic;
        let invalid_anchor = auto && (proof.match_id.is_some() == proof.held_event_id.is_some());
        !identities.insert((
            &proof.kind,
            &proof.claim_id,
            &proof.generation_id,
            &proof.source_achievement_id,
            &proof.match_id,
            &proof.held_event_id,
        )) || invalid_anchor
            || auto != proof.claim_id.is_none()
            || auto != proof.generation_id.is_none()
            || (!auto && proof.held_event_id.is_some())
            || (proof.kind == ProofKind::Derived) != proof.source_achievement_id.is_some()
            || (matches!(proof.kind, ProofKind::Manual | ProofKind::Derived)
                && proof.state != ProofState::Achieved)
            || (proof.kind == ProofKind::Manual
                && proof.match_id.is_some()
                && proof.achieved_at.is_none())
            || (auto && (proof.state != ProofState::Achieved || proof.achieved_at.is_none()))
            || proof
                .achieved_at
                .as_ref()
                .is_some_and(|time| !super::valid_timestamp(time))
            || [
                &proof.claim_id,
                &proof.generation_id,
                &proof.source_achievement_id,
                &proof.match_id,
                &proof.held_event_id,
            ]
            .into_iter()
            .flatten()
            .any(|id| !crate::model::valid_input_id(id))
    }) {
        return false;
    }
    merge(&player.member_id, player.proofs.clone()) == *player
}

/// Checks scores against the saved item set. API readers need only the bounded shape defense.
#[must_use]
pub fn valid_payload(payload: &AchievementPayload) -> bool {
    if payload.schema_version != 2
        || !payload.achievement_curve.is_valid()
        || payload.scope != ScopeRef::Overall
        || !crate::model::valid_input_id(&payload.game_title_id)
        || payload.items.len() > super::MAXIMUM_ITEMS
    {
        return false;
    }
    let Some(overall) = payload.summaries.first() else {
        return false;
    };
    let members = overall
        .players
        .iter()
        .map(|p| p.member_id.clone())
        .collect::<Vec<_>>();
    if members.len() != 4 || !super::unique_ids(&members) || overall.map_master_id.is_some() {
        return false;
    }
    let mut previous = None;
    let item_ids = payload
        .items
        .iter()
        .map(|item| &item.achievement_id)
        .collect::<BTreeSet<_>>();
    for item in &payload.items {
        if previous.is_some_and(|id: &String| id >= &item.achievement_id) {
            return false;
        }
        previous = Some(&item.achievement_id);
        let definition = Definition {
            achievement_id: item.achievement_id.clone(),
            stars: item.stars,
            rule_kind: item.rule_kind.clone(),
            threshold: item.threshold.clone(),
            common: item.common,
            map_master_ids: item.map_master_ids.clone(),
            applies_from: item.applies_from.clone(),
            retired: item.retired,
            fixed_key: None,
        };
        if !crate::model::valid_input_id(&item.achievement_id)
            || !super::valid_threshold(&definition)
            || item
                .applies_from
                .as_ref()
                .is_some_and(|date| !super::valid_date(date))
            || !(1..=5).contains(&item.stars)
            || item
                .players
                .iter()
                .map(|p| p.member_id.clone())
                .collect::<Vec<_>>()
                != members
            || item.players.iter().any(|player| {
                !valid_player(player)
                    || player.proofs.iter().any(|proof| {
                        !proof_matches_rule(proof, &item.rule_kind)
                            || (!item.retired
                                && item.rule_kind != RuleKind::Manual
                                && proof.kind != ProofKind::Automatic)
                            || proof
                                .source_achievement_id
                                .as_ref()
                                .is_some_and(|id| !item_ids.contains(id))
                    })
            })
            || !super::unique_ids(&item.map_master_ids)
            || item.common != item.map_master_ids.is_empty()
        {
            return false;
        }
    }
    let maps = payload
        .summaries
        .iter()
        .skip(1)
        .filter_map(|summary| summary.map_master_id.clone())
        .collect::<Vec<_>>();
    if maps.len() + 1 != payload.summaries.len() || !super::unique_ids(&maps) {
        return false;
    }
    payload.items.iter().all(|item| {
        item.map_master_ids
            .iter()
            .all(|id| maps.binary_search(id).is_ok())
    }) && payload.summaries.iter().all(|summary| {
        *summary
            == summarize(
                summary.map_master_id.clone(),
                &payload.items,
                &members,
                payload.achievement_curve,
            )
    })
}

fn proof_matches_rule(proof: &Proof, rule: &RuleKind) -> bool {
    match proof.kind {
        ProofKind::Manual => *rule == RuleKind::Manual,
        ProofKind::Automatic => {
            *rule != RuleKind::Manual
                && (*rule == RuleKind::EventAverageRank) == proof.held_event_id.is_some()
        }
        ProofKind::Import | ProofKind::Derived => true,
    }
}
