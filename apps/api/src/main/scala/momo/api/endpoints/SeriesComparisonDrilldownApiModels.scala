package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.usecases.seriescomparison.view

type SeriesComparisonDrilldownResponse = view.SeriesComparisonDrilldownView
given Codec.AsObject[SeriesComparisonDrilldownResponse] =
  Codec.AsObject.derived[view.SeriesComparisonDrilldownView]
given Schema[SeriesComparisonDrilldownResponse] =
  Schema.derived[view.SeriesComparisonDrilldownView].name(
    Schema.SName("SeriesComparisonDrilldownResponse")
  )

type SeriesComparisonRankAverageHistoryPayloadResponse =
  view.SeriesComparisonRankAverageHistoryPayloadView
given Codec.AsObject[SeriesComparisonRankAverageHistoryPayloadResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistoryPayloadView]
given Schema[SeriesComparisonRankAverageHistoryPayloadResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistoryPayloadView].name(
    Schema.SName("SeriesComparisonRankAverageHistoryPayloadResponse")
  )

type SeriesComparisonRankAverageHistorySummaryResponse =
  view.SeriesComparisonRankAverageHistorySummaryView
given Codec.AsObject[SeriesComparisonRankAverageHistorySummaryResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistorySummaryView]
given Schema[SeriesComparisonRankAverageHistorySummaryResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistorySummaryView].name(
    Schema.SName("SeriesComparisonRankAverageHistorySummaryResponse")
  )

type SeriesComparisonRankAverageHistoryMatchRowResponse =
  view.SeriesComparisonRankAverageHistoryMatchRowView
given Codec.AsObject[SeriesComparisonRankAverageHistoryMatchRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistoryMatchRowView]
given Schema[SeriesComparisonRankAverageHistoryMatchRowResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistoryMatchRowView].name(
    Schema.SName("SeriesComparisonRankAverageHistoryMatchRowResponse")
  )

type SeriesComparisonRankAverageHistoryEventRowResponse =
  view.SeriesComparisonRankAverageHistoryEventRowView
given Codec.AsObject[SeriesComparisonRankAverageHistoryEventRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAverageHistoryEventRowView]
given Schema[SeriesComparisonRankAverageHistoryEventRowResponse] =
  Schema.derived[view.SeriesComparisonRankAverageHistoryEventRowView].name(
    Schema.SName("SeriesComparisonRankAverageHistoryEventRowResponse")
  )

type SeriesComparisonPlayOrderRankHistoryPayloadResponse =
  view.SeriesComparisonPlayOrderRankHistoryPayloadView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryPayloadResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistoryPayloadView]
given Schema[SeriesComparisonPlayOrderRankHistoryPayloadResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistoryPayloadView].name(
    Schema.SName("SeriesComparisonPlayOrderRankHistoryPayloadResponse")
  )

type SeriesComparisonPlayOrderRankHistorySummaryResponse =
  view.SeriesComparisonPlayOrderRankHistorySummaryView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistorySummaryResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistorySummaryView]
given Schema[SeriesComparisonPlayOrderRankHistorySummaryResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistorySummaryView].name(
    Schema.SName("SeriesComparisonPlayOrderRankHistorySummaryResponse")
  )

type SeriesComparisonPlayOrderCountResponse = view.SeriesComparisonPlayOrderCountView
given Codec.AsObject[SeriesComparisonPlayOrderCountResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderCountView]
given Schema[SeriesComparisonPlayOrderCountResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderCountView].name(
    Schema.SName("SeriesComparisonPlayOrderCountResponse")
  )

type SeriesComparisonPlayOrderRankHistoryTrendRowResponse =
  view.SeriesComparisonPlayOrderRankHistoryTrendRowView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistoryTrendRowView]
given Schema[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistoryTrendRowView].name(
    Schema.SName("SeriesComparisonPlayOrderRankHistoryTrendRowResponse")
  )

type SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse =
  view.SeriesComparisonPlayOrderRankHistoryPlayOrderRowView
given Codec.AsObject[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayOrderRankHistoryPlayOrderRowView]
given Schema[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] =
  Schema.derived[view.SeriesComparisonPlayOrderRankHistoryPlayOrderRowView].name(
    Schema.SName("SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse")
  )
