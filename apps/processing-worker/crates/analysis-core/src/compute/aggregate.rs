use serde_json::{Value, json};

use crate::{
    competition_rank::calculate_by_match as competition_ranks_by_match,
    contract::ScopeRef,
    model::{AnalysisInput, PlayerMatchInput, PlayerMatchesByMember},
    outcome_model::OutcomeModelAnalysis,
};

use super::{
    grouping::MatchGroup,
    metrics::{
        leader_summary, play_order_comparison, player_metrics, rank_distribution, recent_ranks,
        revenue_rank_conversion, strategy_scatter,
    },
    panels::{
        asset_style_profiles, card_shop_destination, head_to_head, momentum_switch,
        performance_profiles,
    },
    presentation::{member_ref_json, scope_summary_json},
    quality::{data_quality, highlights, metric_definitions, quality_summary},
    signals::rank_spread_signal,
    trends::{histogram, match_digest, match_no_in_event, revenue_histogram, trends},
};

pub(super) fn aggregate(
    input: &AnalysisInput,
    scope: &ScopeRef,
    rows: &[&PlayerMatchInput],
    players: &[String],
    player_matches_by_member: &PlayerMatchesByMember<'_>,
    groups: &[MatchGroup<'_>],
    outcome_model: &OutcomeModelAnalysis,
) -> Value {
    let revenue_ranks = competition_ranks_by_match(rows, |row| row.revenue_man_yen);
    let asset_ranks = competition_ranks_by_match(rows, |row| row.total_assets_man_yen);
    let destination_ranks = competition_ranks_by_match(rows, |row| row.incidents.destination);
    let metrics = player_metrics(
        players,
        player_matches_by_member,
        rows,
        &revenue_ranks,
        &destination_ranks,
    );
    let rank_distribution = rank_distribution(players, player_matches_by_member);
    let recent_ranks = recent_ranks(players, player_matches_by_member);
    let trends = trends(players, player_matches_by_member);
    let head_to_head = head_to_head(players, rows);
    let momentum = momentum_switch(players, player_matches_by_member);
    let performance = performance_profiles(players, player_matches_by_member);
    let asset_styles = asset_style_profiles(players, player_matches_by_member, rows);
    let match_digest = match_digest(groups);
    let quality_items = data_quality(
        players,
        player_matches_by_member,
        &revenue_ranks,
        &destination_ranks,
    );
    let quality_summary = quality_summary(&quality_items);
    let (leader_member_ids, rank_spread) = leader_summary(players, player_matches_by_member);

    json!({
        "schemaVersion": 3,
        "scope": scope_summary_json(scope, groups.len()),
        "players": players.iter().map(|member_id| member_ref_json(member_id)).collect::<Vec<_>>(),
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
        "playOrderComparison": play_order_comparison(players, player_matches_by_member),
        "revenueRankConversion": revenue_rank_conversion(players, player_matches_by_member, &revenue_ranks),
        "trends": trends,
        "histograms": {
            "assets": histogram(rows, players, |row| row.total_assets_man_yen),
            "revenue": revenue_histogram(rows, players, |row| row.revenue_man_yen),
        },
        "headToHead": head_to_head,
        "momentumSwitch": momentum,
        "performanceProfiles": performance,
        "assetStyleProfiles": asset_styles,
        "cardShopDestination": card_shop_destination(players, player_matches_by_member),
        "matchDigest": match_digest,
        "matchNoInEvent": match_no_in_event(players, rows),
        "rankAnalysis": outcome_model.aggregate_json(),
        "highlights": highlights(players, player_matches_by_member),
        "dataQuality": { "items": quality_items, "summary": quality_summary },
        "metricDefinitions": metric_definitions(),
        "source": {
            "gameTitleId": input.game_title_id,
        },
    })
}
