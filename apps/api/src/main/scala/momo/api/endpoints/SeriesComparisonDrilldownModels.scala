package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

final case class SeriesComparisonDrilldownResponse(
    schemaVersion: Int,
    metricId: String,
    scope: SeriesComparisonScopeResponse,
    player: SeriesComparisonPlayerResponse,
    rankAverageHistory: Option[SeriesComparisonRankAverageHistoryPayloadResponse],
    playOrderRankHistory: Option[SeriesComparisonPlayOrderRankHistoryPayloadResponse],
    dataQuality: SeriesComparisonDataQualityResponse,
) derives Codec.AsObject
object SeriesComparisonDrilldownResponse:
  given Schema[SeriesComparisonDrilldownResponse] = Schema.derived

final case class SeriesComparisonRankAverageHistoryPayloadResponse(
    summary: SeriesComparisonRankAverageHistorySummaryResponse,
    matchRows: List[SeriesComparisonRankAverageHistoryMatchRowResponse],
    heldEventRows: List[SeriesComparisonRankAverageHistoryEventRowResponse],
) derives Codec.AsObject
object SeriesComparisonRankAverageHistoryPayloadResponse:
  given Schema[SeriesComparisonRankAverageHistoryPayloadResponse] = Schema.derived

final case class SeriesComparisonRankAverageHistorySummaryResponse(
    targetCount: Int,
    currentAverageRank: Option[Double],
    averageRankDeltaFromFirst: Option[Double],
    latestHeldEventAverageRankDelta: Option[Double],
    status: String,
) derives Codec.AsObject
object SeriesComparisonRankAverageHistorySummaryResponse:
  given Schema[SeriesComparisonRankAverageHistorySummaryResponse] = Schema.derived

final case class SeriesComparisonRankAverageHistoryMatchRowResponse(
    matchIndex: Int,
    matchId: String,
    playedAt: String,
    heldEventId: String,
    matchNoInEvent: Int,
    rank: Int,
    previousRank: Option[Int],
    rankDelta: Option[Int],
    cumulativeAverageRank: Double,
    cumulativeAverageRankDelta: Option[Double],
) derives Codec.AsObject
object SeriesComparisonRankAverageHistoryMatchRowResponse:
  given Schema[SeriesComparisonRankAverageHistoryMatchRowResponse] = Schema.derived

final case class SeriesComparisonRankAverageHistoryEventRowResponse(
    heldEventId: String,
    firstPlayedAt: String,
    matchCount: Int,
    ranks: List[Int],
    eventAverageRank: Double,
    eventRankDelta: Option[Int],
    cumulativeAverageBefore: Option[Double],
    cumulativeAverageAfter: Double,
    cumulativeAverageDelta: Option[Double],
) derives Codec.AsObject
object SeriesComparisonRankAverageHistoryEventRowResponse:
  given Schema[SeriesComparisonRankAverageHistoryEventRowResponse] = Schema.derived

final case class SeriesComparisonPlayOrderRankHistoryPayloadResponse(
    summary: SeriesComparisonPlayOrderRankHistorySummaryResponse,
    averageTrendRows: List[SeriesComparisonPlayOrderRankHistoryTrendRowResponse],
    playOrderRows: List[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse],
) derives Codec.AsObject
object SeriesComparisonPlayOrderRankHistoryPayloadResponse:
  given Schema[SeriesComparisonPlayOrderRankHistoryPayloadResponse] = Schema.derived

final case class SeriesComparisonPlayOrderRankHistorySummaryResponse(
    targetCount: Int,
    currentAverageRank: Option[Double],
    bestPlayOrder: Option[Int],
    bestPlayOrderAverageRank: Option[Double],
    worstPlayOrder: Option[Int],
    worstPlayOrderAverageRank: Option[Double],
    spread: Option[Double],
    countsByPlayOrder: List[SeriesComparisonPlayOrderCountResponse],
) derives Codec.AsObject
object SeriesComparisonPlayOrderRankHistorySummaryResponse:
  given Schema[SeriesComparisonPlayOrderRankHistorySummaryResponse] = Schema.derived

final case class SeriesComparisonPlayOrderCountResponse(playOrder: Int, matchCount: Int)
    derives Codec.AsObject
object SeriesComparisonPlayOrderCountResponse:
  given Schema[SeriesComparisonPlayOrderCountResponse] = Schema.derived

final case class SeriesComparisonPlayOrderRankHistoryTrendRowResponse(
    matchIndex: Int,
    matchId: String,
    playedAt: String,
    heldEventId: String,
    matchNoInEvent: Int,
    playOrder: Int,
    rank: Int,
    playOrderOccurrenceIndex: Int,
    cumulativeAverageRankByPlayOrder: Double,
    previousCumulativeAverageRankByPlayOrder: Option[Double],
    cumulativeAverageRankDeltaByPlayOrder: Option[Double],
) derives Codec.AsObject
object SeriesComparisonPlayOrderRankHistoryTrendRowResponse:
  given Schema[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] = Schema.derived

final case class SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse(
    playOrder: Int,
    matchCount: Int,
    rankAverage: Option[Double],
    rankDistribution: List[RankDistributionResponse],
    podiumCount: Int,
    podiumRate: Option[Double],
    lowerHalfCount: Int,
    lowerHalfRate: Option[Double],
    baselineRankAverage: Option[Double],
    baselineDelta: Option[Double],
) derives Codec.AsObject
object SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse:
  given Schema[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] = Schema.derived
