use std::collections::BTreeMap;

use crate::{model::PlayerMatchInput, numeric::count_as_f64};

pub(super) type CompetitionRanks<'a> = BTreeMap<(&'a str, &'a str), f64>;

/// Computes average competition rank for each player within each match.
///
/// Keys borrow stable identifiers from the input snapshot; callers therefore avoid allocating two
/// new `String`s for every lookup while the map cannot outlive its source player matches.
pub(super) fn calculate_by_match<'a>(
    player_matches: &[&'a PlayerMatchInput],
    metric_value: impl Fn(&PlayerMatchInput) -> i32,
) -> CompetitionRanks<'a> {
    let mut player_matches_by_match = BTreeMap::<&str, Vec<&PlayerMatchInput>>::new();
    for player_match in player_matches {
        player_matches_by_match
            .entry(&player_match.match_id)
            .or_default()
            .push(player_match);
    }

    let mut competition_ranks = BTreeMap::new();
    for player_matches_in_match in player_matches_by_match.into_values() {
        for player_match in &player_matches_in_match {
            let target_value = metric_value(player_match);
            let greater = count_as_f64(
                player_matches_in_match
                    .iter()
                    .filter(|candidate| metric_value(candidate) > target_value)
                    .count(),
            );
            let tied = count_as_f64(
                player_matches_in_match
                    .iter()
                    .filter(|candidate| metric_value(candidate) == target_value)
                    .count(),
            );
            if let Some(rank) = greater
                .zip(tied)
                .map(|(greater, tied)| greater + 1.0 + (tied - 1.0) / 2.0)
            {
                competition_ranks.insert(
                    (
                        player_match.match_id.as_str(),
                        player_match.member_id.as_str(),
                    ),
                    rank,
                );
            }
        }
    }
    competition_ranks
}

pub(super) fn rank_for(
    competition_ranks: &CompetitionRanks<'_>,
    player_match: &PlayerMatchInput,
) -> Option<f64> {
    competition_ranks
        .get(&(
            player_match.match_id.as_str(),
            player_match.member_id.as_str(),
        ))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::IncidentCounts;

    fn player_match(member_id: &str, revenue: i32) -> PlayerMatchInput {
        PlayerMatchInput {
            match_id: String::from("match-1"),
            match_revision: 1,
            played_at: String::from("2026-08-10T00:00:00.000000Z"),
            held_event_id: String::from("event-1"),
            match_no_in_event: 1,
            season_master_id: String::from("season-1"),
            map_master_id: String::from("map-1"),
            member_id: String::from(member_id),
            play_order: 1,
            rank: 1,
            total_assets_man_yen: 0,
            revenue_man_yen: revenue,
            incidents: IncidentCounts::default(),
        }
    }

    #[test]
    fn ties_receive_the_average_competition_rank() {
        let player_matches = [
            player_match("a", 30),
            player_match("b", 20),
            player_match("c", 20),
            player_match("d", 10),
        ];
        let borrowed_matches = player_matches.iter().collect::<Vec<_>>();
        let competition_ranks = calculate_by_match(&borrowed_matches, |player_match| {
            player_match.revenue_man_yen
        });

        assert_eq!(
            player_matches
                .iter()
                .map(|player_match| rank_for(&competition_ranks, player_match))
                .collect::<Vec<_>>(),
            vec![Some(1.0), Some(2.5), Some(2.5), Some(4.0)]
        );
    }
}
