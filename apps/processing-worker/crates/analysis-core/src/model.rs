use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Deref,
};

use serde::{Deserialize, Serialize};

use crate::contract::ScopeRef;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnalysisInput {
    pub game_title_id: String,
    pub input_revision: i64,
    #[serde(rename = "rows")]
    pub player_matches: Vec<PlayerMatchInput>,
}

/// Canonically ordered analysis input accepted by deterministic calculations and checksums.
///
/// Preparation derives the resource-shape bound once and keeps both the player-match inputs and
/// that derived contract immutable.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NormalizedAnalysisInput {
    input: AnalysisInput,
    resource_count: Option<u64>,
}

impl Deref for NormalizedAnalysisInput {
    type Target = AnalysisInput;

    fn deref(&self) -> &Self::Target {
        &self.input
    }
}

impl AsRef<AnalysisInput> for NormalizedAnalysisInput {
    fn as_ref(&self) -> &AnalysisInput {
        &self.input
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayerMatchInput {
    pub match_id: String,
    pub match_revision: i64,
    pub played_at: String,
    pub held_event_id: String,
    pub match_no_in_event: i32,
    pub season_master_id: String,
    pub map_master_id: String,
    pub member_id: String,
    pub play_order: i32,
    pub rank: i32,
    pub total_assets_man_yen: i32,
    pub revenue_man_yen: i32,
    pub incidents: IncidentCounts,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IncidentCounts {
    pub destination: i32,
    pub plus_station: i32,
    pub minus_station: i32,
    pub card_station: i32,
    pub card_shop: i32,
    pub suri_no_ginji: i32,
}

pub(crate) type PlayerMatchesByMember<'a> = BTreeMap<String, Vec<&'a PlayerMatchInput>>;

impl AnalysisInput {
    /// Consumes and canonically orders input exactly once.
    #[must_use]
    pub fn into_normalized(mut self) -> NormalizedAnalysisInput {
        self.normalize();
        let resource_count = resource_count_for_input(&self);
        NormalizedAnalysisInput {
            input: self,
            resource_count,
        }
    }

    /// Returns the input in the canonical player-match order used by every calculation and checksum.
    ///
    /// Database result ordering is deliberately not trusted here: a retry, query-plan change, or
    /// test fixture with the same player matches must produce the same artifact.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn normalized(&self) -> NormalizedAnalysisInput {
        self.clone().into_normalized()
    }

    /// Sorts the owned input in place without duplicating every player match and identifier.
    fn normalize(&mut self) {
        self.player_matches.sort_by(|left, right| {
            left.played_at
                .cmp(&right.played_at)
                .then_with(|| left.held_event_id.cmp(&right.held_event_id))
                .then_with(|| left.match_no_in_event.cmp(&right.match_no_in_event))
                .then_with(|| left.match_id.cmp(&right.match_id))
                .then_with(|| left.play_order.cmp(&right.play_order))
                .then_with(|| left.member_id.cmp(&right.member_id))
                .then_with(|| left.match_revision.cmp(&right.match_revision))
                .then_with(|| left.season_master_id.cmp(&right.season_master_id))
                .then_with(|| left.map_master_id.cmp(&right.map_master_id))
                .then_with(|| left.rank.cmp(&right.rank))
                .then_with(|| left.total_assets_man_yen.cmp(&right.total_assets_man_yen))
                .then_with(|| left.revenue_man_yen.cmp(&right.revenue_man_yen))
                .then_with(|| left.incidents.destination.cmp(&right.incidents.destination))
                .then_with(|| {
                    left.incidents
                        .plus_station
                        .cmp(&right.incidents.plus_station)
                })
                .then_with(|| {
                    left.incidents
                        .minus_station
                        .cmp(&right.incidents.minus_station)
                })
                .then_with(|| {
                    left.incidents
                        .card_station
                        .cmp(&right.incidents.card_station)
                })
                .then_with(|| left.incidents.card_shop.cmp(&right.incidents.card_shop))
                .then_with(|| {
                    left.incidents
                        .suri_no_ginji
                        .cmp(&right.incidents.suri_no_ginji)
                })
        });
    }

    #[must_use]
    pub(crate) fn scopes(&self) -> Vec<ScopeRef> {
        let mut seasons = BTreeSet::<&str>::new();
        let mut maps = BTreeSet::<&str>::new();
        let mut pairs = BTreeSet::<(&str, &str)>::new();
        for player_match in &self.player_matches {
            seasons.insert(&player_match.season_master_id);
            maps.insert(&player_match.map_master_id);
            pairs.insert((&player_match.season_master_id, &player_match.map_master_id));
        }

        let mut scopes = vec![ScopeRef::Overall];
        scopes.extend(seasons.into_iter().map(|id| ScopeRef::Season {
            season_master_id: String::from(id),
        }));
        scopes.extend(maps.into_iter().map(|id| ScopeRef::Map {
            map_master_id: String::from(id),
        }));
        scopes.extend(
            pairs
                .into_iter()
                .map(|(season_id, map_id)| ScopeRef::SeasonMap {
                    season_master_id: String::from(season_id),
                    map_master_id: String::from(map_id),
                }),
        );
        scopes
    }

    #[must_use]
    pub(crate) fn player_matches_for_scope(&self, scope: &ScopeRef) -> Vec<&PlayerMatchInput> {
        self.player_matches
            .iter()
            .filter(|player_match| match scope {
                ScopeRef::Overall => true,
                ScopeRef::Season { season_master_id } => {
                    player_match.season_master_id == *season_master_id
                }
                ScopeRef::Map { map_master_id } => player_match.map_master_id == *map_master_id,
                ScopeRef::SeasonMap {
                    season_master_id,
                    map_master_id,
                } => {
                    player_match.season_master_id == *season_master_id
                        && player_match.map_master_id == *map_master_id
                }
            })
            .collect()
    }
}

impl NormalizedAnalysisInput {
    /// Returns the exact number of resource chunks the calculator will emit.
    ///
    /// This is deliberately a shape-only pass: it allocates no payloads and retains no per-scope
    /// index.  The child uses it immediately after the bounded input snapshot is loaded so an
    /// impossible artifact is rejected before outcome-model analysis or JSON construction starts.
    #[must_use]
    pub const fn resource_count(&self) -> Option<u64> {
        self.resource_count
    }
}

fn resource_count_for_input(input: &AnalysisInput) -> Option<u64> {
    input.scopes().into_iter().try_fold(0_u64, |total, scope| {
        let player_matches = input.player_matches_for_scope(&scope);
        let member_ids = player_matches
            .iter()
            .map(|player_match| player_match.member_id.as_str())
            .collect::<BTreeSet<_>>();
        let match_ids = player_matches
            .iter()
            .map(|player_match| player_match.match_id.as_str())
            .collect::<BTreeSet<_>>();
        let player_chunks = u64::try_from(member_ids.len()).ok()?.checked_mul(4)?;
        let scope_count = 2_u64
            .checked_add(player_chunks)?
            .checked_add(u64::try_from(match_ids.len()).ok()?)?;
        total.checked_add(scope_count)
    })
}

#[must_use]
pub(crate) fn ordered_member_ids(player_matches: &[&PlayerMatchInput]) -> Vec<String> {
    let mut first_match_by_member = BTreeMap::<&str, &PlayerMatchInput>::new();
    for player_match in player_matches {
        first_match_by_member
            .entry(&player_match.member_id)
            .or_insert(player_match);
    }
    let mut first_matches = first_match_by_member.into_values().collect::<Vec<_>>();
    first_matches.sort_by(|left, right| {
        preferred_member_order(&left.member_id)
            .cmp(&preferred_member_order(&right.member_id))
            .then_with(|| left.member_id.cmp(&right.member_id))
    });
    first_matches
        .into_iter()
        .map(|player_match| player_match.member_id.clone())
        .collect()
}

#[must_use]
pub(crate) fn player_matches_by_member<'a>(
    player_matches: &[&'a PlayerMatchInput],
    member_ids: &[String],
) -> PlayerMatchesByMember<'a> {
    let mut grouped = member_ids
        .iter()
        .map(|member_id| (member_id.clone(), Vec::new()))
        .collect::<PlayerMatchesByMember<'a>>();
    for player_match in player_matches {
        if let Some(member_matches) = grouped.get_mut(player_match.member_id.as_str()) {
            member_matches.push(*player_match);
        }
    }
    grouped
}

fn preferred_member_order(member_id: &str) -> i32 {
    match member_id {
        "member_eu" | "eu" => 0,
        "member_ponta" | "ponta" => 1,
        "member_akane_mami" | "akane" | "akane-mami" => 2,
        "member_otaka" | "otaka" => 3,
        _ => i32::MAX,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn analysis_input_uses_rows_as_the_wire_name_for_player_matches() {
        let input = AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            player_matches: Vec::new(),
        };

        let encoded = serde_json::to_value(&input);
        assert!(
            encoded
                .as_ref()
                .is_ok_and(|value| value.get("rows") == Some(&json!([]))),
            "analysis input must keep the versioned rows field"
        );
        assert!(
            encoded
                .as_ref()
                .is_ok_and(|value| value.get("playerMatches").is_none()),
            "internal terminology must not change the analysis-input wire contract"
        );
        let decoded = serde_json::from_value::<AnalysisInput>(json!({
            "gameTitleId": "title-1",
            "inputRevision": 1,
            "rows": [],
        }));
        assert!(
            decoded.is_ok(),
            "the existing rows wire field must remain accepted"
        );
        assert!(
            serde_json::from_value::<AnalysisInput>(json!({
                "gameTitleId": "title-1",
                "inputRevision": 1,
                "playerMatches": [],
            }))
            .is_err(),
            "internal terminology must not widen the versioned wire contract"
        );
    }
}
