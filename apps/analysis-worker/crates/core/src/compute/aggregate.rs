use serde_json::{Value, json};

use crate::{
    model::{AnalysisInput, MatchPlayerRow, RowsByPlayer, Scope},
    rank::RankAnalysis,
    rankings::by_match as ranks_by_match,
};

use super::{
    metrics::{
        leader_summary, play_order_comparison, player_metrics, rank_distribution, recent_ranks,
        revenue_rank_conversion, strategy_scatter,
    },
    panels::{
        asset_style_profiles, card_shop_destination, head_to_head, momentum_switch,
        performance_profiles,
    },
    quality::{data_quality, highlights, metric_definitions, quality_summary},
    support::{MatchGroup, player_json, rank_spread_signal, scope_json},
    trends::{histogram, match_digest, match_no_in_event, revenue_histogram, trends},
};

pub(super) fn aggregate(
    input: &AnalysisInput,
    scope: &Scope,
    rows: &[&MatchPlayerRow],
    players: &[String],
    rows_by_player: &RowsByPlayer<'_>,
    groups: &[MatchGroup<'_>],
    rank_analysis: &RankAnalysis,
) -> Value {
    let revenue_ranks = ranks_by_match(rows, |row| row.revenue_man_yen);
    let asset_ranks = ranks_by_match(rows, |row| row.total_assets_man_yen);
    let destination_ranks = ranks_by_match(rows, |row| row.incidents.destination);
    let metrics = player_metrics(
        players,
        rows_by_player,
        rows,
        &revenue_ranks,
        &destination_ranks,
    );
    let rank_distribution = rank_distribution(players, rows_by_player);
    let recent_ranks = recent_ranks(players, rows_by_player);
    let trends = trends(players, rows_by_player);
    let head_to_head = head_to_head(players, rows);
    let momentum = momentum_switch(players, rows_by_player);
    let performance = performance_profiles(players, rows_by_player);
    let asset_styles = asset_style_profiles(players, rows_by_player, rows);
    let match_digest = match_digest(groups);
    let quality_items = data_quality(players, rows_by_player, &revenue_ranks, &destination_ranks);
    let quality_summary = quality_summary(&quality_items);
    let (leader_member_ids, rank_spread) = leader_summary(players, rows_by_player);

    json!({
        "schemaVersion": 2,
        "scope": scope_json(scope, groups.len()),
        "players": players.iter().map(|member_id| player_json(member_id, rows)).collect::<Vec<_>>(),
        "summary": {
            "leaderMemberIds": leader_member_ids,
            "averageRankSpread": rank_spread,
            "rankSpreadSignal": rank_spread_signal(rank_spread, groups.len()),
            "totalGinjiCount": rows.iter().map(|row| i64::from(row.incidents.suri_no_ginji)).sum::<i64>(),
            "quality": quality_summary,
        },
        "metricsByPlayer": metrics,
        "rankDistribution": rank_distribution,
        "recentRanks": recent_ranks,
        "strategyScatter": strategy_scatter(groups, &revenue_ranks, &asset_ranks),
        "playOrderComparison": play_order_comparison(players, rows_by_player),
        "revenueRankConversion": revenue_rank_conversion(players, rows_by_player, &revenue_ranks),
        "trends": trends,
        "histograms": {
            "assets": histogram(rows, players, |row| row.total_assets_man_yen),
            "revenue": revenue_histogram(rows, players, |row| row.revenue_man_yen),
        },
        "headToHead": head_to_head,
        "momentumSwitch": momentum,
        "performanceProfiles": performance,
        "assetStyleProfiles": asset_styles,
        "cardShopDestination": card_shop_destination(players, rows_by_player),
        "matchDigest": match_digest,
        "matchNoInEvent": match_no_in_event(players, rows),
        "rankAnalysis": rank_analysis.aggregate_json(),
        "highlights": highlights(players, rows_by_player),
        "dataQuality": { "items": quality_items, "summary": quality_summary },
        "metricDefinitions": metric_definitions(),
        "source": {
            "gameTitleId": input.game_title_id,
        },
    })
}
