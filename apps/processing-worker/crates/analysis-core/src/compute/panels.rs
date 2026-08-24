use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    model::PlayerMatchInput,
    numeric::round_i64,
    stats::{
        average, median_f64, median_i32, momentum_status, percentile_i32, population_stddev,
        quality_status, rate, sample_maturity,
    },
};

const ASSET_STYLE_RATE_SIGNAL_DELTA: f64 = 0.015;
const ASSET_STYLE_LOW_RISK_RATE_DELTA: f64 = 0.025;
const ASSET_STYLE_SECOND_RATE_DELTA: f64 = 0.07;
const ASSET_STYLE_DESTINATION_AVERAGE_DELTA: f64 = 0.08;
const ASSET_STYLE_WIN_MEDIAN_ASSETS_DELTA: f64 = 10_000.0;
const ASSET_STYLE_WIN_MARGIN_DELTA: f64 = 3_000.0;
const ASSET_STYLE_LOWER_GAP_DELTA: f64 = 4_000.0;
const ASSET_STYLE_BLOWOUT_WIN_RATE_DELTA: f64 = 0.025;
const STRATEGY_KIND_MEDIAN_DELTA: f64 = 0.0035;

#[derive(Clone, Debug, Default)]
struct AssetStyleMetrics {
    p10_assets: Option<f64>,
    median_assets: Option<f64>,
    p90_assets: Option<f64>,
    p90_p10_spread: Option<f64>,
    high_asset_count: usize,
    high_asset_rate: Option<f64>,
    low_asset_count: usize,
    low_asset_rate: Option<f64>,
    win_count: usize,
    win_rate: Option<f64>,
    podium_rate: Option<f64>,
    second_count: usize,
    second_rate: Option<f64>,
    lower_half_rate: Option<f64>,
    win_median_assets: Option<f64>,
    win_median_margin: Option<f64>,
    second_median_gap: Option<f64>,
    lower_half_median_gap: Option<f64>,
    blowout_win_count: usize,
    near_miss_second_count: usize,
    heavy_loss_count: usize,
    average_revenue_asset_rate: Option<f64>,
    destination_average: Option<f64>,
    destination_positive_rate: Option<f64>,
}

#[derive(Clone, Debug)]
struct AssetStyleBase<'a> {
    member_id: &'a str,
    target_count: usize,
    metrics: AssetStyleMetrics,
}

#[derive(Clone, Debug, Default)]
struct AssetStyleMedians {
    high_asset_rate: Option<f64>,
    low_asset_rate: Option<f64>,
    win_rate: Option<f64>,
    podium_rate: Option<f64>,
    second_rate: Option<f64>,
    blowout_win_rate: Option<f64>,
    win_median_assets: Option<f64>,
    win_median_margin: Option<f64>,
    lower_half_median_gap: Option<f64>,
    average_revenue_asset_rate: Option<f64>,
    destination_average: Option<f64>,
}

use super::{
    metrics::revenue_asset_rate,
    signals::{head_to_head_signal, relative_intensity, signal_intensity},
};

pub(super) fn head_to_head(players: &[String], rows: &[&PlayerMatchInput]) -> Value {
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
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> Vec<Value> {
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member.get(member_id).map_or(&[][..], Vec::as_slice);
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
    transitions: &[(&PlayerMatchInput, &PlayerMatchInput)],
    previous: impl Fn(&PlayerMatchInput) -> bool,
    current: impl Fn(&PlayerMatchInput) -> bool,
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
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> Value {
    let bases = players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member
                .get(member_id)
                .map_or(&[][..], Vec::as_slice);
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
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
    all_rows: &[&PlayerMatchInput],
) -> Value {
    let assets_by_rank = all_rows
        .iter()
        .map(|row| ((row.match_id.as_str(), row.rank), row.total_assets_man_yen))
        .collect::<BTreeMap<_, _>>();
    let assets = all_rows
        .iter()
        .map(|row| row.total_assets_man_yen)
        .collect::<Vec<_>>();
    let low = percentile_i32(&assets, 0.1);
    let high = percentile_i32(&assets, 0.9);
    let win_margins = all_rows
        .iter()
        .filter(|row| row.rank == 1)
        .map(|row| {
            row.total_assets_man_yen
                - assets_by_rank
                    .get(&(row.match_id.as_str(), 2))
                    .copied()
                    .unwrap_or(row.total_assets_man_yen)
        })
        .collect::<Vec<_>>();
    let second_gaps = all_rows
        .iter()
        .filter(|row| row.rank == 2)
        .map(|row| {
            assets_by_rank
                .get(&(row.match_id.as_str(), 1))
                .copied()
                .unwrap_or(row.total_assets_man_yen)
                - row.total_assets_man_yen
        })
        .collect::<Vec<_>>();
    let lower_gaps = all_rows
        .iter()
        .filter(|row| row.rank >= 3)
        .map(|row| {
            assets_by_rank
                .get(&(row.match_id.as_str(), 1))
                .copied()
                .unwrap_or(row.total_assets_man_yen)
                - row.total_assets_man_yen
        })
        .collect::<Vec<_>>();
    let blowout_win_threshold = percentile_i32(&win_margins, 0.75);
    let near_miss_second_threshold = percentile_i32(&second_gaps, 0.25);
    let heavy_loss_threshold = percentile_i32(&lower_gaps, 0.75);
    let bases = players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member
                .get(member_id)
                .map_or(&[][..], Vec::as_slice);
            asset_style_base(
                member_id,
                rows,
                &assets_by_rank,
                low,
                high,
                blowout_win_threshold,
                near_miss_second_threshold,
                heavy_loss_threshold,
            )
        })
        .collect::<Vec<_>>();
    let medians = asset_style_medians(&bases);
    let entries = bases
        .iter()
        .map(|base| {
            let primary = asset_style_primary_kind(base, &medians);
            let shape = asset_style_shape_kind(base, &medians);
            let tags = asset_style_tags(base, &medians, shape);
            let metrics = &base.metrics;
            let evidence = [
                json!({ "kind": "high_asset_rate", "value": metrics.high_asset_rate, "tone": if primary == Some("asset_explosion") { "strength" } else { "neutral" } }),
                json!({ "kind": "low_asset_rate", "value": metrics.low_asset_rate, "tone": if primary == Some("high_risk_breakthrough") { "risk" } else { "neutral" } }),
                json!({ "kind": "win_rate", "value": metrics.win_rate, "tone": "neutral" }),
            ];
            json!({
                "memberId": base.member_id,
                "targetCount": base.target_count,
                "primaryKind": primary,
                "secondaryKind": tags.first(),
                "shapeKind": shape,
                "tags": tags,
                "qualityStatus": quality_status(base.target_count),
                "evidence": evidence,
                "metrics": {
                    "p10Assets": metrics.p10_assets,
                    "medianAssets": metrics.median_assets,
                    "p90Assets": metrics.p90_assets,
                    "p90P10Spread": metrics.p90_p10_spread,
                    "highAssetCount": metrics.high_asset_count,
                    "highAssetRate": metrics.high_asset_rate,
                    "lowAssetCount": metrics.low_asset_count,
                    "lowAssetRate": metrics.low_asset_rate,
                    "winCount": metrics.win_count,
                    "winRate": metrics.win_rate,
                    "podiumRate": metrics.podium_rate,
                    "secondCount": metrics.second_count,
                    "secondRate": metrics.second_rate,
                    "lowerHalfRate": metrics.lower_half_rate,
                    "winMedianAssets": metrics.win_median_assets,
                    "winMedianMargin": metrics.win_median_margin,
                    "secondMedianGap": metrics.second_median_gap,
                    "lowerHalfMedianGap": metrics.lower_half_median_gap,
                    "blowoutWinCount": metrics.blowout_win_count,
                    "nearMissSecondCount": metrics.near_miss_second_count,
                    "heavyLossCount": metrics.heavy_loss_count,
                    "averageRevenueAssetRate": metrics.average_revenue_asset_rate,
                    "destinationAverage": metrics.destination_average,
                    "destinationPositiveRate": metrics.destination_positive_rate,
                },
            })
        })
        .collect::<Vec<_>>();
    json!({
        "lowAssetThreshold": low.and_then(round_i64),
        "highAssetThreshold": high.and_then(round_i64),
        "blowoutWinThreshold": blowout_win_threshold.and_then(round_i64),
        "nearMissSecondThreshold": near_miss_second_threshold.and_then(round_i64),
        "heavyLossThreshold": heavy_loss_threshold.and_then(round_i64),
        "entries": entries,
    })
}

fn asset_style_base<'a>(
    member_id: &'a str,
    rows: &[&PlayerMatchInput],
    assets_by_rank: &BTreeMap<(&str, i32), i32>,
    low_asset_threshold: Option<f64>,
    high_asset_threshold: Option<f64>,
    blowout_win_threshold: Option<f64>,
    near_miss_second_threshold: Option<f64>,
    heavy_loss_threshold: Option<f64>,
) -> AssetStyleBase<'a> {
    let assets = rows
        .iter()
        .map(|row| row.total_assets_man_yen)
        .collect::<Vec<_>>();
    let win_rows = rows
        .iter()
        .copied()
        .filter(|row| row.rank == 1)
        .collect::<Vec<_>>();
    let second_rows = rows
        .iter()
        .copied()
        .filter(|row| row.rank == 2)
        .collect::<Vec<_>>();
    let lower_rows = rows
        .iter()
        .copied()
        .filter(|row| row.rank >= 3)
        .collect::<Vec<_>>();
    let win_margins = win_rows
        .iter()
        .map(|row| {
            row.total_assets_man_yen
                - assets_by_rank
                    .get(&(row.match_id.as_str(), 2))
                    .copied()
                    .unwrap_or(row.total_assets_man_yen)
        })
        .collect::<Vec<_>>();
    let second_gaps = second_rows
        .iter()
        .map(|row| {
            assets_by_rank
                .get(&(row.match_id.as_str(), 1))
                .copied()
                .unwrap_or(row.total_assets_man_yen)
                - row.total_assets_man_yen
        })
        .collect::<Vec<_>>();
    let lower_gaps = lower_rows
        .iter()
        .map(|row| {
            assets_by_rank
                .get(&(row.match_id.as_str(), 1))
                .copied()
                .unwrap_or(row.total_assets_man_yen)
                - row.total_assets_man_yen
        })
        .collect::<Vec<_>>();
    let high_asset_count = threshold_count(&assets, high_asset_threshold, |value, threshold| {
        value >= threshold
    });
    let low_asset_count = threshold_count(&assets, low_asset_threshold, |value, threshold| {
        value <= threshold
    });
    let blowout_win_count =
        threshold_count(&win_margins, blowout_win_threshold, |value, threshold| {
            value >= threshold
        });
    let near_miss_second_count = threshold_count(
        &second_gaps,
        near_miss_second_threshold,
        |value, threshold| value <= threshold,
    );
    let heavy_loss_count =
        threshold_count(&lower_gaps, heavy_loss_threshold, |value, threshold| {
            value >= threshold
        });
    let p10_assets = percentile_i32(&assets, 0.1);
    let p90_assets = percentile_i32(&assets, 0.9);
    AssetStyleBase {
        member_id,
        target_count: rows.len(),
        metrics: AssetStyleMetrics {
            p10_assets,
            median_assets: median_i32(&assets),
            p90_assets,
            p90_p10_spread: p90_assets
                .zip(p10_assets)
                .map(|(upper, lower)| upper - lower),
            high_asset_count,
            high_asset_rate: rate(high_asset_count, rows.len()),
            low_asset_count,
            low_asset_rate: rate(low_asset_count, rows.len()),
            win_count: win_rows.len(),
            win_rate: rate(win_rows.len(), rows.len()),
            podium_rate: rate(rows.iter().filter(|row| row.rank <= 2).count(), rows.len()),
            second_count: second_rows.len(),
            second_rate: rate(second_rows.len(), rows.len()),
            lower_half_rate: rate(lower_rows.len(), rows.len()),
            win_median_assets: median_i32(
                &win_rows
                    .iter()
                    .map(|row| row.total_assets_man_yen)
                    .collect::<Vec<_>>(),
            ),
            win_median_margin: median_i32(&win_margins),
            second_median_gap: median_i32(&second_gaps),
            lower_half_median_gap: median_i32(&lower_gaps),
            blowout_win_count,
            near_miss_second_count,
            heavy_loss_count,
            average_revenue_asset_rate: average(
                rows.iter().filter_map(|row| revenue_asset_rate(row)),
            ),
            destination_average: average(
                rows.iter().map(|row| f64::from(row.incidents.destination)),
            ),
            destination_positive_rate: rate(
                rows.iter()
                    .filter(|row| row.incidents.destination > 0)
                    .count(),
                rows.len(),
            ),
        },
    }
}

fn threshold_count(
    values: &[i32],
    threshold: Option<f64>,
    compare: impl Fn(f64, f64) -> bool,
) -> usize {
    threshold.map_or(0, |threshold| {
        values
            .iter()
            .filter(|value| compare(f64::from(**value), threshold))
            .count()
    })
}

fn asset_style_medians(bases: &[AssetStyleBase<'_>]) -> AssetStyleMedians {
    let median_of = |select: fn(&AssetStyleMetrics) -> Option<f64>| {
        median_f64(
            &bases
                .iter()
                .filter_map(|base| select(&base.metrics))
                .collect::<Vec<_>>(),
        )
    };
    AssetStyleMedians {
        high_asset_rate: median_of(|metrics| metrics.high_asset_rate),
        low_asset_rate: median_of(|metrics| metrics.low_asset_rate),
        win_rate: median_of(|metrics| metrics.win_rate),
        podium_rate: median_of(|metrics| metrics.podium_rate),
        second_rate: median_of(|metrics| metrics.second_rate),
        blowout_win_rate: median_f64(
            &bases
                .iter()
                .filter_map(|base| blowout_win_rate(&base.metrics, base.target_count))
                .collect::<Vec<_>>(),
        ),
        win_median_assets: median_of(|metrics| metrics.win_median_assets),
        win_median_margin: median_of(|metrics| metrics.win_median_margin),
        lower_half_median_gap: median_of(|metrics| metrics.lower_half_median_gap),
        average_revenue_asset_rate: median_of(|metrics| metrics.average_revenue_asset_rate),
        destination_average: median_of(|metrics| metrics.destination_average),
    }
}

fn asset_style_primary_kind(
    base: &AssetStyleBase<'_>,
    medians: &AssetStyleMedians,
) -> Option<&'static str> {
    if base.target_count == 0 {
        return None;
    }
    let metrics = &base.metrics;
    let explosion_signal_count = [
        above(
            metrics.high_asset_rate,
            medians.high_asset_rate,
            ASSET_STYLE_RATE_SIGNAL_DELTA,
        ),
        above(
            blowout_win_rate(metrics, base.target_count),
            medians.blowout_win_rate,
            ASSET_STYLE_BLOWOUT_WIN_RATE_DELTA,
        ),
        above(
            metrics.win_median_assets,
            medians.win_median_assets,
            ASSET_STYLE_WIN_MEDIAN_ASSETS_DELTA,
        ),
    ]
    .into_iter()
    .filter(|signal| *signal)
    .count();
    if explosion_signal_count >= 2 {
        Some("asset_explosion")
    } else if above(
        metrics.low_asset_rate,
        medians.low_asset_rate,
        ASSET_STYLE_RATE_SIGNAL_DELTA,
    ) && (at_least(metrics.win_rate, medians.win_rate)
        || above(
            metrics.lower_half_median_gap,
            medians.lower_half_median_gap,
            ASSET_STYLE_LOWER_GAP_DELTA,
        ))
    {
        Some("high_risk_breakthrough")
    } else if below(
        blowout_win_rate(metrics, base.target_count),
        medians.blowout_win_rate,
        ASSET_STYLE_BLOWOUT_WIN_RATE_DELTA,
    ) || below(
        metrics.win_median_margin,
        medians.win_median_margin,
        ASSET_STYLE_WIN_MARGIN_DELTA,
    ) {
        Some("close_collector")
    } else if below(
        metrics.low_asset_rate,
        medians.low_asset_rate,
        ASSET_STYLE_LOW_RISK_RATE_DELTA,
    ) && at_least(metrics.podium_rate, medians.podium_rate)
    {
        Some("steady_accumulator")
    } else if above(
        metrics.second_rate,
        medians.second_rate,
        ASSET_STYLE_SECOND_RATE_DELTA,
    ) {
        Some("upper_chaser")
    } else {
        Some("balanced")
    }
}

fn asset_style_shape_kind(
    base: &AssetStyleBase<'_>,
    medians: &AssetStyleMedians,
) -> Option<&'static str> {
    if base.target_count == 0 {
        return None;
    }
    let metrics = &base.metrics;
    if above(
        metrics.high_asset_rate,
        medians.high_asset_rate,
        ASSET_STYLE_RATE_SIGNAL_DELTA,
    ) && above(metrics.low_asset_rate, medians.low_asset_rate, 0.010)
    {
        Some("two_tailed")
    } else if below(
        metrics.low_asset_rate,
        medians.low_asset_rate,
        ASSET_STYLE_LOW_RISK_RATE_DELTA,
    ) && at_least(metrics.high_asset_rate, medians.high_asset_rate)
    {
        Some("upper_side")
    } else if above(
        metrics.low_asset_rate,
        medians.low_asset_rate,
        ASSET_STYLE_RATE_SIGNAL_DELTA,
    ) && at_most(metrics.high_asset_rate, medians.high_asset_rate)
    {
        Some("lower_tail")
    } else if below(
        metrics.high_asset_rate,
        medians.high_asset_rate,
        ASSET_STYLE_LOW_RISK_RATE_DELTA,
    ) {
        Some("thin_right_tail")
    } else if above(
        metrics.high_asset_rate,
        medians.high_asset_rate,
        ASSET_STYLE_RATE_SIGNAL_DELTA,
    ) {
        Some("right_tail")
    } else {
        Some("middle_heavy")
    }
}

fn asset_style_tags(
    base: &AssetStyleBase<'_>,
    medians: &AssetStyleMedians,
    shape_kind: Option<&str>,
) -> Vec<&'static str> {
    let metrics = &base.metrics;
    [
        shape_kind
            .is_some_and(|shape| shape == "two_tailed")
            .then_some("high_variance"),
        above(
            metrics.destination_average,
            medians.destination_average,
            ASSET_STYLE_DESTINATION_AVERAGE_DELTA,
        )
        .then_some("mobility_collecting"),
        above(
            metrics.second_rate,
            medians.second_rate,
            ASSET_STYLE_SECOND_RATE_DELTA,
        )
        .then_some("upper_chaser"),
        above(
            metrics.average_revenue_asset_rate,
            medians.average_revenue_asset_rate,
            STRATEGY_KIND_MEDIAN_DELTA,
        )
        .then_some("property_base"),
        above(
            metrics.low_asset_rate,
            medians.low_asset_rate,
            ASSET_STYLE_RATE_SIGNAL_DELTA,
        )
        .then_some("downside_risk"),
        below(
            metrics.average_revenue_asset_rate,
            medians.average_revenue_asset_rate,
            STRATEGY_KIND_MEDIAN_DELTA,
        )
        .then_some("card_base"),
        below(
            metrics.win_median_margin,
            medians.win_median_margin,
            ASSET_STYLE_WIN_MARGIN_DELTA,
        )
        .then_some("close_finish"),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn blowout_win_rate(metrics: &AssetStyleMetrics, target_count: usize) -> Option<f64> {
    rate(metrics.blowout_win_count, target_count)
}

fn above(value: Option<f64>, baseline: Option<f64>, delta: f64) -> bool {
    value
        .zip(baseline)
        .is_some_and(|(value, baseline)| value >= baseline + delta)
}

fn below(value: Option<f64>, baseline: Option<f64>, delta: f64) -> bool {
    value
        .zip(baseline)
        .is_some_and(|(value, baseline)| value <= baseline - delta)
}

fn at_least(value: Option<f64>, baseline: Option<f64>) -> bool {
    value
        .zip(baseline)
        .is_some_and(|(value, baseline)| value >= baseline)
}

fn at_most(value: Option<f64>, baseline: Option<f64>) -> bool {
    value
        .zip(baseline)
        .is_some_and(|(value, baseline)| value <= baseline)
}

#[cfg(test)]
#[path = "asset_style_tests.rs"]
mod asset_style_tests;

pub(super) fn card_shop_destination(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
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
            let rows = player_matches_by_member.get(member_id).map_or(&[][..], Vec::as_slice);
            let card_shop_count = rows.iter().filter(|row| row.incidents.card_shop > 0).count();
            let card_shop_without_destination_count = rows
                .iter()
                .filter(|row| row.incidents.card_shop > 0 && row.incidents.destination == 0)
                .count();
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
                "cardShopWithoutDestinationCount": card_shop_without_destination_count,
                "cardShopWithoutDestinationRate": rate(card_shop_without_destination_count, card_shop_count),
                "quadrants": quadrants,
            })
        })
        .collect()
}
