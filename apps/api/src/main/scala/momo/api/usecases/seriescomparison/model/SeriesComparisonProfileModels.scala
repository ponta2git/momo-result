package momo.api.usecases.seriescomparison.model


final case class RecentFormPlayerResponse(
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
final case class MomentumSwitchResponse(entries: List[MomentumSwitchPlayerResponse])
   
final case class MomentumSwitchPlayerResponse(
    memberId: String,
    denominator: Int,
    transitionCount: Int,
    afterLower: MomentumSwitchRateResponse,
    afterFourth: MomentumSwitchRateResponse,
    afterPodium: MomentumSwitchRateResponse,
    transitionRows: List[MomentumSwitchTransitionRowResponse],
)
final case class MomentumSwitchRateResponse(
    targetCount: Int,
    successCount: Int,
    rate: Option[Double],
    baselineRate: Option[Double],
    deltaFromBaseline: Option[Double],
    status: String,
)
final case class MomentumSwitchTransitionRowResponse(
    previousRank: Int,
    targetCount: Int,
    status: String,
    cells: List[MomentumSwitchTransitionCellResponse],
)
final case class MomentumSwitchTransitionCellResponse(
    nextRank: Int,
    count: Int,
    rate: Option[Double],
)
final case class PlayerPerformanceProfilesResponse(
    rankStandardDeviationMedian: Option[Double],
    averageRankScoreMedian: Option[Double],
    averageRevenueAssetRateMedian: Option[Double],
    entries: List[PlayerPerformanceProfileResponse],
)
final case class PlayerPerformanceProfileResponse(
    memberId: String,
    rankStandardDeviation: Option[Double],
    podiumRate: Option[Double],
    averageRankScore: Option[Double],
    averageRevenueAssetRate: Option[Double],
    profileKind: Option[String],
    strategyKind: Option[String],
    status: String,
)
final case class AssetStyleProfilesResponse(
    lowAssetThreshold: Option[Int],
    highAssetThreshold: Option[Int],
    blowoutWinThreshold: Option[Int],
    nearMissSecondThreshold: Option[Int],
    heavyLossThreshold: Option[Int],
    entries: List[AssetStyleProfileResponse],
)
final case class AssetStyleProfileResponse(
    memberId: String,
    targetCount: Int,
    primaryKind: Option[String],
    secondaryKind: Option[String],
    shapeKind: Option[String],
    tags: List[String],
    metrics: AssetStyleMetricsResponse,
    status: String,
)
final case class AssetStyleMetricsResponse(
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
final case class MatchNoInEventBreakdownResponse(
    matchNoInEvent: Int,
    playerRows: List[MatchNoInEventPlayerBreakdownResponse],
)
final case class MatchNoInEventPlayerBreakdownResponse(
    memberId: String,
    targetCount: Int,
    averageRank: Option[Double],
    podiumRate: Option[Double],
    status: String,
)
final case class MatchTimelinePointResponse(
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
final case class PlayOrderBaselineResponse(
    playOrder: Int,
    assetsAverage: Option[Double],
    revenueAverage: Option[Double],
    matchCount: Int,
)
final case class SeriesComparisonHighlightResponse(
    id: String,
    title: String,
    winnerMemberIds: List[String],
    metricId: String,
    value: Option[Double],
    targetCount: Int,
    status: String,
)
final case class SeriesComparisonDataQualityResponse(items: List[MetricQualityResponse])
   
final case class MetricQualityResponse(
    metricId: String,
    playerMemberId: Option[String],
    denominator: Int,
    targetCount: Int,
    status: String,
    hasTies: Boolean,
)
