use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    model::MatchPlayerRow,
    stats::{
        average, median_f64, median_i32, momentum_status, percentile_i32, population_stddev,
        quality_status, rate, sample_maturity,
    },
};

use super::support::{
    head_to_head_signal, relative_intensity, revenue_asset_rate, signal_intensity,
};

pub(super) fn head_to_head(players: &[String], rows: &[&MatchPlayerRow]) -> Value {
    let lookup = rows
        .iter()
        .map(|row| ((row.match_id.as_str(), row.member_id.as_str()), *row))
        .collect::<BTreeMap<_, _>>();
    let entries = players
        .iter()
        .flat_map(|subject| {
            let lookup = &lookup;
            players.iter().map(move |opponent| {
                if subject == opponent {
                    return json!({
                        "itemId": format!("head-to-head:{subject}:{opponent}"),
                        "subjectMemberId": subject,
                        "opponentMemberId": opponent,
                        "matchCount": 0,
                        "betterRankCount": 0,
                        "betterRankRate": null,
                        "averageRankDiff": null,
                        "averageAssetsDiff": null,
                        "qualityStatus": "no_target",
                        "signal": "self",
                        "relativeIntensity": "none",
                    });
                }
                let pairs = rows
                    .iter()
                    .copied()
                    .filter(|row| row.member_id == *subject)
                    .filter_map(|row| lookup.get(&(row.match_id.as_str(), opponent.as_str())).map(|opponent_row| (row, *opponent_row)))
                    .collect::<Vec<_>>();
                let better = pairs.iter().filter(|(left, right)| left.rank < right.rank).count();
                let better_rate = rate(better, pairs.len());
                let rank_diff = average(pairs.iter().map(|(left, right)| f64::from(right.rank - left.rank)));
                let signal = head_to_head_signal(pairs.len(), better_rate, rank_diff);
                json!({
                    "itemId": format!("head-to-head:{subject}:{opponent}"),
                    "subjectMemberId": subject,
                    "opponentMemberId": opponent,
                    "matchCount": pairs.len(),
                    "sampleMaturity": sample_maturity(pairs.len()),
                    "betterRankCount": better,
                    "betterRankRate": better_rate,
                    "averageRankDiff": rank_diff,
                    "averageAssetsDiff": average(pairs.iter().map(|(left, right)| f64::from(left.total_assets_man_yen) - f64::from(right.total_assets_man_yen))),
                    "qualityStatus": quality_status(pairs.len()),
                    "signal": signal,
                    "relativeIntensity": signal_intensity(signal),
                })
            })
        })
        .collect::<Vec<_>>();
    json!({ "entries": entries })
}

pub(super) fn momentum_switch(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
) -> Vec<Value> {
    players
        .iter()
        .map(|member_id| {
            let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
            let transitions = rows
                .windows(2)
                .filter_map(|pair| match pair {
                    [previous, current] => Some((*previous, *current)),
                    _ => None,
                })
                .collect::<Vec<_>>();
            let mut cells = Vec::new();
            for previous_rank in 1..=4 {
                let target = transitions
                    .iter()
                    .filter(|(previous, _)| previous.rank == previous_rank)
                    .collect::<Vec<_>>();
                for next_rank in 1..=4 {
                    let count = target
                        .iter()
                        .filter(|(_, current)| current.rank == next_rank)
                        .count();
                    let cell_rate = rate(count, target.len());
                    cells.push(json!({
                        "itemId": format!("momentum:{member_id}:{previous_rank}:{next_rank}"),
                        "previousRank": previous_rank,
                        "nextRank": next_rank,
                        "targetCount": target.len(),
                        "count": count,
                        "rate": cell_rate,
                        "qualityStatus": momentum_status(target.len()),
                        "relativeIntensity": relative_intensity(cell_rate),
                    }));
                }
            }
            let podium_baseline = rate(rows.iter().filter(|row| row.rank <= 2).count(), rows.len());
            let lower_baseline = rate(rows.iter().filter(|row| row.rank >= 3).count(), rows.len());
            json!({
                "memberId": member_id,
                "denominator": rows.len(),
                "transitionCount": transitions.len(),
                "afterLower": momentum_rate(&transitions, |row| row.rank >= 3, |row| row.rank <= 2, podium_baseline, false),
                "afterFourth": momentum_rate(&transitions, |row| row.rank == 4, |row| row.rank <= 2, podium_baseline, false),
                "afterPodium": momentum_rate(&transitions, |row| row.rank <= 2, |row| row.rank >= 3, lower_baseline, true),
                "cells": cells,
            })
        })
        .collect()
}

fn momentum_rate(
    transitions: &[(&MatchPlayerRow, &MatchPlayerRow)],
    previous: impl Fn(&MatchPlayerRow) -> bool,
    current: impl Fn(&MatchPlayerRow) -> bool,
    baseline: Option<f64>,
    inverse: bool,
) -> Value {
    let target = transitions
        .iter()
        .filter(|(row, _)| previous(row))
        .collect::<Vec<_>>();
    let success = target.iter().filter(|(_, row)| current(row)).count();
    let actual = rate(success, target.len());
    let delta = actual
        .zip(baseline)
        .map(|(value, baseline)| value - baseline);
    let status = momentum_status(target.len());
    let signal = if status != "ok" {
        "none"
    } else if delta.is_some_and(|value| {
        if inverse {
            value <= -0.06
        } else {
            value >= 0.06
        }
    }) {
        "strength"
    } else if delta.is_some_and(|value| {
        if inverse {
            value >= 0.06
        } else {
            value <= -0.06
        }
    }) {
        "risk"
    } else {
        "none"
    };
    json!({
        "targetCount": target.len(),
        "successCount": success,
        "rate": actual,
        "baselineRate": baseline,
        "deltaFromBaseline": delta,
        "qualityStatus": status,
        "signal": signal,
    })
}

pub(super) fn performance_profiles(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
) -> Value {
    let bases = players
        .iter()
        .map(|member_id| {
            let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
            let rank_values = rows
                .iter()
                .map(|row| f64::from(row.rank))
                .collect::<Vec<_>>();
            let rank_score = average(rows.iter().map(|row| f64::from(5 - row.rank)));
            let revenue_asset = average(rows.iter().filter_map(|row| revenue_asset_rate(row)));
            (
                member_id,
                rows.len(),
                population_stddev(&rank_values),
                rank_score,
                revenue_asset,
            )
        })
        .collect::<Vec<_>>();
    let risk_median = median_f64(&bases.iter().filter_map(|base| base.2).collect::<Vec<_>>());
    let score_median = median_f64(&bases.iter().filter_map(|base| base.3).collect::<Vec<_>>());
    let revenue_median = median_f64(&bases.iter().filter_map(|base| base.4).collect::<Vec<_>>());
    let entries = bases
        .iter()
        .map(|(member_id, count, risk, score, revenue)| {
            let profile = risk.zip(*score).zip(risk_median.zip(score_median)).map(
                |((risk, score), (risk_median, score_median))| {
                    if risk <= risk_median && score >= score_median {
                        "steady_leader"
                    } else if risk > risk_median && score >= score_median {
                        "swing_leader"
                    } else if risk <= risk_median {
                        "steady_chaser"
                    } else {
                        "swing_chaser"
                    }
                },
            );
            let strategy = revenue.zip(revenue_median).map(|(value, median)| {
                if bases.len() < 3 {
                    "balanced"
                } else if value >= median + 0.0035 {
                    "property_focused"
                } else if value <= median - 0.0035 {
                    "card_focused"
                } else {
                    "balanced"
                }
            });
            json!({
                "memberId": member_id,
                "rankStandardDeviation": risk,
                "averageRankScore": score,
                "averageRevenueAssetRate": revenue,
                "profileKind": profile,
                "strategyKind": strategy,
                "qualityStatus": quality_status(*count),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "rankStandardDeviationMedian": risk_median,
        "averageRankScoreMedian": score_median,
        "averageRevenueAssetRateMedian": revenue_median,
        "entries": entries,
    })
}

pub(super) fn asset_style_profiles(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
    all_rows: &[&MatchPlayerRow],
) -> Value {
    let assets = all_rows
        .iter()
        .map(|row| row.total_assets_man_yen)
        .collect::<Vec<_>>();
    let low = percentile_i32(&assets, 0.1);
    let high = percentile_i32(&assets, 0.9);
    let bases = players
        .iter()
        .map(|member_id| {
            let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
            let values = rows
                .iter()
                .map(|row| row.total_assets_man_yen)
                .collect::<Vec<_>>();
            let high_count = high.map_or(0, |threshold| {
                values
                    .iter()
                    .filter(|value| f64::from(**value) >= threshold)
                    .count()
            });
            let low_count = low.map_or(0, |threshold| {
                values
                    .iter()
                    .filter(|value| f64::from(**value) <= threshold)
                    .count()
            });
            let win_count = rows.iter().filter(|row| row.rank == 1).count();
            let podium_count = rows.iter().filter(|row| row.rank <= 2).count();
            let high_rate = rate(high_count, rows.len());
            let low_rate = rate(low_count, rows.len());
            let win_rate = rate(win_count, rows.len());
            let podium_rate = rate(podium_count, rows.len());
            (
                member_id,
                rows,
                values,
                high_count,
                low_count,
                high_rate,
                low_rate,
                win_rate,
                podium_rate,
            )
        })
        .collect::<Vec<_>>();
    let high_median = median_f64(&bases.iter().filter_map(|base| base.5).collect::<Vec<_>>());
    let low_median = median_f64(&bases.iter().filter_map(|base| base.6).collect::<Vec<_>>());
    let win_median = median_f64(&bases.iter().filter_map(|base| base.7).collect::<Vec<_>>());
    let entries = bases
        .iter()
        .map(|(member_id, rows, values, high_count, low_count, high_rate, low_rate, win_rate, podium_rate)| {
            let primary = if rows.is_empty() { None }
            else if high_rate.zip(high_median).is_some_and(|(value, median)| value >= median + 0.015) && win_rate.zip(win_median).is_some_and(|(value, median)| value >= median) { Some("asset_explosion") }
            else if low_rate.zip(low_median).is_some_and(|(value, median)| value >= median + 0.015) { Some("high_risk_breakthrough") }
            else if low_rate.zip(low_median).is_some_and(|(value, median)| value <= median - 0.025) { Some("steady_accumulator") }
            else { Some("balanced") };
            let evidence = [
                json!({ "kind": "high_asset_rate", "value": high_rate, "tone": if primary == Some("asset_explosion") { "strength" } else { "neutral" } }),
                json!({ "kind": "low_asset_rate", "value": low_rate, "tone": if primary == Some("high_risk_breakthrough") { "risk" } else { "neutral" } }),
                json!({ "kind": "win_rate", "value": win_rate, "tone": "neutral" }),
            ];
            json!({
                "memberId": member_id,
                "targetCount": rows.len(),
                "primaryKind": primary,
                "shapeKind": if values.is_empty() { Value::Null } else if percentile_i32(values, 0.9).zip(percentile_i32(values, 0.1)).is_some_and(|(upper, lower)| upper - lower >= 50_000.0) { json!("wide") } else { json!("compact") },
                "qualityStatus": quality_status(rows.len()),
                "evidence": evidence,
                "metrics": {
                    "p10Assets": percentile_i32(values, 0.1),
                    "medianAssets": median_i32(values),
                    "p90Assets": percentile_i32(values, 0.9),
                    "highAssetCount": high_count,
                    "highAssetRate": high_rate,
                    "lowAssetCount": low_count,
                    "lowAssetRate": low_rate,
                    "winRate": win_rate,
                    "podiumRate": podium_rate,
                    "averageRevenueAssetRate": average(rows.iter().filter_map(|row| revenue_asset_rate(row))),
                    "destinationAverage": average(rows.iter().map(|row| f64::from(row.incidents.destination))),
                },
            })
        })
        .collect::<Vec<_>>();
    json!({ "lowAssetThreshold": low, "highAssetThreshold": high, "entries": entries })
}

pub(super) fn card_shop_destination(
    players: &[String],
    rows_by_player: &BTreeMap<String, Vec<&MatchPlayerRow>>,
) -> Vec<Value> {
    let kinds = [
        "destination_with_shop",
        "destination_without_shop",
        "no_destination_with_shop",
        "no_destination_without_shop",
    ];
    players
        .iter()
        .map(|member_id| {
            let rows = rows_by_player.get(member_id).map_or(&[][..], Vec::as_slice);
            let card_shop_count = rows.iter().filter(|row| row.incidents.card_shop > 0).count();
            let quadrants = kinds
                .into_iter()
                .map(|kind| {
                    let target = rows.iter().copied().filter(|row| {
                        let destination = row.incidents.destination > 0;
                        let shop = row.incidents.card_shop > 0;
                        match kind {
                            "destination_with_shop" => destination && shop,
                            "destination_without_shop" => destination && !shop,
                            "no_destination_with_shop" => !destination && shop,
                            _ => !destination && !shop,
                        }
                    }).collect::<Vec<_>>();
                    json!({
                        "itemId": format!("card-shop:{member_id}:{kind}"),
                        "kind": kind,
                        "targetCount": target.len(),
                        "rate": rate(target.len(), rows.len()),
                        "averageRank": average(target.iter().map(|row| f64::from(row.rank))),
                        "winRate": rate(target.iter().filter(|row| row.rank == 1).count(), target.len()),
                        "podiumRate": rate(target.iter().filter(|row| row.rank <= 2).count(), target.len()),
                        "averageAssets": average(target.iter().map(|row| f64::from(row.total_assets_man_yen))),
                        "averageRevenue": average(target.iter().map(|row| f64::from(row.revenue_man_yen))),
                        "qualityStatus": quality_status(target.len()),
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "memberId": member_id,
                "denominator": rows.len(),
                "cardShopMatchCount": card_shop_count,
                "cardShopRate": rate(card_shop_count, rows.len()),
                "cardShopWithoutDestinationCount": rows.iter().filter(|row| row.incidents.card_shop > 0 && row.incidents.destination == 0).count(),
                "quadrants": quadrants,
            })
        })
        .collect()
}
