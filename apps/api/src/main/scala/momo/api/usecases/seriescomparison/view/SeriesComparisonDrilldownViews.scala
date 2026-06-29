package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonDrilldownView(
    schemaVersion: Int,
    metricId: String,
    scope: SeriesComparisonScopeView,
    player: SeriesComparisonPlayerView,
    rankAverageHistory: Option[SeriesComparisonRankAverageHistoryPayloadView],
    playOrderRankHistory: Option[SeriesComparisonPlayOrderRankHistoryPayloadView],
    dataQuality: SeriesComparisonDataQualityView,
)
final case class SeriesComparisonRankAverageHistoryPayloadView(
    summary: SeriesComparisonRankAverageHistorySummaryView,
    matchRows: List[SeriesComparisonRankAverageHistoryMatchRowView],
    heldEventRows: List[SeriesComparisonRankAverageHistoryEventRowView],
)
final case class SeriesComparisonRankAverageHistorySummaryView(
    targetCount: Int,
    currentAverageRank: Option[Double],
    averageRankDeltaFromFirst: Option[Double],
    latestHeldEventAverageRankDelta: Option[Double],
    status: String,
)
final case class SeriesComparisonRankAverageHistoryMatchRowView(
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
final case class SeriesComparisonRankAverageHistoryEventRowView(
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
final case class SeriesComparisonPlayOrderRankHistoryPayloadView(
    summary: SeriesComparisonPlayOrderRankHistorySummaryView,
    averageTrendRows: List[SeriesComparisonPlayOrderRankHistoryTrendRowView],
    playOrderRows: List[SeriesComparisonPlayOrderRankHistoryPlayOrderRowView],
)
final case class SeriesComparisonPlayOrderRankHistorySummaryView(
    targetCount: Int,
    currentAverageRank: Option[Double],
    bestPlayOrder: Option[Int],
    bestPlayOrderAverageRank: Option[Double],
    worstPlayOrder: Option[Int],
    worstPlayOrderAverageRank: Option[Double],
    spread: Option[Double],
    countsByPlayOrder: List[SeriesComparisonPlayOrderCountView],
)
final case class SeriesComparisonPlayOrderCountView(playOrder: Int, matchCount: Int)

final case class SeriesComparisonPlayOrderRankHistoryTrendRowView(
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
final case class SeriesComparisonPlayOrderRankHistoryPlayOrderRowView(
    playOrder: Int,
    matchCount: Int,
    rankAverage: Option[Double],
    rankDistribution: List[RankDistributionView],
    podiumCount: Int,
    podiumRate: Option[Double],
    lowerHalfCount: Int,
    lowerHalfRate: Option[Double],
    baselineRankAverage: Option[Double],
    baselineDelta: Option[Double],
)
