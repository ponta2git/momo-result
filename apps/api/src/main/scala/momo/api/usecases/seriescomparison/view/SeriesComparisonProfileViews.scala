package momo.api.usecases.seriescomparison.view

final case class RecentFormPlayerView(
    memberId: String,
    windowSize: Int,
    targetCount: Int,
    averageRank: Option[Double],
    podiumRate: Option[Double],
    winStreak: Int,
    podiumStreak: Int,
    lowerHalfStreak: Int,
    status: String,
)
final case class MomentumSwitchView(entries: List[MomentumSwitchPlayerView])

final case class MomentumSwitchPlayerView(
    memberId: String,
    denominator: Int,
    transitionCount: Int,
    afterLower: MomentumSwitchRateView,
    afterFourth: MomentumSwitchRateView,
    afterPodium: MomentumSwitchRateView,
    transitionRows: List[MomentumSwitchTransitionRowView],
)
final case class MomentumSwitchRateView(
    targetCount: Int,
    successCount: Int,
    rate: Option[Double],
    baselineRate: Option[Double],
    deltaFromBaseline: Option[Double],
    status: String,
)
final case class MomentumSwitchTransitionRowView(
    previousRank: Int,
    targetCount: Int,
    status: String,
    cells: List[MomentumSwitchTransitionCellView],
)
final case class MomentumSwitchTransitionCellView(
    nextRank: Int,
    count: Int,
    rate: Option[Double],
)
final case class PlayerPerformanceProfilesView(
    rankStandardDeviationMedian: Option[Double],
    averageRankScoreMedian: Option[Double],
    averageRevenueAssetRateMedian: Option[Double],
    entries: List[PlayerPerformanceProfileView],
)
final case class PlayerPerformanceProfileView(
    memberId: String,
    rankStandardDeviation: Option[Double],
    podiumRate: Option[Double],
    averageRankScore: Option[Double],
    averageRevenueAssetRate: Option[Double],
    profileKind: Option[String],
    strategyKind: Option[String],
    status: String,
)
final case class AssetStyleProfilesView(
    lowAssetThreshold: Option[Int],
    highAssetThreshold: Option[Int],
    blowoutWinThreshold: Option[Int],
    nearMissSecondThreshold: Option[Int],
    heavyLossThreshold: Option[Int],
    entries: List[AssetStyleProfileView],
)
final case class AssetStyleProfileView(
    memberId: String,
    targetCount: Int,
    primaryKind: Option[String],
    secondaryKind: Option[String],
    shapeKind: Option[String],
    tags: List[String],
    metrics: AssetStyleMetricsView,
    status: String,
)
final case class AssetStyleMetricsView(
    p10Assets: Option[Double],
    medianAssets: Option[Double],
    p90Assets: Option[Double],
    p90P10Spread: Option[Double],
    highAssetCount: Int,
    highAssetRate: Option[Double],
    lowAssetCount: Int,
    lowAssetRate: Option[Double],
    winCount: Int,
    winRate: Option[Double],
    podiumRate: Option[Double],
    secondCount: Int,
    secondRate: Option[Double],
    lowerHalfRate: Option[Double],
    winMedianAssets: Option[Double],
    winMedianMargin: Option[Double],
    secondMedianGap: Option[Double],
    lowerHalfMedianGap: Option[Double],
    blowoutWinCount: Int,
    nearMissSecondCount: Int,
    heavyLossCount: Int,
    averageRevenueAssetRate: Option[Double],
    destinationAverage: Option[Double],
    destinationPositiveRate: Option[Double],
)
final case class MatchNoInEventBreakdownView(
    matchNoInEvent: Int,
    playerRows: List[MatchNoInEventPlayerBreakdownView],
)
final case class MatchNoInEventPlayerBreakdownView(
    memberId: String,
    targetCount: Int,
    averageRank: Option[Double],
    podiumRate: Option[Double],
    status: String,
)
final case class MatchTimelinePointView(
    matchIndex: Int,
    matchId: String,
    playedAt: String,
    assetGapFirstToSecond: Option[Int],
    assetGapFirstToLast: Option[Int],
    totalGinjiCount: Int,
    revenueTopMemberIds: List[String],
    winnerMemberId: Option[String],
    flags: List[String],
    status: String,
)
final case class PlayOrderBaselineView(
    playOrder: Int,
    assetsAverage: Option[Double],
    revenueAverage: Option[Double],
    matchCount: Int,
)
final case class SeriesComparisonHighlightView(
    id: String,
    title: String,
    winnerMemberIds: List[String],
    metricId: String,
    value: Option[Double],
    targetCount: Int,
    status: String,
)
final case class SeriesComparisonDataQualityView(items: List[MetricQualityView])

final case class MetricQualityView(
    metricId: String,
    playerMemberId: Option[String],
    denominator: Int,
    targetCount: Int,
    status: String,
    hasTies: Boolean,
)
