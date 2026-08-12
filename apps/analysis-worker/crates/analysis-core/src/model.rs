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
    pub rows: Vec<MatchPlayerRow>,
}

/// Canonically ordered analysis input accepted by deterministic calculations and checksums.
///
/// Preparation derives the resource-shape bound once and keeps both the rows and that derived
/// contract immutable.  The alias retains the existing name at call sites while making the
/// preparation stage explicit in this module.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedAnalysisInput {
    input: AnalysisInput,
    resource_count: Option<u64>,
}

pub type NormalizedAnalysisInput = PreparedAnalysisInput;

impl Deref for PreparedAnalysisInput {
    type Target = AnalysisInput;

    fn deref(&self) -> &Self::Target {
        &self.input
    }
}

impl AsRef<AnalysisInput> for PreparedAnalysisInput {
    fn as_ref(&self) -> &AnalysisInput {
        &self.input
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MatchPlayerRow {
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

pub(crate) type Scope = ScopeRef;
pub(crate) type RowsByPlayer<'a> = BTreeMap<String, Vec<&'a MatchPlayerRow>>;

impl AnalysisInput {
    /// Consumes and canonically orders input exactly once.
    #[must_use]
    pub fn into_normalized(mut self) -> NormalizedAnalysisInput {
        self.normalize();
        let resource_count = resource_count_for_input(&self);
        PreparedAnalysisInput {
            input: self,
            resource_count,
        }
    }

    /// Returns the input in the single canonical row order used by every calculation and checksum.
    ///
    /// Database result ordering is deliberately not trusted here: a retry, query-plan change, or
    /// test fixture with the same rows must produce the same artifact.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn normalized(&self) -> NormalizedAnalysisInput {
        self.clone().into_normalized()
    }

    /// Sorts the owned input in place without duplicating every row and identifier.
    fn normalize(&mut self) {
        self.rows.sort_by(|left, right| {
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
    pub(crate) fn scopes(&self) -> Vec<Scope> {
        let mut seasons = BTreeSet::<&str>::new();
        let mut maps = BTreeSet::<&str>::new();
        let mut pairs = BTreeSet::<(&str, &str)>::new();
        for row in &self.rows {
            seasons.insert(&row.season_master_id);
            maps.insert(&row.map_master_id);
            pairs.insert((&row.season_master_id, &row.map_master_id));
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
    pub(crate) fn rows_for_scope(&self, scope: &ScopeRef) -> Vec<&MatchPlayerRow> {
        self.rows
            .iter()
            .filter(|row| match scope {
                ScopeRef::Overall => true,
                ScopeRef::Season { season_master_id } => row.season_master_id == *season_master_id,
                ScopeRef::Map { map_master_id } => row.map_master_id == *map_master_id,
                ScopeRef::SeasonMap {
                    season_master_id,
                    map_master_id,
                } => {
                    row.season_master_id == *season_master_id && row.map_master_id == *map_master_id
                }
            })
            .collect()
    }
}

impl PreparedAnalysisInput {
    /// Returns the exact number of resource chunks the calculator will emit.
    ///
    /// This is deliberately a shape-only pass: it allocates no payloads and retains no per-scope
    /// index.  The child uses it immediately after the bounded input snapshot is loaded so an
    /// impossible artifact is rejected before rank analysis or JSON construction starts.
    #[must_use]
    pub const fn resource_count(&self) -> Option<u64> {
        self.resource_count
    }
}

fn resource_count_for_input(input: &AnalysisInput) -> Option<u64> {
    input.scopes().into_iter().try_fold(0_u64, |total, scope| {
        let rows = input.rows_for_scope(&scope);
        let players = rows
            .iter()
            .map(|row| row.member_id.as_str())
            .collect::<BTreeSet<_>>();
        let matches = rows
            .iter()
            .map(|row| row.match_id.as_str())
            .collect::<BTreeSet<_>>();
        let player_chunks = u64::try_from(players.len()).ok()?.checked_mul(4)?;
        let scope_count = 2_u64
            .checked_add(player_chunks)?
            .checked_add(u64::try_from(matches.len()).ok()?)?;
        total.checked_add(scope_count)
    })
}

#[must_use]
pub(crate) fn player_order(rows: &[&MatchPlayerRow]) -> Vec<String> {
    let mut first_by_player = BTreeMap::<&str, &MatchPlayerRow>::new();
    for row in rows {
        first_by_player.entry(&row.member_id).or_insert(row);
    }
    let mut players = first_by_player.into_values().collect::<Vec<_>>();
    players.sort_by(|left, right| {
        preferred_player_order(&left.member_id)
            .cmp(&preferred_player_order(&right.member_id))
            .then_with(|| left.member_id.cmp(&right.member_id))
    });
    players
        .into_iter()
        .map(|row| row.member_id.clone())
        .collect()
}

#[must_use]
pub(crate) fn rows_by_player<'a>(
    rows: &[&'a MatchPlayerRow],
    players: &[String],
) -> RowsByPlayer<'a> {
    let mut grouped = players
        .iter()
        .map(|member_id| (member_id.clone(), Vec::new()))
        .collect::<RowsByPlayer<'a>>();
    for row in rows {
        if let Some(player_rows) = grouped.get_mut(row.member_id.as_str()) {
            player_rows.push(*row);
        }
    }
    grouped
}

fn preferred_player_order(member_id: &str) -> i32 {
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
    use super::{AnalysisInput, IncidentCounts, MatchPlayerRow};

    #[test]
    fn resource_count_matches_the_emitted_shape_without_payload_generation() {
        let rows = (0..2)
            .flat_map(|match_index| {
                (1..=4).map(move |player| MatchPlayerRow {
                    match_id: format!("match-{match_index}"),
                    match_revision: 0,
                    played_at: format!("2026-01-0{}T00:00:00.000000Z", match_index + 1),
                    held_event_id: format!("event-{match_index}"),
                    match_no_in_event: match_index,
                    season_master_id: String::from("season-1"),
                    map_master_id: String::from("map-1"),
                    member_id: format!("member-{player}"),
                    play_order: player,
                    rank: player,
                    total_assets_man_yen: 0,
                    revenue_man_yen: 0,
                    incidents: IncidentCounts::default(),
                })
            })
            .collect();
        let input = AnalysisInput {
            game_title_id: String::from("title-shape"),
            input_revision: 0,
            rows,
        }
        .into_normalized();

        assert_eq!(input.resource_count(), Some(80));
    }

    #[test]
    fn empty_input_still_has_overall_aggregate_and_review_chunks() {
        let input = AnalysisInput {
            game_title_id: String::from("title-empty"),
            input_revision: 0,
            rows: Vec::new(),
        }
        .into_normalized();

        assert_eq!(input.resource_count(), Some(2));
    }
}
