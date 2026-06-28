package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.usecases.seriescomparison.model

type SeriesComparisonDrilldownResponse = model.SeriesComparisonDrilldownResponse
given Codec.AsObject[SeriesComparisonDrilldownResponse] = Codec.AsObject.derived[model.SeriesComparisonDrilldownResponse]
given Schema[SeriesComparisonDrilldownResponse] = Schema.derived[model.SeriesComparisonDrilldownResponse]

type SeriesComparisonRankAverageHistoryPayloadResponse = model.SeriesComparisonRankAverageHistoryPayloadResponse
given Codec.AsObject[SeriesComparisonRankAverageHistoryPayloadResponse] = Codec.AsObject.derived[model.SeriesComparisonRankAverageHistoryPayloadResponse]
given Schema[SeriesComparisonRankAverageHistoryPayloadResponse] = Schema.derived[model.SeriesComparisonRankAverageHistoryPayloadResponse]

type SeriesComparisonRankAverageHistorySummaryResponse = model.SeriesComparisonRankAverageHistorySummaryResponse
given Codec.AsObject[SeriesComparisonRankAverageHistorySummaryResponse] = Codec.AsObject.derived[model.SeriesComparisonRankAverageHistorySummaryResponse]
given Schema[SeriesComparisonRankAverageHistorySummaryResponse] = Schema.derived[model.SeriesComparisonRankAverageHistorySummaryResponse]

type SeriesComparisonRankAverageHistoryMatchRowResponse = model.SeriesComparisonRankAverageHistoryMatchRowResponse
given Codec.AsObject[SeriesComparisonRankAverageHistoryMatchRowResponse] = Codec.AsObject.derived[model.SeriesComparisonRankAverageHistoryMatchRowResponse]
given Schema[SeriesComparisonRankAverageHistoryMatchRowResponse] = Schema.derived[model.SeriesComparisonRankAverageHistoryMatchRowResponse]

type SeriesComparisonRankAverageHistoryEventRowResponse = model.SeriesComparisonRankAverageHistoryEventRowResponse
given Codec.AsObject[SeriesComparisonRankAverageHistoryEventRowResponse] = Codec.AsObject.derived[model.SeriesComparisonRankAverageHistoryEventRowResponse]
given Schema[SeriesComparisonRankAverageHistoryEventRowResponse] = Schema.derived[model.SeriesComparisonRankAverageHistoryEventRowResponse]

type SeriesComparisonPlayOrderRankHistoryPayloadResponse = model.SeriesComparisonPlayOrderRankHistoryPayloadResponse
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryPayloadResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayOrderRankHistoryPayloadResponse]
given Schema[SeriesComparisonPlayOrderRankHistoryPayloadResponse] = Schema.derived[model.SeriesComparisonPlayOrderRankHistoryPayloadResponse]

type SeriesComparisonPlayOrderRankHistorySummaryResponse = model.SeriesComparisonPlayOrderRankHistorySummaryResponse
given Codec.AsObject[SeriesComparisonPlayOrderRankHistorySummaryResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayOrderRankHistorySummaryResponse]
given Schema[SeriesComparisonPlayOrderRankHistorySummaryResponse] = Schema.derived[model.SeriesComparisonPlayOrderRankHistorySummaryResponse]

type SeriesComparisonPlayOrderCountResponse = model.SeriesComparisonPlayOrderCountResponse
given Codec.AsObject[SeriesComparisonPlayOrderCountResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayOrderCountResponse]
given Schema[SeriesComparisonPlayOrderCountResponse] = Schema.derived[model.SeriesComparisonPlayOrderCountResponse]

type SeriesComparisonPlayOrderRankHistoryTrendRowResponse = model.SeriesComparisonPlayOrderRankHistoryTrendRowResponse
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayOrderRankHistoryTrendRowResponse]
given Schema[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] = Schema.derived[model.SeriesComparisonPlayOrderRankHistoryTrendRowResponse]

type SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse = model.SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse]
given Schema[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] = Schema.derived[model.SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse]

type SeriesComparisonScopeResponse = model.SeriesComparisonScopeResponse
given Codec.AsObject[SeriesComparisonScopeResponse] = Codec.AsObject.derived[model.SeriesComparisonScopeResponse]
given Schema[SeriesComparisonScopeResponse] = Schema.derived[model.SeriesComparisonScopeResponse]

type SeriesComparisonPlayerResponse = model.SeriesComparisonPlayerResponse
given Codec.AsObject[SeriesComparisonPlayerResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayerResponse]
given Schema[SeriesComparisonPlayerResponse] = Schema.derived[model.SeriesComparisonPlayerResponse]

type SeriesComparisonPlayerMetricsEntry = model.SeriesComparisonPlayerMetricsEntry
given Codec.AsObject[SeriesComparisonPlayerMetricsEntry] = Codec.AsObject.derived[model.SeriesComparisonPlayerMetricsEntry]
given Schema[SeriesComparisonPlayerMetricsEntry] = Schema.derived[model.SeriesComparisonPlayerMetricsEntry]

type SeriesComparisonPlayerMetricsResponse = model.SeriesComparisonPlayerMetricsResponse
given Codec.AsObject[SeriesComparisonPlayerMetricsResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayerMetricsResponse]
given Schema[SeriesComparisonPlayerMetricsResponse] = Schema.derived[model.SeriesComparisonPlayerMetricsResponse]

type RankMetricsResponse = model.RankMetricsResponse
given Codec.AsObject[RankMetricsResponse] = Codec.AsObject.derived[model.RankMetricsResponse]
given Schema[RankMetricsResponse] = Schema.derived[model.RankMetricsResponse]

type RankDistributionResponse = model.RankDistributionResponse
given Codec.AsObject[RankDistributionResponse] = Codec.AsObject.derived[model.RankDistributionResponse]
given Schema[RankDistributionResponse] = Schema.derived[model.RankDistributionResponse]

type MoneyDistributionMetricsResponse = model.MoneyDistributionMetricsResponse
given Codec.AsObject[MoneyDistributionMetricsResponse] = Codec.AsObject.derived[model.MoneyDistributionMetricsResponse]
given Schema[MoneyDistributionMetricsResponse] = Schema.derived[model.MoneyDistributionMetricsResponse]

type RevenueDistributionMetricsResponse = model.RevenueDistributionMetricsResponse
given Codec.AsObject[RevenueDistributionMetricsResponse] = Codec.AsObject.derived[model.RevenueDistributionMetricsResponse]
given Schema[RevenueDistributionMetricsResponse] = Schema.derived[model.RevenueDistributionMetricsResponse]

type RateCountMetricsResponse = model.RateCountMetricsResponse
given Codec.AsObject[RateCountMetricsResponse] = Codec.AsObject.derived[model.RateCountMetricsResponse]
given Schema[RateCountMetricsResponse] = Schema.derived[model.RateCountMetricsResponse]

type PlayOrderMetricsResponse = model.PlayOrderMetricsResponse
given Codec.AsObject[PlayOrderMetricsResponse] = Codec.AsObject.derived[model.PlayOrderMetricsResponse]
given Schema[PlayOrderMetricsResponse] = Schema.derived[model.PlayOrderMetricsResponse]

type PlayOrderBreakdownResponse = model.PlayOrderBreakdownResponse
given Codec.AsObject[PlayOrderBreakdownResponse] = Codec.AsObject.derived[model.PlayOrderBreakdownResponse]
given Schema[PlayOrderBreakdownResponse] = Schema.derived[model.PlayOrderBreakdownResponse]

type GinjiMetricsResponse = model.GinjiMetricsResponse
given Codec.AsObject[GinjiMetricsResponse] = Codec.AsObject.derived[model.GinjiMetricsResponse]
given Schema[GinjiMetricsResponse] = Schema.derived[model.GinjiMetricsResponse]

type NonRevenueMetricsResponse = model.NonRevenueMetricsResponse
given Codec.AsObject[NonRevenueMetricsResponse] = Codec.AsObject.derived[model.NonRevenueMetricsResponse]
given Schema[NonRevenueMetricsResponse] = Schema.derived[model.NonRevenueMetricsResponse]

type DestinationMetricsResponse = model.DestinationMetricsResponse
given Codec.AsObject[DestinationMetricsResponse] = Codec.AsObject.derived[model.DestinationMetricsResponse]
given Schema[DestinationMetricsResponse] = Schema.derived[model.DestinationMetricsResponse]

type ConditionalRankOutcomeResponse = model.ConditionalRankOutcomeResponse
given Codec.AsObject[ConditionalRankOutcomeResponse] = Codec.AsObject.derived[model.ConditionalRankOutcomeResponse]
given Schema[ConditionalRankOutcomeResponse] = Schema.derived[model.ConditionalRankOutcomeResponse]

type RevenueOutcomeMetricsResponse = model.RevenueOutcomeMetricsResponse
given Codec.AsObject[RevenueOutcomeMetricsResponse] = Codec.AsObject.derived[model.RevenueOutcomeMetricsResponse]
given Schema[RevenueOutcomeMetricsResponse] = Schema.derived[model.RevenueOutcomeMetricsResponse]

type DestinationOutcomeMetricsResponse = model.DestinationOutcomeMetricsResponse
given Codec.AsObject[DestinationOutcomeMetricsResponse] = Codec.AsObject.derived[model.DestinationOutcomeMetricsResponse]
given Schema[DestinationOutcomeMetricsResponse] = Schema.derived[model.DestinationOutcomeMetricsResponse]

type CardShopDestinationResponse = model.CardShopDestinationResponse
given Codec.AsObject[CardShopDestinationResponse] = Codec.AsObject.derived[model.CardShopDestinationResponse]
given Schema[CardShopDestinationResponse] = Schema.derived[model.CardShopDestinationResponse]

type CardShopDestinationPlayerResponse = model.CardShopDestinationPlayerResponse
given Codec.AsObject[CardShopDestinationPlayerResponse] = Codec.AsObject.derived[model.CardShopDestinationPlayerResponse]
given Schema[CardShopDestinationPlayerResponse] = Schema.derived[model.CardShopDestinationPlayerResponse]

type CardShopDestinationQuadrantResponse = model.CardShopDestinationQuadrantResponse
given Codec.AsObject[CardShopDestinationQuadrantResponse] = Codec.AsObject.derived[model.CardShopDestinationQuadrantResponse]
given Schema[CardShopDestinationQuadrantResponse] = Schema.derived[model.CardShopDestinationQuadrantResponse]

type StabilityMetricsResponse = model.StabilityMetricsResponse
given Codec.AsObject[StabilityMetricsResponse] = Codec.AsObject.derived[model.StabilityMetricsResponse]
given Schema[StabilityMetricsResponse] = Schema.derived[model.StabilityMetricsResponse]

type SeriesComparisonOptionsResponse = model.SeriesComparisonOptionsResponse
given Codec.AsObject[SeriesComparisonOptionsResponse] = Codec.AsObject.derived[model.SeriesComparisonOptionsResponse]
given Schema[SeriesComparisonOptionsResponse] = Schema.derived[model.SeriesComparisonOptionsResponse]

type SeriesComparisonSeriesOption = model.SeriesComparisonSeriesOption
given Codec.AsObject[SeriesComparisonSeriesOption] = Codec.AsObject.derived[model.SeriesComparisonSeriesOption]
given Schema[SeriesComparisonSeriesOption] = Schema.derived[model.SeriesComparisonSeriesOption]

type SeriesComparisonScopeOption = model.SeriesComparisonScopeOption
given Codec.AsObject[SeriesComparisonScopeOption] = Codec.AsObject.derived[model.SeriesComparisonScopeOption]
given Schema[SeriesComparisonScopeOption] = Schema.derived[model.SeriesComparisonScopeOption]

type SeriesComparisonReviewBaselineResponse = model.SeriesComparisonReviewBaselineResponse
given Codec.AsObject[SeriesComparisonReviewBaselineResponse] = Codec.AsObject.derived[model.SeriesComparisonReviewBaselineResponse]
given Schema[SeriesComparisonReviewBaselineResponse] = Schema.derived[model.SeriesComparisonReviewBaselineResponse]

type SeriesComparisonCommonPlaybookTopicResponse = model.SeriesComparisonCommonPlaybookTopicResponse
given Codec.AsObject[SeriesComparisonCommonPlaybookTopicResponse] = Codec.AsObject.derived[model.SeriesComparisonCommonPlaybookTopicResponse]
given Schema[SeriesComparisonCommonPlaybookTopicResponse] = Schema.derived[model.SeriesComparisonCommonPlaybookTopicResponse]

type SeriesComparisonPlayerPlaybookResponse = model.SeriesComparisonPlayerPlaybookResponse
given Codec.AsObject[SeriesComparisonPlayerPlaybookResponse] = Codec.AsObject.derived[model.SeriesComparisonPlayerPlaybookResponse]
given Schema[SeriesComparisonPlayerPlaybookResponse] = Schema.derived[model.SeriesComparisonPlayerPlaybookResponse]

type SeriesComparisonPlaybookCardResponse = model.SeriesComparisonPlaybookCardResponse
given Codec.AsObject[SeriesComparisonPlaybookCardResponse] = Codec.AsObject.derived[model.SeriesComparisonPlaybookCardResponse]
given Schema[SeriesComparisonPlaybookCardResponse] = Schema.derived[model.SeriesComparisonPlaybookCardResponse]

type SeriesComparisonPlaybookEvidenceResponse = model.SeriesComparisonPlaybookEvidenceResponse
given Codec.AsObject[SeriesComparisonPlaybookEvidenceResponse] = Codec.AsObject.derived[model.SeriesComparisonPlaybookEvidenceResponse]
given Schema[SeriesComparisonPlaybookEvidenceResponse] = Schema.derived[model.SeriesComparisonPlaybookEvidenceResponse]

type SeriesComparisonPlaybookAnchorTargetResponse = model.SeriesComparisonPlaybookAnchorTargetResponse
given Codec.AsObject[SeriesComparisonPlaybookAnchorTargetResponse] = Codec.AsObject.derived[model.SeriesComparisonPlaybookAnchorTargetResponse]
given Schema[SeriesComparisonPlaybookAnchorTargetResponse] = Schema.derived[model.SeriesComparisonPlaybookAnchorTargetResponse]

type RecentFormPlayerResponse = model.RecentFormPlayerResponse
given Codec.AsObject[RecentFormPlayerResponse] = Codec.AsObject.derived[model.RecentFormPlayerResponse]
given Schema[RecentFormPlayerResponse] = Schema.derived[model.RecentFormPlayerResponse]

type MomentumSwitchResponse = model.MomentumSwitchResponse
given Codec.AsObject[MomentumSwitchResponse] = Codec.AsObject.derived[model.MomentumSwitchResponse]
given Schema[MomentumSwitchResponse] = Schema.derived[model.MomentumSwitchResponse]

type MomentumSwitchPlayerResponse = model.MomentumSwitchPlayerResponse
given Codec.AsObject[MomentumSwitchPlayerResponse] = Codec.AsObject.derived[model.MomentumSwitchPlayerResponse]
given Schema[MomentumSwitchPlayerResponse] = Schema.derived[model.MomentumSwitchPlayerResponse]

type MomentumSwitchRateResponse = model.MomentumSwitchRateResponse
given Codec.AsObject[MomentumSwitchRateResponse] = Codec.AsObject.derived[model.MomentumSwitchRateResponse]
given Schema[MomentumSwitchRateResponse] = Schema.derived[model.MomentumSwitchRateResponse]

type MomentumSwitchTransitionRowResponse = model.MomentumSwitchTransitionRowResponse
given Codec.AsObject[MomentumSwitchTransitionRowResponse] = Codec.AsObject.derived[model.MomentumSwitchTransitionRowResponse]
given Schema[MomentumSwitchTransitionRowResponse] = Schema.derived[model.MomentumSwitchTransitionRowResponse]

type MomentumSwitchTransitionCellResponse = model.MomentumSwitchTransitionCellResponse
given Codec.AsObject[MomentumSwitchTransitionCellResponse] = Codec.AsObject.derived[model.MomentumSwitchTransitionCellResponse]
given Schema[MomentumSwitchTransitionCellResponse] = Schema.derived[model.MomentumSwitchTransitionCellResponse]

type PlayerPerformanceProfilesResponse = model.PlayerPerformanceProfilesResponse
given Codec.AsObject[PlayerPerformanceProfilesResponse] = Codec.AsObject.derived[model.PlayerPerformanceProfilesResponse]
given Schema[PlayerPerformanceProfilesResponse] = Schema.derived[model.PlayerPerformanceProfilesResponse]

type PlayerPerformanceProfileResponse = model.PlayerPerformanceProfileResponse
given Codec.AsObject[PlayerPerformanceProfileResponse] = Codec.AsObject.derived[model.PlayerPerformanceProfileResponse]
given Schema[PlayerPerformanceProfileResponse] = Schema.derived[model.PlayerPerformanceProfileResponse]

type AssetStyleProfilesResponse = model.AssetStyleProfilesResponse
given Codec.AsObject[AssetStyleProfilesResponse] = Codec.AsObject.derived[model.AssetStyleProfilesResponse]
given Schema[AssetStyleProfilesResponse] = Schema.derived[model.AssetStyleProfilesResponse]

type AssetStyleProfileResponse = model.AssetStyleProfileResponse
given Codec.AsObject[AssetStyleProfileResponse] = Codec.AsObject.derived[model.AssetStyleProfileResponse]
given Schema[AssetStyleProfileResponse] = Schema.derived[model.AssetStyleProfileResponse]

type AssetStyleMetricsResponse = model.AssetStyleMetricsResponse
given Codec.AsObject[AssetStyleMetricsResponse] = Codec.AsObject.derived[model.AssetStyleMetricsResponse]
given Schema[AssetStyleMetricsResponse] = Schema.derived[model.AssetStyleMetricsResponse]

type MatchNoInEventBreakdownResponse = model.MatchNoInEventBreakdownResponse
given Codec.AsObject[MatchNoInEventBreakdownResponse] = Codec.AsObject.derived[model.MatchNoInEventBreakdownResponse]
given Schema[MatchNoInEventBreakdownResponse] = Schema.derived[model.MatchNoInEventBreakdownResponse]

type MatchNoInEventPlayerBreakdownResponse = model.MatchNoInEventPlayerBreakdownResponse
given Codec.AsObject[MatchNoInEventPlayerBreakdownResponse] = Codec.AsObject.derived[model.MatchNoInEventPlayerBreakdownResponse]
given Schema[MatchNoInEventPlayerBreakdownResponse] = Schema.derived[model.MatchNoInEventPlayerBreakdownResponse]

type MatchTimelinePointResponse = model.MatchTimelinePointResponse
given Codec.AsObject[MatchTimelinePointResponse] = Codec.AsObject.derived[model.MatchTimelinePointResponse]
given Schema[MatchTimelinePointResponse] = Schema.derived[model.MatchTimelinePointResponse]

type PlayOrderBaselineResponse = model.PlayOrderBaselineResponse
given Codec.AsObject[PlayOrderBaselineResponse] = Codec.AsObject.derived[model.PlayOrderBaselineResponse]
given Schema[PlayOrderBaselineResponse] = Schema.derived[model.PlayOrderBaselineResponse]

type SeriesComparisonHighlightResponse = model.SeriesComparisonHighlightResponse
given Codec.AsObject[SeriesComparisonHighlightResponse] = Codec.AsObject.derived[model.SeriesComparisonHighlightResponse]
given Schema[SeriesComparisonHighlightResponse] = Schema.derived[model.SeriesComparisonHighlightResponse]

type SeriesComparisonDataQualityResponse = model.SeriesComparisonDataQualityResponse
given Codec.AsObject[SeriesComparisonDataQualityResponse] = Codec.AsObject.derived[model.SeriesComparisonDataQualityResponse]
given Schema[SeriesComparisonDataQualityResponse] = Schema.derived[model.SeriesComparisonDataQualityResponse]

type MetricQualityResponse = model.MetricQualityResponse
given Codec.AsObject[MetricQualityResponse] = Codec.AsObject.derived[model.MetricQualityResponse]
given Schema[MetricQualityResponse] = Schema.derived[model.MetricQualityResponse]

type SeriesComparisonReviewResponse = model.SeriesComparisonReviewResponse
given Codec.AsObject[SeriesComparisonReviewResponse] = Codec.AsObject.derived[model.SeriesComparisonReviewResponse]
given Schema[SeriesComparisonReviewResponse] = Schema.derived[model.SeriesComparisonReviewResponse]

type SeriesComparisonResponse = model.SeriesComparisonResponse
given Codec.AsObject[SeriesComparisonResponse] = Codec.AsObject.derived[model.SeriesComparisonResponse]
given Schema[SeriesComparisonResponse] = Schema.derived[model.SeriesComparisonResponse]

type SeriesComparisonTrendsResponse = model.SeriesComparisonTrendsResponse
given Codec.AsObject[SeriesComparisonTrendsResponse] = Codec.AsObject.derived[model.SeriesComparisonTrendsResponse]
given Schema[SeriesComparisonTrendsResponse] = Schema.derived[model.SeriesComparisonTrendsResponse]

type TrendSeriesResponse = model.TrendSeriesResponse
given Codec.AsObject[TrendSeriesResponse] = Codec.AsObject.derived[model.TrendSeriesResponse]
given Schema[TrendSeriesResponse] = Schema.derived[model.TrendSeriesResponse]

type TrendPointResponse = model.TrendPointResponse
given Codec.AsObject[TrendPointResponse] = Codec.AsObject.derived[model.TrendPointResponse]
given Schema[TrendPointResponse] = Schema.derived[model.TrendPointResponse]

type SeriesComparisonHistogramsResponse = model.SeriesComparisonHistogramsResponse
given Codec.AsObject[SeriesComparisonHistogramsResponse] = Codec.AsObject.derived[model.SeriesComparisonHistogramsResponse]
given Schema[SeriesComparisonHistogramsResponse] = Schema.derived[model.SeriesComparisonHistogramsResponse]

type HistogramResponse = model.HistogramResponse
given Codec.AsObject[HistogramResponse] = Codec.AsObject.derived[model.HistogramResponse]
given Schema[HistogramResponse] = Schema.derived[model.HistogramResponse]

type HistogramBinResponse = model.HistogramBinResponse
given Codec.AsObject[HistogramBinResponse] = Codec.AsObject.derived[model.HistogramBinResponse]
given Schema[HistogramBinResponse] = Schema.derived[model.HistogramBinResponse]

type HistogramSeriesResponse = model.HistogramSeriesResponse
given Codec.AsObject[HistogramSeriesResponse] = Codec.AsObject.derived[model.HistogramSeriesResponse]
given Schema[HistogramSeriesResponse] = Schema.derived[model.HistogramSeriesResponse]

type HeadToHeadResponse = model.HeadToHeadResponse
given Codec.AsObject[HeadToHeadResponse] = Codec.AsObject.derived[model.HeadToHeadResponse]
given Schema[HeadToHeadResponse] = Schema.derived[model.HeadToHeadResponse]

type HeadToHeadEntryResponse = model.HeadToHeadEntryResponse
given Codec.AsObject[HeadToHeadEntryResponse] = Codec.AsObject.derived[model.HeadToHeadEntryResponse]
given Schema[HeadToHeadEntryResponse] = Schema.derived[model.HeadToHeadEntryResponse]

type MatchPlayerPointResponse = model.MatchPlayerPointResponse
given Codec.AsObject[MatchPlayerPointResponse] = Codec.AsObject.derived[model.MatchPlayerPointResponse]
given Schema[MatchPlayerPointResponse] = Schema.derived[model.MatchPlayerPointResponse]

