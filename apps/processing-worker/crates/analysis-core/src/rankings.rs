use std::collections::BTreeMap;

use crate::{model::MatchPlayerRow, numeric::count_as_f64};

pub(super) type MatchPlayerRanks<'a> = BTreeMap<(&'a str, &'a str), f64>;

/// Computes average competition rank for each player within each match.
///
/// Keys borrow stable identifiers from the input snapshot; callers therefore avoid allocating two
/// new `String`s for every lookup while the map cannot outlive its source rows.
pub(super) fn by_match<'a>(
    rows: &[&'a MatchPlayerRow],
    value: impl Fn(&MatchPlayerRow) -> i32,
) -> MatchPlayerRanks<'a> {
    let mut rows_by_match = BTreeMap::<&str, Vec<&MatchPlayerRow>>::new();
    for row in rows {
        rows_by_match.entry(&row.match_id).or_default().push(row);
    }

    let mut ranks = BTreeMap::new();
    for group in rows_by_match.into_values() {
        for row in &group {
            let target = value(row);
            let greater = count_as_f64(
                group
                    .iter()
                    .filter(|candidate| value(candidate) > target)
                    .count(),
            );
            let tied = count_as_f64(
                group
                    .iter()
                    .filter(|candidate| value(candidate) == target)
                    .count(),
            );
            if let Some(rank) = greater
                .zip(tied)
                .map(|(greater, tied)| greater + 1.0 + (tied - 1.0) / 2.0)
            {
                ranks.insert((row.match_id.as_str(), row.member_id.as_str()), rank);
            }
        }
    }
    ranks
}

pub(super) fn value(ranks: &MatchPlayerRanks<'_>, row: &MatchPlayerRow) -> Option<f64> {
    ranks
        .get(&(row.match_id.as_str(), row.member_id.as_str()))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::IncidentCounts;

    fn row(member_id: &str, revenue: i32) -> MatchPlayerRow {
        MatchPlayerRow {
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
        let rows = [row("a", 30), row("b", 20), row("c", 20), row("d", 10)];
        let borrowed = rows.iter().collect::<Vec<_>>();
        let ranks = by_match(&borrowed, |row| row.revenue_man_yen);

        assert_eq!(
            rows.iter()
                .map(|row| value(&ranks, row))
                .collect::<Vec<_>>(),
            vec![Some(1.0), Some(2.5), Some(2.5), Some(4.0)]
        );
    }
}
