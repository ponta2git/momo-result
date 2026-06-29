package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.usecases.seriescomparison.view

type SeriesComparisonDrilldownResponse = view.SeriesComparisonDrilldownView
given Codec.AsObject[SeriesComparisonDrilldownResponse] =
  Codec.AsObject.derived[view.SeriesComparisonDrilldownView]
given Schema[SeriesComparisonDrilldownResponse] =
  Schema.derived[view.SeriesComparisonDrilldownView]

type SeriesComparisonRankAverageHistoryPayloadResponse =
  view.SeriesComparisonRankAverageHistoryPayloadView
given Codec.AsObject[SeriesComparisonRankAverageHistoryPayloadResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistoryPayloadView]
given Schema[SeriesComparisonRankAverageHistoryPayloadResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistoryPayloadView]

type SeriesComparisonRankAverageHistorySummaryResponse =
  view.SeriesComparisonRankAverageHistorySummaryView
given Codec.AsObject[SeriesComparisonRankAverageHistorySummaryResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistorySummaryView]
given Schema[SeriesComparisonRankAverageHistorySummaryResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistorySummaryView]

type SeriesComparisonRankAverageHistoryMatchRowResponse =
  view.SeriesComparisonRankAverageHistoryMatchRowView
given Codec.AsObject[SeriesComparisonRankAverageHistoryMatchRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistoryMatchRowView]
given Schema[SeriesComparisonRankAverageHistoryMatchRowResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistoryMatchRowView]

type SeriesComparisonRankAverageHistoryEventRowResponse =
  view.SeriesComparisonRankAverageHistoryEventRowView
given Codec.AsObject[SeriesComparisonRankAverageHistoryEventRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistoryEventRowView]
given Schema[SeriesComparisonRankAverageHistoryEventRowResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistoryEventRowView]

type SeriesComparisonPlayOrderRankHistoryPayloadResponse =
  view.SeriesComparisonPlayOrderRankHistoryPayloadView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryPayloadResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistoryPayloadView]
given Schema[SeriesComparisonPlayOrderRankHistoryPayloadResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistoryPayloadView]

type SeriesComparisonPlayOrderRankHistorySummaryResponse =
  view.SeriesComparisonPlayOrderRankHistorySummaryView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistorySummaryResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistorySummaryView]
given Schema[SeriesComparisonPlayOrderRankHistorySummaryResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistorySummaryView]

type SeriesComparisonPlayOrderCountResponse = view.SeriesComparisonPlayOrderCountView
given Codec.AsObject[SeriesComparisonPlayOrderCountResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderCountView]
given Schema[SeriesComparisonPlayOrderCountResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderCountView]

type SeriesComparisonPlayOrderRankHistoryTrendRowResponse =
  view.SeriesComparisonPlayOrderRankHistoryTrendRowView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistoryTrendRowView]
given Schema[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistoryTrendRowView]

type SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse =
  view.SeriesComparisonPlayOrderRankHistoryPlayOrderRowView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistoryPlayOrderRowView]
given Schema[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistoryPlayOrderRowView]

type SeriesComparisonScopeResponse = view.SeriesComparisonScopeView
given Codec.AsObject[SeriesComparisonScopeResponse] =
  Codec.AsObject.derived[view.SeriesComparisonScopeView]
given Schema[SeriesComparisonScopeResponse] = Schema.derived[view.SeriesComparisonScopeView]

type SeriesComparisonPlayerResponse = view.SeriesComparisonPlayerView
given Codec.AsObject[SeriesComparisonPlayerResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerView]
given Schema[SeriesComparisonPlayerResponse] = Schema.derived[view.SeriesComparisonPlayerView]

type SeriesComparisonPlayerMetricsEntry = view.SeriesComparisonPlayerMetricsEntry
given Codec.AsObject[SeriesComparisonPlayerMetricsEntry] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerMetricsEntry]
given Schema[SeriesComparisonPlayerMetricsEntry] =
  Schema.derived[view.SeriesComparisonPlayerMetricsEntry]

type SeriesComparisonPlayerMetricsResponse = view.SeriesComparisonPlayerMetricsView
given Codec.AsObject[SeriesComparisonPlayerMetricsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerMetricsView]
given Schema[SeriesComparisonPlayerMetricsResponse] =
  Schema.derived[view.SeriesComparisonPlayerMetricsView]

type RankMetricsResponse = view.RankMetricsView
given Codec.AsObject[RankMetricsResponse] = Codec.AsObject.derived[view.RankMetricsView]
given Schema[RankMetricsResponse] = Schema.derived[view.RankMetricsView]

type RankDistributionResponse = view.RankDistributionView
given Codec.AsObject[RankDistributionResponse] =
  Codec.AsObject.derived[view.RankDistributionView]
given Schema[RankDistributionResponse] = Schema.derived[view.RankDistributionView]

type MoneyDistributionMetricsResponse = view.MoneyDistributionMetricsView
given Codec.AsObject[MoneyDistributionMetricsResponse] =
  Codec.AsObject.derived[view.MoneyDistributionMetricsView]
given Schema[MoneyDistributionMetricsResponse] =
  Schema.derived[view.MoneyDistributionMetricsView]

type RevenueDistributionMetricsResponse = view.RevenueDistributionMetricsView
given Codec.AsObject[RevenueDistributionMetricsResponse] =
  Codec.AsObject.derived[view.RevenueDistributionMetricsView]
given Schema[RevenueDistributionMetricsResponse] =
  Schema.derived[view.RevenueDistributionMetricsView]

type RateCountMetricsResponse = view.RateCountMetricsView
given Codec.AsObject[RateCountMetricsResponse] =
  Codec.AsObject.derived[view.RateCountMetricsView]
given Schema[RateCountMetricsResponse] = Schema.derived[view.RateCountMetricsView]

type PlayOrderMetricsResponse = view.PlayOrderMetricsView
given Codec.AsObject[PlayOrderMetricsResponse] =
  Codec.AsObject.derived[view.PlayOrderMetricsView]
given Schema[PlayOrderMetricsResponse] = Schema.derived[view.PlayOrderMetricsView]

type PlayOrderBreakdownResponse = view.PlayOrderBreakdownView
given Codec.AsObject[PlayOrderBreakdownResponse] =
  Codec.AsObject.derived[view.PlayOrderBreakdownView]
given Schema[PlayOrderBreakdownResponse] = Schema.derived[view.PlayOrderBreakdownView]

type GinjiMetricsResponse = view.GinjiMetricsView
given Codec.AsObject[GinjiMetricsResponse] = Codec.AsObject.derived[view.GinjiMetricsView]
given Schema[GinjiMetricsResponse] = Schema.derived[view.GinjiMetricsView]

type NonRevenueMetricsResponse = view.NonRevenueMetricsView
given Codec.AsObject[NonRevenueMetricsResponse] =
  Codec.AsObject.derived[view.NonRevenueMetricsView]
given Schema[NonRevenueMetricsResponse] = Schema.derived[view.NonRevenueMetricsView]

type DestinationMetricsResponse = view.DestinationMetricsView
given Codec.AsObject[DestinationMetricsResponse] =
  Codec.AsObject.derived[view.DestinationMetricsView]
given Schema[DestinationMetricsResponse] = Schema.derived[view.DestinationMetricsView]

type ConditionalRankOutcomeResponse = view.ConditionalRankOutcomeView
given Codec.AsObject[ConditionalRankOutcomeResponse] =
  Codec.AsObject.derived[view.ConditionalRankOutcomeView]
given Schema[ConditionalRankOutcomeResponse] = Schema.derived[view.ConditionalRankOutcomeView]

type RevenueOutcomeMetricsResponse = view.RevenueOutcomeMetricsView
given Codec.AsObject[RevenueOutcomeMetricsResponse] =
  Codec.AsObject.derived[view.RevenueOutcomeMetricsView]
given Schema[RevenueOutcomeMetricsResponse] = Schema.derived[view.RevenueOutcomeMetricsView]

type DestinationOutcomeMetricsResponse = view.DestinationOutcomeMetricsView
given Codec.AsObject[DestinationOutcomeMetricsResponse] =
  Codec.AsObject.derived[view.DestinationOutcomeMetricsView]
given Schema[DestinationOutcomeMetricsResponse] =
  Schema.derived[view.DestinationOutcomeMetricsView]

type CardShopDestinationResponse = view.CardShopDestinationView
given Codec.AsObject[CardShopDestinationResponse] =
  Codec.AsObject.derived[view.CardShopDestinationView]
given Schema[CardShopDestinationResponse] = Schema.derived[view.CardShopDestinationView]

type CardShopDestinationPlayerResponse = view.CardShopDestinationPlayerView
given Codec.AsObject[CardShopDestinationPlayerResponse] =
  Codec.AsObject.derived[view.CardShopDestinationPlayerView]
given Schema[CardShopDestinationPlayerResponse] =
  Schema.derived[view.CardShopDestinationPlayerView]

type CardShopDestinationQuadrantResponse = view.CardShopDestinationQuadrantView
given Codec.AsObject[CardShopDestinationQuadrantResponse] =
  Codec.AsObject.derived[view.CardShopDestinationQuadrantView]
given Schema[CardShopDestinationQuadrantResponse] =
  Schema.derived[view.CardShopDestinationQuadrantView]

type StabilityMetricsResponse = view.StabilityMetricsView
given Codec.AsObject[StabilityMetricsResponse] =
  Codec.AsObject.derived[view.StabilityMetricsView]
given Schema[StabilityMetricsResponse] = Schema.derived[view.StabilityMetricsView]

type SeriesComparisonOptionsResponse = view.SeriesComparisonOptionsView
given Codec.AsObject[SeriesComparisonOptionsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonOptionsView]
given Schema[SeriesComparisonOptionsResponse] =
  Schema.derived[view.SeriesComparisonOptionsView]

type SeriesComparisonSeriesOption = view.SeriesComparisonSeriesOption
given Codec.AsObject[SeriesComparisonSeriesOption] =
  Codec.AsObject.derived[view.SeriesComparisonSeriesOption]
given Schema[SeriesComparisonSeriesOption] = Schema.derived[view.SeriesComparisonSeriesOption]

type SeriesComparisonScopeOption = view.SeriesComparisonScopeOption
given Codec.AsObject[SeriesComparisonScopeOption] =
  Codec.AsObject.derived[view.SeriesComparisonScopeOption]
given Schema[SeriesComparisonScopeOption] = Schema.derived[view.SeriesComparisonScopeOption]

type SeriesComparisonReviewBaselineResponse = view.SeriesComparisonReviewBaselineView
given Codec.AsObject[SeriesComparisonReviewBaselineResponse] =
  Codec.AsObject.derived[view.SeriesComparisonReviewBaselineView]
given Schema[SeriesComparisonReviewBaselineResponse] =
  Schema.derived[view.SeriesComparisonReviewBaselineView]

type SeriesComparisonCommonPlaybookTopicResponse = view.SeriesComparisonCommonPlaybookTopicView
given Codec.AsObject[SeriesComparisonCommonPlaybookTopicResponse] =
  Codec.AsObject.derived[view.SeriesComparisonCommonPlaybookTopicView]
given Schema[SeriesComparisonCommonPlaybookTopicResponse] =
  Schema.derived[view.SeriesComparisonCommonPlaybookTopicView]

type SeriesComparisonPlayerPlaybookResponse = view.SeriesComparisonPlayerPlaybookView
given Codec.AsObject[SeriesComparisonPlayerPlaybookResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerPlaybookView]
given Schema[SeriesComparisonPlayerPlaybookResponse] =
  Schema.derived[view.SeriesComparisonPlayerPlaybookView]

type SeriesComparisonPlaybookCardResponse = view.SeriesComparisonPlaybookCardView
given Codec.AsObject[SeriesComparisonPlaybookCardResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlaybookCardView]
given Schema[SeriesComparisonPlaybookCardResponse] =
  Schema.derived[view.SeriesComparisonPlaybookCardView]

type SeriesComparisonPlaybookEvidenceResponse = view.SeriesComparisonPlaybookEvidenceView
given Codec.AsObject[SeriesComparisonPlaybookEvidenceResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlaybookEvidenceView]
given Schema[SeriesComparisonPlaybookEvidenceResponse] =
  Schema.derived[view.SeriesComparisonPlaybookEvidenceView]

type SeriesComparisonPlaybookAnchorTargetResponse =
  view.SeriesComparisonPlaybookAnchorTargetView
given Codec.AsObject[SeriesComparisonPlaybookAnchorTargetResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlaybookAnchorTargetView]
given Schema[SeriesComparisonPlaybookAnchorTargetResponse] =
  Schema.derived[view.SeriesComparisonPlaybookAnchorTargetView]

type RecentFormPlayerResponse = view.RecentFormPlayerView
given Codec.AsObject[RecentFormPlayerResponse] =
  Codec.AsObject.derived[view.RecentFormPlayerView]
given Schema[RecentFormPlayerResponse] = Schema.derived[view.RecentFormPlayerView]

type MomentumSwitchResponse = view.MomentumSwitchView
given Codec.AsObject[MomentumSwitchResponse] = Codec.AsObject.derived[view.MomentumSwitchView]
given Schema[MomentumSwitchResponse] = Schema.derived[view.MomentumSwitchView]

type MomentumSwitchPlayerResponse = view.MomentumSwitchPlayerView
given Codec.AsObject[MomentumSwitchPlayerResponse] =
  Codec.AsObject.derived[view.MomentumSwitchPlayerView]
given Schema[MomentumSwitchPlayerResponse] = Schema.derived[view.MomentumSwitchPlayerView]

type MomentumSwitchRateResponse = view.MomentumSwitchRateView
given Codec.AsObject[MomentumSwitchRateResponse] =
  Codec.AsObject.derived[view.MomentumSwitchRateView]
given Schema[MomentumSwitchRateResponse] = Schema.derived[view.MomentumSwitchRateView]

type MomentumSwitchTransitionRowResponse = view.MomentumSwitchTransitionRowView
given Codec.AsObject[MomentumSwitchTransitionRowResponse] =
  Codec.AsObject.derived[view.MomentumSwitchTransitionRowView]
given Schema[MomentumSwitchTransitionRowResponse] =
  Schema.derived[view.MomentumSwitchTransitionRowView]

type MomentumSwitchTransitionCellResponse = view.MomentumSwitchTransitionCellView
given Codec.AsObject[MomentumSwitchTransitionCellResponse] =
  Codec.AsObject.derived[view.MomentumSwitchTransitionCellView]
given Schema[MomentumSwitchTransitionCellResponse] =
  Schema.derived[view.MomentumSwitchTransitionCellView]

type PlayerPerformanceProfilesResponse = view.PlayerPerformanceProfilesView
given Codec.AsObject[PlayerPerformanceProfilesResponse] =
  Codec.AsObject.derived[view.PlayerPerformanceProfilesView]
given Schema[PlayerPerformanceProfilesResponse] =
  Schema.derived[view.PlayerPerformanceProfilesView]

type PlayerPerformanceProfileResponse = view.PlayerPerformanceProfileView
given Codec.AsObject[PlayerPerformanceProfileResponse] =
  Codec.AsObject.derived[view.PlayerPerformanceProfileView]
given Schema[PlayerPerformanceProfileResponse] =
  Schema.derived[view.PlayerPerformanceProfileView]

type AssetStyleProfilesResponse = view.AssetStyleProfilesView
given Codec.AsObject[AssetStyleProfilesResponse] =
  Codec.AsObject.derived[view.AssetStyleProfilesView]
given Schema[AssetStyleProfilesResponse] = Schema.derived[view.AssetStyleProfilesView]

type AssetStyleProfileResponse = view.AssetStyleProfileView
given Codec.AsObject[AssetStyleProfileResponse] =
  Codec.AsObject.derived[view.AssetStyleProfileView]
given Schema[AssetStyleProfileResponse] = Schema.derived[view.AssetStyleProfileView]

type AssetStyleMetricsResponse = view.AssetStyleMetricsView
given Codec.AsObject[AssetStyleMetricsResponse] =
  Codec.AsObject.derived[view.AssetStyleMetricsView]
given Schema[AssetStyleMetricsResponse] = Schema.derived[view.AssetStyleMetricsView]

type MatchNoInEventBreakdownResponse = view.MatchNoInEventBreakdownView
given Codec.AsObject[MatchNoInEventBreakdownResponse] =
  Codec.AsObject.derived[view.MatchNoInEventBreakdownView]
given Schema[MatchNoInEventBreakdownResponse] =
  Schema.derived[view.MatchNoInEventBreakdownView]

type MatchNoInEventPlayerBreakdownResponse = view.MatchNoInEventPlayerBreakdownView
given Codec.AsObject[MatchNoInEventPlayerBreakdownResponse] =
  Codec.AsObject.derived[view.MatchNoInEventPlayerBreakdownView]
given Schema[MatchNoInEventPlayerBreakdownResponse] =
  Schema.derived[view.MatchNoInEventPlayerBreakdownView]

type MatchTimelinePointResponse = view.MatchTimelinePointView
given Codec.AsObject[MatchTimelinePointResponse] =
  Codec.AsObject.derived[view.MatchTimelinePointView]
given Schema[MatchTimelinePointResponse] = Schema.derived[view.MatchTimelinePointView]

type PlayOrderBaselineResponse = view.PlayOrderBaselineView
given Codec.AsObject[PlayOrderBaselineResponse] =
  Codec.AsObject.derived[view.PlayOrderBaselineView]
given Schema[PlayOrderBaselineResponse] = Schema.derived[view.PlayOrderBaselineView]

type SeriesComparisonHighlightResponse = view.SeriesComparisonHighlightView
given Codec.AsObject[SeriesComparisonHighlightResponse] =
  Codec.AsObject.derived[view.SeriesComparisonHighlightView]
given Schema[SeriesComparisonHighlightResponse] =
  Schema.derived[view.SeriesComparisonHighlightView]

type SeriesComparisonDataQualityResponse = view.SeriesComparisonDataQualityView
given Codec.AsObject[SeriesComparisonDataQualityResponse] =
  Codec.AsObject.derived[view.SeriesComparisonDataQualityView]
given Schema[SeriesComparisonDataQualityResponse] =
  Schema.derived[view.SeriesComparisonDataQualityView]

type MetricQualityResponse = view.MetricQualityView
given Codec.AsObject[MetricQualityResponse] = Codec.AsObject.derived[view.MetricQualityView]
given Schema[MetricQualityResponse] = Schema.derived[view.MetricQualityView]

type SeriesComparisonReviewResponse = view.SeriesComparisonReviewView
given Codec.AsObject[SeriesComparisonReviewResponse] =
  Codec.AsObject.derived[view.SeriesComparisonReviewView]
given Schema[SeriesComparisonReviewResponse] = Schema.derived[view.SeriesComparisonReviewView]

type SeriesComparisonResponse = view.SeriesComparisonView
given Codec.AsObject[SeriesComparisonResponse] =
  Codec.AsObject.derived[view.SeriesComparisonView]
given Schema[SeriesComparisonResponse] = Schema.derived[view.SeriesComparisonView]

type SeriesComparisonTrendsResponse = view.SeriesComparisonTrendsView
given Codec.AsObject[SeriesComparisonTrendsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonTrendsView]
given Schema[SeriesComparisonTrendsResponse] = Schema.derived[view.SeriesComparisonTrendsView]

type TrendSeriesResponse = view.TrendSeriesView
given Codec.AsObject[TrendSeriesResponse] = Codec.AsObject.derived[view.TrendSeriesView]
given Schema[TrendSeriesResponse] = Schema.derived[view.TrendSeriesView]

type TrendPointResponse = view.TrendPointView
given Codec.AsObject[TrendPointResponse] = Codec.AsObject.derived[view.TrendPointView]
given Schema[TrendPointResponse] = Schema.derived[view.TrendPointView]

type SeriesComparisonHistogramsResponse = view.SeriesComparisonHistogramsView
given Codec.AsObject[SeriesComparisonHistogramsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonHistogramsView]
given Schema[SeriesComparisonHistogramsResponse] =
  Schema.derived[view.SeriesComparisonHistogramsView]

type HistogramResponse = view.HistogramView
given Codec.AsObject[HistogramResponse] = Codec.AsObject.derived[view.HistogramView]
given Schema[HistogramResponse] = Schema.derived[view.HistogramView]

type HistogramBinResponse = view.HistogramBinView
given Codec.AsObject[HistogramBinResponse] = Codec.AsObject.derived[view.HistogramBinView]
given Schema[HistogramBinResponse] = Schema.derived[view.HistogramBinView]

type HistogramSeriesResponse = view.HistogramSeriesView
given Codec.AsObject[HistogramSeriesResponse] =
  Codec.AsObject.derived[view.HistogramSeriesView]
given Schema[HistogramSeriesResponse] = Schema.derived[view.HistogramSeriesView]

type HeadToHeadResponse = view.HeadToHeadView
given Codec.AsObject[HeadToHeadResponse] = Codec.AsObject.derived[view.HeadToHeadView]
given Schema[HeadToHeadResponse] = Schema.derived[view.HeadToHeadView]

type HeadToHeadEntryResponse = view.HeadToHeadEntryView
given Codec.AsObject[HeadToHeadEntryResponse] =
  Codec.AsObject.derived[view.HeadToHeadEntryView]
given Schema[HeadToHeadEntryResponse] = Schema.derived[view.HeadToHeadEntryView]

type MatchPlayerPointResponse = view.MatchPlayerPointView
given Codec.AsObject[MatchPlayerPointResponse] =
  Codec.AsObject.derived[view.MatchPlayerPointView]
given Schema[MatchPlayerPointResponse] = Schema.derived[view.MatchPlayerPointView]
