package momo.api.usecases.seriescomparison.model

final case class SeriesComparisonDrilldownResponse(
    schemaVersion: Int,
    metricId: String,
    scope: SeriesComparisonScopeResponse,
    player: SeriesComparisonPlayerResponse,
    rankAverageHistory: Option[SeriesComparisonRankAverageHistoryPayloadResponse],
    playOrderRankHistory: Option[SeriesComparisonPlayOrderRankHistoryPayloadResponse],
    dataQuality: SeriesComparisonDataQualityResponse,
)
final case class SeriesComparisonRankAverageHistoryPayloadResponse(
    summary: SeriesComparisonRankAverageHistorySummaryResponse,
    matchRows: List[SeriesComparisonRankAverageHistoryMatchRowResponse],
    heldEventRows: List[SeriesComparisonRankAverageHistoryEventRowResponse],
)
final case class SeriesComparisonRankAverageHistorySummaryResponse(
    targetCount: Int,
    currentAverageRank: Option[Double],
    averageRankDeltaFromFirst: Option[Double],
    latestHeldEventAverageRankDelta: Option[Double],
    status: String,
)
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
)
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
)
final case class SeriesComparisonPlayOrderRankHistoryPayloadResponse(
    summary: SeriesComparisonPlayOrderRankHistorySummaryResponse,
    averageTrendRows: List[SeriesComparisonPlayOrderRankHistoryTrendRowResponse],
    playOrderRows: List[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse],
)
final case class SeriesComparisonPlayOrderRankHistorySummaryResponse(
    targetCount: Int,
    currentAverageRank: Option[Double],
    bestPlayOrder: Option[Int],
    bestPlayOrderAverageRank: Option[Double],
    worstPlayOrder: Option[Int],
    worstPlayOrderAverageRank: Option[Double],
    spread: Option[Double],
    countsByPlayOrder: List[SeriesComparisonPlayOrderCountResponse],
)
final case class SeriesComparisonPlayOrderCountResponse(playOrder: Int, matchCount: Int)

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
)
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
)
