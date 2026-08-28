use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::contract::ScopeRef;

pub const MAXIMUM_INPUT_ID_BYTES: usize = 128;
pub const MAXIMUM_PLAYER_MATCH_ROWS: usize = 100_000;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AnalysisInputError {
    #[error("analysis input identity is invalid")]
    InvalidIdentity,
    #[error("analysis input revision is invalid")]
    InvalidRevision,
    #[error("analysis input exceeds the row bound")]
    TooManyRows,
    #[error("analysis input contains an invalid player-match row")]
    InvalidRow,
    #[error("analysis input violates the fixed four-player match contract")]
    InvalidMatch,
}

impl AnalysisInputError {
    /// Stable safe detail for the runtime's bounded failure classification.
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::InvalidIdentity => "analysis input identity is invalid",
            Self::InvalidRevision => "analysis input revision is invalid",
            Self::TooManyRows => "analysis input row count exceeds the numeric safety bound",
            Self::InvalidRow => "analysis input contains an invalid row value",
            Self::InvalidMatch => "match players, ranks, play orders, or metadata are inconsistent",
        }
    }
}

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
#[derive(Debug, Eq, PartialEq)]
pub struct NormalizedAnalysisInput {
    input: AnalysisInput,
    scopes: Vec<ScopeRows>,
    resource_count: Option<u64>,
}

#[derive(Debug, Eq, PartialEq)]
struct ScopeRows {
    scope: ScopeRef,
    row_indices: Vec<usize>,
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
    /// Validates the complete fixed-match domain and canonically orders it exactly once.
    ///
    /// The returned type is the only production input accepted by calculation. This keeps row
    /// bounds, identifiers, ranks, play orders, and per-match consistency out of database and
    /// transport adapters.
    ///
    /// # Errors
    ///
    /// Returns a bounded domain category when any input invariant is violated.
    pub fn try_into_normalized(mut self) -> Result<NormalizedAnalysisInput, AnalysisInputError> {
        self.validate()?;
        self.normalize();
        let scopes = build_scope_rows(&self);
        Ok(NormalizedAnalysisInput {
            resource_count: resource_count_for_scopes(&self, &scopes),
            scopes,
            input: self,
        })
    }

    /// Returns the input in the canonical player-match order used by every calculation and checksum.
    ///
    /// Database result ordering is deliberately not trusted here: a retry, query-plan change, or
    /// test fixture with the same player matches must produce the same artifact.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn normalized(&self) -> NormalizedAnalysisInput {
        let mut input = self.clone();
        input.normalize();
        let scopes = build_scope_rows(&input);
        NormalizedAnalysisInput {
            resource_count: resource_count_for_scopes(&input, &scopes),
            scopes,
            input,
        }
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

    fn validate(&self) -> Result<(), AnalysisInputError> {
        if !valid_input_id(&self.game_title_id) {
            return Err(AnalysisInputError::InvalidIdentity);
        }
        if self.input_revision < 0 {
            return Err(AnalysisInputError::InvalidRevision);
        }
        if self.player_matches.len() > MAXIMUM_PLAYER_MATCH_ROWS {
            return Err(AnalysisInputError::TooManyRows);
        }
        if self
            .player_matches
            .iter()
            .any(|player_match| !player_match.is_valid())
        {
            return Err(AnalysisInputError::InvalidRow);
        }
        let mut matches = BTreeMap::<&str, Vec<&PlayerMatchInput>>::new();
        for player_match in &self.player_matches {
            matches
                .entry(&player_match.match_id)
                .or_default()
                .push(player_match);
        }
        for player_matches in matches.into_values() {
            if !valid_match(&player_matches) {
                return Err(AnalysisInputError::InvalidMatch);
            }
        }
        Ok(())
    }
}

impl PlayerMatchInput {
    fn is_valid(&self) -> bool {
        [
            self.match_id.as_str(),
            self.held_event_id.as_str(),
            self.season_master_id.as_str(),
            self.map_master_id.as_str(),
            self.member_id.as_str(),
        ]
        .into_iter()
        .all(valid_input_id)
            && (1..=4).contains(&self.rank)
            && (1..=4).contains(&self.play_order)
            && self.match_no_in_event >= 1
            && self.match_revision >= 0
            && valid_timestamp_shape(&self.played_at)
            && [
                self.incidents.destination,
                self.incidents.plus_station,
                self.incidents.minus_station,
                self.incidents.card_station,
                self.incidents.card_shop,
                self.incidents.suri_no_ginji,
            ]
            .into_iter()
            .all(|count| count >= 0)
    }

    fn has_same_match_metadata_as(&self, other: &Self) -> bool {
        self.match_revision == other.match_revision
            && self.played_at == other.played_at
            && self.held_event_id == other.held_event_id
            && self.match_no_in_event == other.match_no_in_event
            && self.season_master_id == other.season_master_id
            && self.map_master_id == other.map_master_id
    }
}

fn valid_match(player_matches: &[&PlayerMatchInput]) -> bool {
    let Some(first) = player_matches.first().filter(|_| player_matches.len() == 4) else {
        return false;
    };
    let distinct_members = player_matches
        .iter()
        .map(|player_match| player_match.member_id.as_str())
        .collect::<BTreeSet<_>>()
        .len()
        == 4;
    let complete_ranks = (1..=4).all(|rank| {
        player_matches
            .iter()
            .any(|player_match| player_match.rank == rank)
    });
    let complete_orders = (1..=4).all(|order| {
        player_matches
            .iter()
            .any(|player_match| player_match.play_order == order)
    });
    distinct_members
        && complete_ranks
        && complete_orders
        && player_matches
            .iter()
            .all(|player_match| player_match.has_same_match_metadata_as(first))
}

fn valid_input_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_INPUT_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
}

fn valid_timestamp_shape(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 27
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            19 => *byte == b'.',
            26 => *byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}

impl NormalizedAnalysisInput {
    /// Returns the validated opaque game-title identifier.
    #[must_use]
    pub fn game_title_id(&self) -> &str {
        &self.input.game_title_id
    }

    /// Returns the validated non-negative source revision.
    #[must_use]
    pub const fn input_revision(&self) -> i64 {
        self.input.input_revision
    }

    /// Returns player-match rows in canonical calculation and checksum order.
    #[must_use]
    pub fn player_matches(&self) -> &[PlayerMatchInput] {
        &self.input.player_matches
    }

    /// Returns the exact number of resource chunks the calculator will emit.
    ///
    /// This is deliberately a shape-only pass over the same bounded scope index calculation uses.
    /// The child checks it immediately after loading the input snapshot, before outcome-model
    /// analysis or JSON construction starts.
    #[must_use]
    pub const fn resource_count(&self) -> Option<u64> {
        self.resource_count
    }

    /// Returns every deterministic scope together with its canonical row references.
    ///
    /// Scope membership is indexed once during normalization. Calculation therefore performs a
    /// bounded four-way pass over the input instead of rescanning every row for every scope.
    #[expect(
        clippy::indexing_slicing,
        reason = "private row indices are built after the final sort and the normalized input is immutable"
    )]
    pub(crate) fn scopes(&self) -> impl Iterator<Item = (&ScopeRef, Vec<&PlayerMatchInput>)> {
        self.scopes.iter().map(|scope| {
            let rows = scope
                .row_indices
                .iter()
                .map(|index| &self.input.player_matches[*index])
                .collect();
            (&scope.scope, rows)
        })
    }

    #[cfg(test)]
    pub(crate) const fn scope_count(&self) -> usize {
        self.scopes.len()
    }
}

fn build_scope_rows(input: &AnalysisInput) -> Vec<ScopeRows> {
    let mut seasons = BTreeMap::<&str, Vec<usize>>::new();
    let mut maps = BTreeMap::<&str, Vec<usize>>::new();
    let mut pairs = BTreeMap::<(&str, &str), Vec<usize>>::new();
    for (index, player_match) in input.player_matches.iter().enumerate() {
        seasons
            .entry(&player_match.season_master_id)
            .or_default()
            .push(index);
        maps.entry(&player_match.map_master_id)
            .or_default()
            .push(index);
        pairs
            .entry((&player_match.season_master_id, &player_match.map_master_id))
            .or_default()
            .push(index);
    }

    let mut scopes = Vec::with_capacity(
        1_usize
            .saturating_add(seasons.len())
            .saturating_add(maps.len())
            .saturating_add(pairs.len()),
    );
    scopes.push(ScopeRows {
        scope: ScopeRef::Overall,
        row_indices: (0..input.player_matches.len()).collect(),
    });
    scopes.extend(
        seasons
            .into_iter()
            .map(|(season_master_id, row_indices)| ScopeRows {
                scope: ScopeRef::Season {
                    season_master_id: String::from(season_master_id),
                },
                row_indices,
            }),
    );
    scopes.extend(
        maps.into_iter()
            .map(|(map_master_id, row_indices)| ScopeRows {
                scope: ScopeRef::Map {
                    map_master_id: String::from(map_master_id),
                },
                row_indices,
            }),
    );
    scopes.extend(
        pairs.into_iter().map(
            |((season_master_id, map_master_id), row_indices)| ScopeRows {
                scope: ScopeRef::SeasonMap {
                    season_master_id: String::from(season_master_id),
                    map_master_id: String::from(map_master_id),
                },
                row_indices,
            },
        ),
    );
    scopes
}

fn resource_count_for_scopes(input: &AnalysisInput, scopes: &[ScopeRows]) -> Option<u64> {
    scopes.iter().try_fold(0_u64, |total, scope| {
        let mut member_ids = BTreeSet::<&str>::new();
        let mut match_ids = BTreeSet::<&str>::new();
        for index in &scope.row_indices {
            let player_match = input.player_matches.get(*index)?;
            member_ids.insert(&player_match.member_id);
            match_ids.insert(&player_match.match_id);
        }
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
#[expect(
    clippy::panic,
    reason = "a supposedly valid fixed-match fixture must stop with its exact validation error"
)]
mod tests {
    use serde_json::json;

    use super::*;

    fn match_rows() -> Vec<PlayerMatchInput> {
        (1..=4)
            .rev()
            .map(|player| PlayerMatchInput {
                match_id: String::from("match-1"),
                match_revision: 1,
                played_at: String::from("2026-08-10T00:00:00.000000Z"),
                held_event_id: String::from("event-1"),
                match_no_in_event: 1,
                season_master_id: String::from("season-1"),
                map_master_id: String::from("map-1"),
                member_id: format!("member-{player}"),
                play_order: player,
                rank: player,
                total_assets_man_yen: 0,
                revenue_man_yen: 0,
                incidents: IncidentCounts::default(),
            })
            .collect()
    }

    fn input(rows: Vec<PlayerMatchInput>) -> AnalysisInput {
        AnalysisInput {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            player_matches: rows,
        }
    }

    #[test]
    fn analysis_input_uses_rows_as_the_wire_name_for_player_matches() {
        let input = input(Vec::new());

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

    #[test]
    fn validated_normalization_owns_fixed_match_invariants() {
        let normalized = input(match_rows())
            .try_into_normalized()
            .unwrap_or_else(|error| panic!("valid fixed match was rejected: {error}"));
        assert_eq!(
            normalized
                .player_matches()
                .iter()
                .map(|row| row.play_order)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4],
            "normalization must establish calculation order"
        );

        let mut duplicate_member = match_rows();
        let Some((first_member, remaining_members)) = duplicate_member.split_first_mut() else {
            panic!("fixed-match fixture must contain players");
        };
        let Some(second_member) = remaining_members.first() else {
            panic!("fixed-match fixture must contain at least two players");
        };
        first_member.member_id.clone_from(&second_member.member_id);
        assert_eq!(
            input(duplicate_member).try_into_normalized(),
            Err(AnalysisInputError::InvalidMatch),
            "a match cannot contain the same member twice"
        );

        let mut negative_incident = match_rows();
        let Some(incident_member) = negative_incident.first_mut() else {
            panic!("fixed-match fixture must contain players");
        };
        incident_member.incidents.card_shop = -1;
        assert_eq!(
            input(negative_incident).try_into_normalized(),
            Err(AnalysisInputError::InvalidRow),
            "incident counts are a non-negative input contract"
        );

        let mut repeated_match = match_rows();
        let mut conflicting_rows = match_rows();
        for row in &mut conflicting_rows {
            row.played_at = String::from("2026-08-11T00:00:00.000000Z");
        }
        repeated_match.extend(conflicting_rows);
        assert_eq!(
            input(repeated_match).try_into_normalized(),
            Err(AnalysisInputError::InvalidMatch),
            "one match identifier cannot form multiple chronological groups"
        );
    }

    #[test]
    fn validated_normalization_rejects_invalid_root_identity_and_revision() {
        let mut invalid_identity = input(Vec::new());
        invalid_identity.game_title_id = String::from("invalid id");
        assert_eq!(
            invalid_identity.try_into_normalized(),
            Err(AnalysisInputError::InvalidIdentity)
        );

        let mut invalid_revision = input(Vec::new());
        invalid_revision.input_revision = -1;
        assert_eq!(
            invalid_revision.try_into_normalized(),
            Err(AnalysisInputError::InvalidRevision)
        );
    }

    #[test]
    fn validated_normalization_rejects_invalid_match_sequence_and_timestamp_shape() {
        let mut invalid_match_number = match_rows();
        for row in &mut invalid_match_number {
            row.match_no_in_event = 0;
        }
        assert_eq!(
            input(invalid_match_number).try_into_normalized(),
            Err(AnalysisInputError::InvalidRow)
        );

        let mut invalid_timestamp = match_rows();
        for row in &mut invalid_timestamp {
            row.played_at = String::from("2026-08-10 00:00:00Z");
        }
        assert_eq!(
            input(invalid_timestamp).try_into_normalized(),
            Err(AnalysisInputError::InvalidRow)
        );
    }

    #[test]
    fn normalization_indexes_each_row_once_per_scope_dimension() {
        let rows = (0..1_000)
            .flat_map(|match_index| {
                match_rows().into_iter().map(move |mut row| {
                    row.match_id = format!("match-{match_index}");
                    row.season_master_id = format!("season-{match_index}");
                    row.map_master_id = format!("map-{match_index}");
                    row
                })
            })
            .collect::<Vec<_>>();
        let row_count = rows.len();
        let normalized = input(rows)
            .try_into_normalized()
            .unwrap_or_else(|error| panic!("bounded unique-scope input was rejected: {error}"));

        assert_eq!(normalized.scope_count(), 3_001);
        assert_eq!(
            normalized
                .scopes
                .iter()
                .map(|scope| scope.row_indices.len())
                .sum::<usize>(),
            row_count * 4,
            "a row belongs only to overall, season, map, and season-map indexes"
        );
        assert_eq!(normalized.resource_count(), Some(58_018));
    }
}
