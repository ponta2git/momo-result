use std::collections::BTreeMap;

use crate::model::MatchPlayerRow;

use super::{
    FoldEvaluation, MatchKey, PLAYER_COUNT, PairRecord, PlayerUnexpectedWins, UnexpectedWin,
    encoding::distinct_matches, solver::probability,
};

type ExpectedRanks = BTreeMap<String, [Option<f64>; PLAYER_COUNT]>;

pub(super) fn expected_ranks(evaluations: &[FoldEvaluation]) -> Result<ExpectedRanks, ()> {
    let mut expected = BTreeMap::new();
    for evaluation in evaluations {
        let mut pairs_by_match = BTreeMap::<MatchKey, Vec<&PairRecord>>::new();
        for pair in &evaluation.test_pairs {
            pairs_by_match.entry(pair.match_key).or_default().push(pair);
        }
        for (match_key, pairs) in pairs_by_match {
            let mut ranks = BTreeMap::<usize, f64>::new();
            for pair in pairs {
                ranks.entry(pair.left_member_index).or_insert(1.0);
                ranks.entry(pair.right_member_index).or_insert(1.0);
                let left_above =
                    probability(&pair.full.features, &evaluation.full_fit.coefficients)?;
                *ranks.get_mut(&pair.left_member_index).ok_or(())? += 1.0 - left_above;
                *ranks.get_mut(&pair.right_member_index).ok_or(())? += left_above;
            }
            let match_id = evaluation
                .test_events
                .get(match_key.event_index)
                .and_then(|event| event.matches.get(match_key.match_index))
                .map(|rank_match| rank_match.match_id.as_ref().to_owned())
                .ok_or(())?;
            let expected_by_player = expected.entry(match_id).or_insert([None; PLAYER_COUNT]);
            for (member_index, rank) in ranks {
                *expected_by_player.get_mut(member_index).ok_or(())? = Some(rank);
            }
        }
    }
    Ok(expected)
}

pub(super) fn build_unexpected_wins(
    rows: &[&MatchPlayerRow],
    players: &[String],
    expected: &ExpectedRanks,
) -> Result<Vec<PlayerUnexpectedWins>, ()> {
    let index_by_match = distinct_matches(rows)
        .iter()
        .enumerate()
        .filter_map(|(index, group)| group.first().map(|row| (row.match_id.as_str(), index + 1)))
        .collect::<BTreeMap<_, _>>();
    players
        .iter()
        .enumerate()
        .map(
            |(member_index, member_id)| -> Result<PlayerUnexpectedWins, ()> {
                let mut total_win_count = 0_usize;
                let mut unexpected = Vec::new();
                for row in rows
                    .iter()
                    .filter(|row| row.member_id == *member_id && row.rank == 1)
                {
                    total_win_count = total_win_count.saturating_add(1);
                    let expected_rank = expected
                        .get(row.match_id.as_str())
                        .and_then(|ranks| ranks.get(member_index))
                        .copied()
                        .flatten()
                        .ok_or(())?;
                    if expected_rank >= 2.5 {
                        unexpected.push(UnexpectedWin {
                            match_index: index_by_match
                                .get(row.match_id.as_str())
                                .copied()
                                .ok_or(())?,
                            match_id: row.match_id.clone(),
                            held_event_id: row.held_event_id.clone(),
                            match_no_in_event: row.match_no_in_event,
                            played_at: row.played_at.clone(),
                            expected_rank,
                            rank: row.rank,
                            revenue_man_yen: row.revenue_man_yen,
                            incidents: row.incidents,
                        });
                    }
                }
                Ok(PlayerUnexpectedWins {
                    member_id: member_id.clone(),
                    total_win_count,
                    wins: unexpected,
                })
            },
        )
        .collect()
}
