use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    model::PlayerMatchInput,
    rankings::{MatchPlayerRanks, value as rank_value},
    stats::{average, median_i32, population_stddev, quality_status, rate},
};

use super::support::{
    MatchGroup, distribution, maxima_by_match, relative_intensity, revenue_asset_rate, suffix_count,
};

const RECENT_WINDOW: usize = 20;

pub(super) fn leader_summary(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> (Vec<String>, Option<f64>) {
    let average_ranks = players
        .iter()
        .filter_map(|member_id| {
            average(
                player_matches_by_member
                    .get(member_id)
                    .into_iter()
                    .flatten()
                    .map(|row| f64::from(row.rank)),
            )
        })
        .collect::<Vec<_>>();
    let rank_spread = if average_ranks.len() >= 2 {
        Some(
            average_ranks
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max)
                - average_ranks.iter().copied().fold(f64::INFINITY, f64::min),
        )
    } else {
        None
    };
    let leader_average = average_ranks.iter().copied().fold(f64::INFINITY, f64::min);
    let leader_member_ids = players
        .iter()
        .filter(|member_id| {
            player_matches_by_member
                .get(*member_id)
                .is_some_and(|player_rows| {
                    average(player_rows.iter().map(|row| f64::from(row.rank)))
                        .is_some_and(|value| (value - leader_average).abs() < 1e-12)
                })
        })
        .cloned()
        .collect::<Vec<_>>();
    (leader_member_ids, rank_spread)
}

pub(super) fn player_metrics(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
    all_rows: &[&PlayerMatchInput],
    revenue_ranks: &MatchPlayerRanks<'_>,
    destination_ranks: &MatchPlayerRanks<'_>,
) -> Vec<Value> {
    let revenue_max_by_match = maxima_by_match(all_rows, |row| row.revenue_man_yen);
    let destination_max_by_match = maxima_by_match(all_rows, |row| row.incidents.destination);
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member.get(member_id).map_or(&[][..], Vec::as_slice);
            let ranks = rows.iter().map(|row| f64::from(row.rank)).collect::<Vec<_>>();
            let assets = rows.iter().map(|row| row.total_assets_man_yen).collect::<Vec<_>>();
            let revenue = rows.iter().map(|row| row.revenue_man_yen).collect::<Vec<_>>();
            let podium_count = rows.iter().filter(|row| row.rank <= 2).count();
            let lower_half_count = rows.iter().filter(|row| row.rank >= 3).count();
            let subsets = player_metric_subsets(
                rows,
                revenue_ranks,
                destination_ranks,
                &revenue_max_by_match,
                &destination_max_by_match,
            );
            let average_rank = average(&ranks);
            let revenue_rank_average = average(&subsets.revenue_rank_values);
            let destination_rank_average = average(&subsets.destination_rank_values);
            json!({
                "memberId": member_id,
                "denominator": rows.len(),
                "qualityStatus": quality_status(rows.len()),
                "rank": {
                    "average": average_rank,
                    "standardDeviation": population_stddev(&ranks),
                    "distribution": distribution(rows),
                },
                "assets": {
                    "max": assets.iter().max(),
                    "min": assets.iter().min(),
                    "average": average(assets.iter().map(|value| f64::from(*value))),
                    "median": median_i32(&assets),
                },
                "revenue": {
                    "max": revenue.iter().max(),
                    "average": average(revenue.iter().map(|value| f64::from(*value))),
                    "median": median_i32(&revenue),
                },
                "podium": { "count": podium_count, "rate": rate(podium_count, rows.len()) },
                "lowerHalf": { "count": lower_half_count, "rate": rate(lower_half_count, rows.len()) },
                "playOrder": play_order_metrics(rows, all_rows),
                "ginji": {
                    "count": rows.iter().map(|row| i64::from(row.incidents.suri_no_ginji)).sum::<i64>(),
                    "encounterMatches": subsets.ginji.len(),
                    "encounterRate": rate(subsets.ginji.len(), rows.len()),
                    "multiEncounterMatchCount": rows.iter().filter(|row| row.incidents.suri_no_ginji >= 2).count(),
                    "maxInSingleMatch": rows.iter().map(|row| row.incidents.suri_no_ginji).max().unwrap_or(0),
                    "resilienceRankAverage": average(subsets.ginji.iter().map(|row| f64::from(row.rank))),
                    "resilienceAssetsAverage": average(subsets.ginji.iter().map(|row| f64::from(row.total_assets_man_yen))),
                    "resilienceRevenueAverage": average(subsets.ginji.iter().map(|row| f64::from(row.revenue_man_yen))),
                },
                "nonRevenue": {
                    "rankDelta": revenue_rank_average.zip(average_rank).map(|(revenue_rank, rank)| revenue_rank - rank),
                    "highRevenueNoWinCount": subsets.top_revenue.iter().filter(|row| row.rank != 1).count(),
                    "highRevenueTopCount": subsets.top_revenue.len(),
                    "highRevenueNoWinRate": rate(subsets.top_revenue.iter().filter(|row| row.rank != 1).count(), subsets.top_revenue.len()),
                },
                "destination": {
                    "conversionDelta": destination_rank_average.zip(average_rank).map(|(destination_rank, rank)| destination_rank - rank),
                    "dependenceScore": destination_dependence(rows, destination_ranks),
                    "upperTargetCount": rows.iter().filter(|row| rank_value(destination_ranks, row).is_some_and(|rank| rank < 2.5)).count(),
                    "lowerTargetCount": rows.iter().filter(|row| rank_value(destination_ranks, row).is_some_and(|rank| rank > 2.5)).count(),
                },
                "revenueOutcome": {
                    "top": conditional_outcome(&subsets.top_revenue),
                    "lowRevenue": conditional_outcome(&subsets.low_revenue),
                    "nonTopWinCount": rows.iter().filter(|row| row.rank == 1 && revenue_max_by_match.get(row.match_id.as_str()) != Some(&row.revenue_man_yen)).count(),
                },
                "destinationOutcome": {
                    "top": conditional_outcome(&subsets.top_destination),
                    "lowDestination": conditional_outcome(&subsets.low_destination),
                    "zeroDestination": conditional_outcome(&subsets.zero_destination),
                },
            })
        })
        .collect()
}

struct PlayerMetricSubsets<'a> {
    ginji: Vec<&'a PlayerMatchInput>,
    top_revenue: Vec<&'a PlayerMatchInput>,
    low_revenue: Vec<&'a PlayerMatchInput>,
    top_destination: Vec<&'a PlayerMatchInput>,
    low_destination: Vec<&'a PlayerMatchInput>,
    zero_destination: Vec<&'a PlayerMatchInput>,
    revenue_rank_values: Vec<f64>,
    destination_rank_values: Vec<f64>,
}

fn player_metric_subsets<'a>(
    rows: &[&'a PlayerMatchInput],
    revenue_ranks: &MatchPlayerRanks<'_>,
    destination_ranks: &MatchPlayerRanks<'_>,
    revenue_max_by_match: &BTreeMap<&str, i32>,
    destination_max_by_match: &BTreeMap<&str, i32>,
) -> PlayerMetricSubsets<'a> {
    let mut subsets = PlayerMetricSubsets {
        ginji: Vec::new(),
        top_revenue: Vec::new(),
        low_revenue: Vec::new(),
        top_destination: Vec::new(),
        low_destination: Vec::new(),
        zero_destination: Vec::new(),
        revenue_rank_values: Vec::new(),
        destination_rank_values: Vec::new(),
    };
    for row in rows.iter().copied() {
        if row.incidents.suri_no_ginji > 0 {
            subsets.ginji.push(row);
        }
        if revenue_max_by_match.get(row.match_id.as_str()) == Some(&row.revenue_man_yen) {
            subsets.top_revenue.push(row);
        }
        if row.incidents.destination == 0 {
            subsets.zero_destination.push(row);
        }
        if destination_max_by_match
            .get(row.match_id.as_str())
            .is_some_and(|maximum| *maximum > 0 && *maximum == row.incidents.destination)
        {
            subsets.top_destination.push(row);
        }
        if let Some(rank) = rank_value(revenue_ranks, row) {
            subsets.revenue_rank_values.push(rank);
            if rank > 2.5 {
                subsets.low_revenue.push(row);
            }
        }
        if let Some(rank) = rank_value(destination_ranks, row) {
            subsets.destination_rank_values.push(rank);
            if rank > 2.5 {
                subsets.low_destination.push(row);
            }
        }
    }
    subsets
}

fn play_order_metrics(rows: &[&PlayerMatchInput], all_rows: &[&PlayerMatchInput]) -> Value {
    let mut breakdown = Vec::new();
    let mut assets_differences = Vec::new();
    let mut revenue_differences = Vec::new();
    let mut assets_indices = Vec::new();
    let mut revenue_indices = Vec::new();
    for play_order in 1..=4 {
        let baseline_assets = average(
            all_rows
                .iter()
                .filter(|row| row.play_order == play_order)
                .map(|row| f64::from(row.total_assets_man_yen)),
        );
        let baseline_revenue = average(
            all_rows
                .iter()
                .filter(|row| row.play_order == play_order)
                .map(|row| f64::from(row.revenue_man_yen)),
        );
        let target = || rows.iter().filter(|row| row.play_order == play_order);
        let target_count = target().count();
        for row in target() {
            if let Some(value) = baseline_assets {
                assets_differences.push(f64::from(row.total_assets_man_yen) - value);
                if value > 0.0 {
                    assets_indices.push(f64::from(row.total_assets_man_yen) / value);
                }
            }
            if let Some(value) = baseline_revenue {
                revenue_differences.push(f64::from(row.revenue_man_yen) - value);
                if value > 0.0 {
                    revenue_indices.push(f64::from(row.revenue_man_yen) / value);
                }
            }
        }
        breakdown.push(json!({
            "playOrder": play_order,
            "matchCount": target_count,
            "rankAverage": average(target().map(|row| f64::from(row.rank))),
            "assetsAverage": average(target().map(|row| f64::from(row.total_assets_man_yen))),
            "revenueAverage": average(target().map(|row| f64::from(row.revenue_man_yen))),
            "qualityStatus": quality_status(target_count),
        }));
    }
    json!({
        "assetsDiff": average(&assets_differences),
        "revenueDiff": average(&revenue_differences),
        "assetsIndex": (assets_indices.len() == rows.len()).then(|| average(&assets_indices)).flatten(),
        "revenueIndex": (revenue_indices.len() == rows.len()).then(|| average(&revenue_indices)).flatten(),
        "breakdown": breakdown,
    })
}

fn conditional_outcome(rows: &[&PlayerMatchInput]) -> Value {
    let wins = rows.iter().filter(|row| row.rank == 1).count();
    let podium = rows.iter().filter(|row| row.rank <= 2).count();
    let lower = rows.iter().filter(|row| row.rank >= 3).count();
    json!({
        "targetCount": rows.len(),
        "winCount": wins,
        "winRate": rate(wins, rows.len()),
        "podiumCount": podium,
        "podiumRate": rate(podium, rows.len()),
        "lowerHalfCount": lower,
        "lowerHalfRate": rate(lower, rows.len()),
        "rankDistribution": distribution(rows),
        "qualityStatus": quality_status(rows.len()),
    })
}

fn destination_dependence(
    rows: &[&PlayerMatchInput],
    destination_ranks: &MatchPlayerRanks<'_>,
) -> Option<f64> {
    let upper = average(rows.iter().filter_map(|row| {
        rank_value(destination_ranks, row)
            .filter(|rank| *rank < 2.5)
            .map(|_| f64::from(5 - row.rank))
    }));
    let lower = average(rows.iter().filter_map(|row| {
        rank_value(destination_ranks, row)
            .filter(|rank| *rank > 2.5)
            .map(|_| f64::from(5 - row.rank))
    }));
    upper.zip(lower).map(|(left, right)| left - right)
}

pub(super) fn rank_distribution(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> Vec<Value> {
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member
                .get(member_id)
                .map_or(&[][..], Vec::as_slice);
            json!({
                "memberId": member_id,
                "total": rows.len(),
                "qualityStatus": quality_status(rows.len()),
                "cells": (1..=4).map(|rank_value| {
                    let count = rows.iter().filter(|row| row.rank == rank_value).count();
                    json!({
                        "itemId": format!("rank-distribution:{member_id}:{rank_value}"),
                        "rank": rank_value,
                        "count": count,
                        "rate": rate(count, rows.len()),
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect()
}

pub(super) fn recent_ranks(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> Vec<Value> {
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member.get(member_id).map_or(&[][..], Vec::as_slice);
            let start = rows.len().saturating_sub(RECENT_WINDOW);
            let selected = rows.get(start..).unwrap_or_default();
            json!({
                "memberId": member_id,
                "windowSize": RECENT_WINDOW,
                "targetCount": selected.len(),
                "usedFallback": rows.len() < RECENT_WINDOW,
                "qualityStatus": quality_status(selected.len()),
                "averageRank": average(selected.iter().map(|row| f64::from(row.rank))),
                "podiumRate": rate(selected.iter().filter(|row| row.rank <= 2).count(), selected.len()),
                "winStreak": suffix_count(rows, |row| row.rank == 1),
                "podiumStreak": suffix_count(rows, |row| row.rank <= 2),
                "lowerHalfStreak": suffix_count(rows, |row| row.rank >= 3),
                "rows": selected.iter().map(|row| json!({
                    "itemId": format!("recent-rank:{}:{}", member_id, row.match_id),
                    "matchId": row.match_id,
                    "playedAt": row.played_at,
                    "rank": row.rank,
                })).collect::<Vec<_>>(),
            })
        })
        .collect()
}

pub(super) fn strategy_scatter(
    groups: &[MatchGroup<'_>],
    revenue_ranks: &MatchPlayerRanks<'_>,
    asset_ranks: &MatchPlayerRanks<'_>,
) -> Value {
    json!({
        "points": groups.iter().enumerate().flat_map(|(index, group)| {
            group.player_matches.iter().map(move |row| json!({
                "itemId": format!("strategy-point:{}:{}", row.match_id, row.member_id),
                "matchIndex": index + 1,
                "matchId": row.match_id,
                "playedAt": row.played_at,
                "memberId": row.member_id,
                "rank": row.rank,
                "totalAssetsManYen": row.total_assets_man_yen,
                "revenueManYen": row.revenue_man_yen,
                "revenueAssetRate": revenue_asset_rate(row),
                "assetRank": rank_value(asset_ranks, row),
                "revenueRank": rank_value(revenue_ranks, row),
            }))
        }).collect::<Vec<_>>()
    })
}

pub(super) fn play_order_comparison(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> Vec<Value> {
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member.get(member_id).map_or(&[][..], Vec::as_slice);
            let mut cells = Vec::new();
            for order in 1..=4 {
                let target = rows
                    .iter()
                    .copied()
                    .filter(|row| row.play_order == order)
                    .collect::<Vec<_>>();
                let rank_average = average(target.iter().map(|row| f64::from(row.rank)));
                cells.push((order, rank_average, target.len(), target));
            }
            let available = cells.iter().filter_map(|(order, rank, _, _)| rank.map(|rank| (*order, rank))).collect::<Vec<_>>();
            let best = available.iter().min_by(|left, right| left.1.total_cmp(&right.1)).copied();
            let worst = available.iter().max_by(|left, right| left.1.total_cmp(&right.1)).copied();
            let spread = best.zip(worst).map(|(best, worst)| worst.1 - best.1);
            json!({
                "memberId": member_id,
                "bestPlayOrder": best.map(|value| value.0),
                "worstPlayOrder": worst.map(|value| value.0),
                "spread": spread,
                "signal": spread.map_or("no_target", |value| if value >= 0.75 { "large" } else if value >= 0.35 { "visible" } else { "flat" }),
                "cells": cells.into_iter().map(|(order, rank_average, count, target)| json!({
                    "itemId": format!("play-order:{member_id}:{order}"),
                    "playOrder": order,
                    "targetCount": count,
                    "rankAverage": rank_average,
                    "podiumRate": rate(target.iter().filter(|row| row.rank <= 2).count(), count),
                    "qualityStatus": quality_status(count),
                    "relativeIntensity": relative_intensity(rank_average.zip(best.map(|value| value.1)).map(|(value, best)| value - best)),
                })).collect::<Vec<_>>(),
            })
        })
        .collect()
}

pub(super) fn revenue_rank_conversion(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
    revenue_ranks: &MatchPlayerRanks<'_>,
) -> Vec<Value> {
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member.get(member_id).map_or(&[][..], Vec::as_slice);
            let cells = (1..=4)
                .flat_map(|revenue_rank| {
                    (1..=4).map(move |final_rank| {
                        let target_count = rows
                            .iter()
                            .filter(|candidate_row| {
                                rank_value(revenue_ranks, candidate_row).is_some_and(|value| {
                                    rounded_rank_is(value, revenue_rank)
                                        && candidate_row.rank == final_rank
                                })
                            })
                            .count();
                        let denominator = rows
                            .iter()
                            .filter(|candidate_row| {
                                rank_value(revenue_ranks, candidate_row)
                                    .is_some_and(|value| rounded_rank_is(value, revenue_rank))
                            })
                            .count();
                        let cell_rate = rate(target_count, denominator);
                        json!({
                            "itemId": format!("revenue-rank:{member_id}:{revenue_rank}:{final_rank}"),
                            "revenueRank": revenue_rank,
                            "finalRank": final_rank,
                            "count": target_count,
                            "rate": cell_rate,
                            "hasRevenueTie": rows.iter().any(|candidate_row| rank_value(revenue_ranks, candidate_row).is_some_and(|value| value.fract() != 0.0)),
                            "relativeIntensity": relative_intensity(cell_rate),
                        })
                    })
                })
                .collect::<Vec<_>>();
            json!({ "memberId": member_id, "cells": cells })
        })
        .collect()
}

fn rounded_rank_is(value: f64, expected: i32) -> bool {
    value.round().total_cmp(&f64::from(expected)) == std::cmp::Ordering::Equal
}
