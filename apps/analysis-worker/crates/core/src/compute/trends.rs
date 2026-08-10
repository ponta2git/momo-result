use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::{
    model::MatchPlayerRow,
    numeric::{ceil_i64, count_as_f64, exact_i64_as_f64, floor_i64},
    stats::{average, percentile_f64, percentile_i32, population_stddev, quality_status, rate},
};

use super::support::MatchGroup;

pub(super) fn trends(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
) -> Vec<Value> {
    TrendKind::ALL
        .into_iter()
        .flat_map(|kind| {
            players.iter().map(move |member_id| {
                let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
                let mut accumulator = TrendAccumulator::new(kind, rows.len());
                let points = rows
                    .iter()
                    .enumerate()
                    .map(|(index, row)| {
                        let value = accumulator.push(row);
                        json!({
                            "itemId": format!("trend:{}:{}:{}", kind.wire(), member_id, row.match_id),
                            "index": index + 1,
                            "matchId": row.match_id,
                            "playedAt": row.played_at,
                            "value": value,
                        })
                    })
                    .collect::<Vec<_>>();
                json!({ "kind": kind.wire(), "memberId": member_id, "points": points })
            })
        })
        .collect()
}

#[derive(Clone, Copy)]
enum TrendKind {
    RankAverage,
    RankStandardDeviation,
    PodiumRate,
    LowerHalfRate,
    GinjiCount,
}

impl TrendKind {
    const ALL: [Self; 5] = [
        Self::RankAverage,
        Self::RankStandardDeviation,
        Self::PodiumRate,
        Self::LowerHalfRate,
        Self::GinjiCount,
    ];

    const fn wire(self) -> &'static str {
        match self {
            Self::RankAverage => "rank_cumulative_average",
            Self::RankStandardDeviation => "rank_cumulative_standard_deviation",
            Self::PodiumRate => "podium_cumulative_rate",
            Self::LowerHalfRate => "lower_half_cumulative_rate",
            Self::GinjiCount => "ginji_cumulative_count",
        }
    }
}

enum TrendAccumulator {
    RankAverage { total: f64, count: usize },
    RankStandardDeviation(Vec<f64>),
    PodiumRate { matches: usize, podiums: usize },
    LowerHalfRate { matches: usize, lower_halves: usize },
    GinjiCount(f64),
}

impl TrendAccumulator {
    fn new(kind: TrendKind, capacity: usize) -> Self {
        match kind {
            TrendKind::RankAverage => Self::RankAverage {
                total: 0.0,
                count: 0,
            },
            TrendKind::RankStandardDeviation => {
                Self::RankStandardDeviation(Vec::with_capacity(capacity))
            }
            TrendKind::PodiumRate => Self::PodiumRate {
                matches: 0,
                podiums: 0,
            },
            TrendKind::LowerHalfRate => Self::LowerHalfRate {
                matches: 0,
                lower_halves: 0,
            },
            TrendKind::GinjiCount => Self::GinjiCount(0.0),
        }
    }

    fn push(&mut self, row: &MatchPlayerRow) -> f64 {
        match self {
            Self::RankAverage { total, count } => {
                *total += f64::from(row.rank);
                *count = count.saturating_add(1);
                count_as_f64(*count).map_or(0.0, |count| *total / count)
            }
            Self::RankStandardDeviation(values) => {
                values.push(f64::from(row.rank));
                population_stddev(values).unwrap_or(0.0)
            }
            Self::PodiumRate { matches, podiums } => {
                *matches = matches.saturating_add(1);
                *podiums = podiums.saturating_add(usize::from(row.rank <= 2));
                rate(*podiums, *matches).unwrap_or(0.0)
            }
            Self::LowerHalfRate {
                matches,
                lower_halves,
            } => {
                *matches = matches.saturating_add(1);
                *lower_halves = lower_halves.saturating_add(usize::from(row.rank >= 3));
                rate(*lower_halves, *matches).unwrap_or(0.0)
            }
            Self::GinjiCount(total) => {
                *total += f64::from(row.incidents.suri_no_ginji);
                *total
            }
        }
    }
}

pub(super) fn histogram(
    rows: &[&MatchPlayerRow],
    players: &[String],
    value: impl Fn(&MatchPlayerRow) -> i32 + Copy,
) -> Value {
    let all_values = rows.iter().map(|row| value(row)).collect::<Vec<_>>();
    if all_values.is_empty() {
        return json!({ "bins": [], "series": [] });
    }
    let Some(lower) = percentile_i32(&all_values, 0.05).and_then(floor_i64) else {
        return json!({ "bins": [], "series": [] });
    };
    let Some(upper) = percentile_i32(&all_values, 0.95).and_then(ceil_i64) else {
        return json!({ "bins": [], "series": [] });
    };
    let width = ((upper - lower).max(1) + 5) / 6;
    let bins = (0..6)
        .map(|index| {
            let from = lower + index * width;
            let to = (index < 5).then_some(from + width);
            json!({
                "index": index,
                "lowerInclusive": from,
                "upperExclusive": to,
                "label": to.map_or_else(|| format!("{from}以上"), |to| format!("{from}〜{}", to - 1)),
            })
        })
        .collect::<Vec<_>>();
    let series = players
        .iter()
        .map(|member_id| {
            let player_values = rows
                .iter()
                .filter(|row| row.member_id == *member_id)
                .map(|row| value(row))
                .collect::<Vec<_>>();
            let counts = (0..6)
                .map(|index| {
                    let from = lower + index * width;
                    let to = from + width;
                    player_values
                        .iter()
                        .filter(|candidate| {
                            if index == 5 {
                                i64::from(**candidate) >= from
                            } else {
                                i64::from(**candidate) >= from && i64::from(**candidate) < to
                            }
                        })
                        .count()
                })
                .collect::<Vec<_>>();
            json!({ "memberId": member_id, "counts": counts })
        })
        .collect::<Vec<_>>();
    json!({ "bins": bins, "series": series })
}

pub(super) fn match_digest(groups: &[MatchGroup<'_>]) -> Value {
    let all = timeline_rows(groups);
    let start = all.len().saturating_sub(8);
    let recent = all.get(start..).unwrap_or_default().to_vec();
    let mut flag_counts = BTreeMap::<String, usize>::new();
    for row in &all {
        if let Some(flags) = row.get("flags").and_then(Value::as_array) {
            for flag in flags.iter().filter_map(Value::as_str) {
                *flag_counts.entry(String::from(flag)).or_default() += 1;
            }
        }
    }
    json!({
        "totalCount": all.len(),
        "shownCount": recent.len(),
        "hiddenCount": all.len().saturating_sub(recent.len()),
        "flagCounts": flag_counts,
        "recent": recent,
    })
}

fn timeline_rows(groups: &[MatchGroup<'_>]) -> Vec<Value> {
    let gaps = groups
        .iter()
        .filter_map(|group| {
            let winner = group.rows.iter().find(|row| row.rank == 1)?;
            let second = group.rows.iter().find(|row| row.rank == 2)?;
            let last = group.rows.iter().find(|row| row.rank == 4)?;
            Some((
                i64::from(winner.total_assets_man_yen) - i64::from(second.total_assets_man_yen),
                i64::from(winner.total_assets_man_yen) - i64::from(last.total_assets_man_yen),
            ))
        })
        .collect::<Vec<_>>();
    let close = percentile_f64(
        &gaps
            .iter()
            .filter_map(|value| exact_i64_as_f64(value.0))
            .collect::<Vec<_>>(),
        0.25,
    );
    let blowout = percentile_f64(
        &gaps
            .iter()
            .filter_map(|value| exact_i64_as_f64(value.1))
            .collect::<Vec<_>>(),
        0.75,
    );
    groups
        .iter()
        .enumerate()
        .map(|(index, group)| {
            let winner = group.rows.iter().find(|row| row.rank == 1);
            let second = group.rows.iter().find(|row| row.rank == 2);
            let last = group.rows.iter().find(|row| row.rank == 4);
            let max_revenue = group.rows.iter().map(|row| row.revenue_man_yen).max();
            let revenue_leaders = max_revenue.map_or_else(Vec::new, |maximum| {
                group
                    .rows
                    .iter()
                    .filter(|row| row.revenue_man_yen == maximum)
                    .map(|row| row.member_id.clone())
                    .collect::<Vec<_>>()
            });
            let first_second = winner.zip(second).map(|(left, right)| {
                i64::from(left.total_assets_man_yen) - i64::from(right.total_assets_man_yen)
            });
            let first_last = winner.zip(last).map(|(left, right)| {
                i64::from(left.total_assets_man_yen) - i64::from(right.total_assets_man_yen)
            });
            let ginji = group
                .rows
                .iter()
                .map(|row| i64::from(row.incidents.suri_no_ginji))
                .sum::<i64>();
            let mut flags = Vec::new();
            if winner.is_some_and(|row| !revenue_leaders.contains(&row.member_id)) {
                flags.push("revenue_top_no_win");
            }
            if ginji >= 2 {
                flags.push("ginji_storm");
            }
            if groups.len() >= 3
                && first_second.zip(close).is_some_and(|(gap, threshold)| {
                    exact_i64_as_f64(gap).is_some_and(|value| value <= threshold)
                })
            {
                flags.push("close_finish");
            }
            if groups.len() >= 3
                && first_last.zip(blowout).is_some_and(|(gap, threshold)| {
                    exact_i64_as_f64(gap).is_some_and(|value| value >= threshold)
                })
            {
                flags.push("asset_blowout");
            }
            json!({
                "itemId": format!("match:{}", group.match_id),
                "matchIndex": index + 1,
                "matchId": group.match_id,
                "playedAt": group.played_at,
                "heldEventId": group.held_event_id,
                "matchNoInEvent": group.match_no_in_event,
                "assetGapFirstToSecond": first_second,
                "assetGapFirstToLast": first_last,
                "totalGinjiCount": ginji,
                "revenueTopMemberIds": revenue_leaders,
                "winnerMemberId": winner.map(|row| &row.member_id),
                "flags": flags,
                "qualityStatus": quality_status(groups.len()),
            })
        })
        .collect()
}

pub(super) fn match_no_in_event(players: &[String], rows: &[&MatchPlayerRow]) -> Value {
    let numbers = rows
        .iter()
        .map(|row| row.match_no_in_event)
        .collect::<BTreeSet<_>>();
    let entries = numbers
        .iter()
        .map(|number| {
            let player_rows = players
                .iter()
                .map(|member_id| {
                    let target = || {
                        rows.iter().filter(|row| {
                            row.member_id == *member_id && row.match_no_in_event == *number
                        })
                    };
                    let target_count = target().count();
                    json!({
                        "memberId": member_id,
                        "targetCount": target_count,
                        "averageRank": average(target().map(|row| f64::from(row.rank))),
                        "podiumRate": rate(target().filter(|row| row.rank <= 2).count(), target_count),
                        "qualityStatus": quality_status(target_count),
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "matchNoInEvent": number,
                "category": if *number <= 4 { "regular" } else { "additional" },
                "players": player_rows,
            })
        })
        .collect::<Vec<_>>();
    json!({ "entries": entries })
}
