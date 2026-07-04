package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.usecases.seriescomparison.view

type SeriesComparisonScopeResponse = view.SeriesComparisonScopeView
given Codec.AsObject[SeriesComparisonScopeResponse] =
  Codec.AsObject.derived[view.SeriesComparisonScopeView]
given Schema[SeriesComparisonScopeResponse] =
  Schema.derived[view.SeriesComparisonScopeView].name(Schema.SName("SeriesComparisonScopeResponse"))

type SeriesComparisonPlayerResponse = view.SeriesComparisonPlayerView
given Codec.AsObject[SeriesComparisonPlayerResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerView]
given Schema[SeriesComparisonPlayerResponse] = Schema.derived[view.SeriesComparisonPlayerView].name(
  Schema.SName("SeriesComparisonPlayerResponse")
)

type SeriesComparisonPlayerMetricsEntry = view.SeriesComparisonPlayerMetricsEntry
given Codec.AsObject[SeriesComparisonPlayerMetricsEntry] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerMetricsEntry]
given Schema[SeriesComparisonPlayerMetricsEntry] =
  Schema.derived[view.SeriesComparisonPlayerMetricsEntry]

type SeriesComparisonPlayerMetricsResponse = view.SeriesComparisonPlayerMetricsView
given Codec.AsObject[SeriesComparisonPlayerMetricsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerMetricsView]
given Schema[SeriesComparisonPlayerMetricsResponse] =
  Schema.derived[view.SeriesComparisonPlayerMetricsView].name(
    Schema.SName("SeriesComparisonPlayerMetricsResponse")
  )

type RankMetricsResponse = view.RankMetricsView
given Codec.AsObject[RankMetricsResponse] = Codec.AsObject.derived[view.RankMetricsView]
given Schema[RankMetricsResponse] =
  Schema.derived[view.RankMetricsView].name(Schema.SName("RankMetricsResponse"))

type RankDistributionResponse = view.RankDistributionView
given Codec.AsObject[RankDistributionResponse] =
  Codec.AsObject.derived[view.RankDistributionView]
given Schema[RankDistributionResponse] =
  Schema.derived[view.RankDistributionView].name(Schema.SName("RankDistributionResponse"))

type MoneyDistributionMetricsResponse = view.MoneyDistributionMetricsView
given Codec.AsObject[MoneyDistributionMetricsResponse] =
  Codec.AsObject.derived[view.MoneyDistributionMetricsView]
given Schema[MoneyDistributionMetricsResponse] =
  Schema.derived[view.MoneyDistributionMetricsView].name(
    Schema.SName("MoneyDistributionMetricsResponse")
  )

type RevenueDistributionMetricsResponse = view.RevenueDistributionMetricsView
given Codec.AsObject[RevenueDistributionMetricsResponse] =
  Codec.AsObject.derived[view.RevenueDistributionMetricsView]
given Schema[RevenueDistributionMetricsResponse] =
  Schema.derived[view.RevenueDistributionMetricsView].name(
    Schema.SName("RevenueDistributionMetricsResponse")
  )

type RateCountMetricsResponse = view.RateCountMetricsView
given Codec.AsObject[RateCountMetricsResponse] =
  Codec.AsObject.derived[view.RateCountMetricsView]
given Schema[RateCountMetricsResponse] =
  Schema.derived[view.RateCountMetricsView].name(Schema.SName("RateCountMetricsResponse"))

type PlayOrderMetricsResponse = view.PlayOrderMetricsView
given Codec.AsObject[PlayOrderMetricsResponse] =
  Codec.AsObject.derived[view.PlayOrderMetricsView]
given Schema[PlayOrderMetricsResponse] =
  Schema.derived[view.PlayOrderMetricsView].name(Schema.SName("PlayOrderMetricsResponse"))

type PlayOrderBreakdownResponse = view.PlayOrderBreakdownView
given Codec.AsObject[PlayOrderBreakdownResponse] =
  Codec.AsObject.derived[view.PlayOrderBreakdownView]
given Schema[PlayOrderBreakdownResponse] =
  Schema.derived[view.PlayOrderBreakdownView].name(Schema.SName("PlayOrderBreakdownResponse"))

type GinjiMetricsResponse = view.GinjiMetricsView
given Codec.AsObject[GinjiMetricsResponse] = Codec.AsObject.derived[view.GinjiMetricsView]
given Schema[GinjiMetricsResponse] =
  Schema.derived[view.GinjiMetricsView].name(Schema.SName("GinjiMetricsResponse"))

type NonRevenueMetricsResponse = view.NonRevenueMetricsView
given Codec.AsObject[NonRevenueMetricsResponse] =
  Codec.AsObject.derived[view.NonRevenueMetricsView]
given Schema[NonRevenueMetricsResponse] =
  Schema.derived[view.NonRevenueMetricsView].name(Schema.SName("NonRevenueMetricsResponse"))

type DestinationMetricsResponse = view.DestinationMetricsView
given Codec.AsObject[DestinationMetricsResponse] =
  Codec.AsObject.derived[view.DestinationMetricsView]
given Schema[DestinationMetricsResponse] =
  Schema.derived[view.DestinationMetricsView].name(Schema.SName("DestinationMetricsResponse"))

type ConditionalRankOutcomeResponse = view.ConditionalRankOutcomeView
given Codec.AsObject[ConditionalRankOutcomeResponse] =
  Codec.AsObject.derived[view.ConditionalRankOutcomeView]
given Schema[ConditionalRankOutcomeResponse] = Schema.derived[view.ConditionalRankOutcomeView].name(
  Schema.SName("ConditionalRankOutcomeResponse")
)

type RevenueOutcomeMetricsResponse = view.RevenueOutcomeMetricsView
given Codec.AsObject[RevenueOutcomeMetricsResponse] =
  Codec.AsObject.derived[view.RevenueOutcomeMetricsView]
given Schema[RevenueOutcomeMetricsResponse] =
  Schema.derived[view.RevenueOutcomeMetricsView].name(Schema.SName("RevenueOutcomeMetricsResponse"))

type DestinationOutcomeMetricsResponse = view.DestinationOutcomeMetricsView
given Codec.AsObject[DestinationOutcomeMetricsResponse] =
  Codec.AsObject.derived[view.DestinationOutcomeMetricsView]
given Schema[DestinationOutcomeMetricsResponse] =
  Schema.derived[view.DestinationOutcomeMetricsView].name(
    Schema.SName("DestinationOutcomeMetricsResponse")
  )

type CardShopDestinationResponse = view.CardShopDestinationView
given Codec.AsObject[CardShopDestinationResponse] =
  Codec.AsObject.derived[view.CardShopDestinationView]
given Schema[CardShopDestinationResponse] =
  Schema.derived[view.CardShopDestinationView].name(Schema.SName("CardShopDestinationResponse"))

type CardShopDestinationPlayerResponse = view.CardShopDestinationPlayerView
given Codec.AsObject[CardShopDestinationPlayerResponse] =
  Codec.AsObject.derived[view.CardShopDestinationPlayerView]
given Schema[CardShopDestinationPlayerResponse] =
  Schema.derived[view.CardShopDestinationPlayerView].name(
    Schema.SName("CardShopDestinationPlayerResponse")
  )

type CardShopDestinationQuadrantResponse = view.CardShopDestinationQuadrantView
given Codec.AsObject[CardShopDestinationQuadrantResponse] =
  Codec.AsObject.derived[view.CardShopDestinationQuadrantView]
given Schema[CardShopDestinationQuadrantResponse] =
  Schema.derived[view.CardShopDestinationQuadrantView].name(
    Schema.SName("CardShopDestinationQuadrantResponse")
  )

type StabilityMetricsResponse = view.StabilityMetricsView
given Codec.AsObject[StabilityMetricsResponse] =
  Codec.AsObject.derived[view.StabilityMetricsView]
given Schema[StabilityMetricsResponse] =
  Schema.derived[view.StabilityMetricsView].name(Schema.SName("StabilityMetricsResponse"))

type SeriesComparisonReviewResponse = view.SeriesComparisonReviewView
given Codec.AsObject[SeriesComparisonReviewResponse] =
  Codec.AsObject.derived[view.SeriesComparisonReviewView]
given Schema[SeriesComparisonReviewResponse] = Schema.derived[view.SeriesComparisonReviewView].name(
  Schema.SName("SeriesComparisonReviewResponse")
)

type SeriesComparisonRankSpreadSignalResponse =
  view.SeriesComparisonRankSpreadSignalView
given Codec.AsObject[SeriesComparisonRankSpreadSignalResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankSpreadSignalView]
given Schema[SeriesComparisonRankSpreadSignalResponse] =
  Schema.derived[view.SeriesComparisonRankSpreadSignalView].name(
    Schema.SName("SeriesComparisonRankSpreadSignalResponse")
  )

type SeriesComparisonResponse = view.SeriesComparisonView
given Codec.AsObject[SeriesComparisonResponse] =
  Codec.AsObject.derived[view.SeriesComparisonView]
given Schema[SeriesComparisonResponse] =
  Schema.derived[view.SeriesComparisonView].name(Schema.SName("SeriesComparisonResponse"))

type SeriesComparisonTrendsResponse = view.SeriesComparisonTrendsView
given Codec.AsObject[SeriesComparisonTrendsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonTrendsView]
given Schema[SeriesComparisonTrendsResponse] = Schema.derived[view.SeriesComparisonTrendsView].name(
  Schema.SName("SeriesComparisonTrendsResponse")
)

type TrendSeriesResponse = view.TrendSeriesView
given Codec.AsObject[TrendSeriesResponse] = Codec.AsObject.derived[view.TrendSeriesView]
given Schema[TrendSeriesResponse] =
  Schema.derived[view.TrendSeriesView].name(Schema.SName("TrendSeriesResponse"))

type TrendPointResponse = view.TrendPointView
given Codec.AsObject[TrendPointResponse] = Codec.AsObject.derived[view.TrendPointView]
given Schema[TrendPointResponse] =
  Schema.derived[view.TrendPointView].name(Schema.SName("TrendPointResponse"))

type SeriesComparisonHistogramsResponse = view.SeriesComparisonHistogramsView
given Codec.AsObject[SeriesComparisonHistogramsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonHistogramsView]
given Schema[SeriesComparisonHistogramsResponse] =
  Schema.derived[view.SeriesComparisonHistogramsView].name(
    Schema.SName("SeriesComparisonHistogramsResponse")
  )

type HistogramResponse = view.HistogramView
given Codec.AsObject[HistogramResponse] = Codec.AsObject.derived[view.HistogramView]
given Schema[HistogramResponse] =
  Schema.derived[view.HistogramView].name(Schema.SName("HistogramResponse"))

type HistogramBinResponse = view.HistogramBinView
given Codec.AsObject[HistogramBinResponse] = Codec.AsObject.derived[view.HistogramBinView]
given Schema[HistogramBinResponse] =
  Schema.derived[view.HistogramBinView].name(Schema.SName("HistogramBinResponse"))

type HistogramSeriesResponse = view.HistogramSeriesView
given Codec.AsObject[HistogramSeriesResponse] =
  Codec.AsObject.derived[view.HistogramSeriesView]
given Schema[HistogramSeriesResponse] =
  Schema.derived[view.HistogramSeriesView].name(Schema.SName("HistogramSeriesResponse"))

type HeadToHeadResponse = view.HeadToHeadView
given Codec.AsObject[HeadToHeadResponse] = Codec.AsObject.derived[view.HeadToHeadView]
given Schema[HeadToHeadResponse] =
  Schema.derived[view.HeadToHeadView].name(Schema.SName("HeadToHeadResponse"))

type HeadToHeadEntryResponse = view.HeadToHeadEntryView
given Codec.AsObject[HeadToHeadEntryResponse] =
  Codec.AsObject.derived[view.HeadToHeadEntryView]
given Schema[HeadToHeadEntryResponse] =
  Schema.derived[view.HeadToHeadEntryView].name(Schema.SName("HeadToHeadEntryResponse"))

type MatchPlayerPointResponse = view.MatchPlayerPointView
given Codec.AsObject[MatchPlayerPointResponse] =
  Codec.AsObject.derived[view.MatchPlayerPointView]
given Schema[MatchPlayerPointResponse] =
  Schema.derived[view.MatchPlayerPointView].name(Schema.SName("MatchPlayerPointResponse"))
