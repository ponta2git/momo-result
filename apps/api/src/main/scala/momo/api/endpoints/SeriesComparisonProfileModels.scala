package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

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
) derives Codec.AsObject
object RecentFormPlayerResponse:
  given Schema[RecentFormPlayerResponse] = Schema.derived

final case class MomentumSwitchResponse(entries: List[MomentumSwitchPlayerResponse])
    derives Codec.AsObject
object MomentumSwitchResponse:
  given Schema[MomentumSwitchResponse] = Schema.derived

final case class MomentumSwitchPlayerResponse(
    memberId: String,
    denominator: Int,
    transitionCount: Int,
    afterLower: MomentumSwitchRateResponse,
    afterFourth: MomentumSwitchRateResponse,
    afterPodium: MomentumSwitchRateResponse,
    transitionRows: List[MomentumSwitchTransitionRowResponse],
) derives Codec.AsObject
object MomentumSwitchPlayerResponse:
  given Schema[MomentumSwitchPlayerResponse] = Schema.derived

final case class MomentumSwitchRateResponse(
    targetCount: Int,
    successCount: Int,
    rate: Option[Double],
    baselineRate: Option[Double],
    deltaFromBaseline: Option[Double],
    status: String,
) derives Codec.AsObject
object MomentumSwitchRateResponse:
  given Schema[MomentumSwitchRateResponse] = Schema.derived

final case class MomentumSwitchTransitionRowResponse(
    previousRank: Int,
    targetCount: Int,
    status: String,
    cells: List[MomentumSwitchTransitionCellResponse],
) derives Codec.AsObject
object MomentumSwitchTransitionRowResponse:
  given Schema[MomentumSwitchTransitionRowResponse] = Schema.derived

final case class MomentumSwitchTransitionCellResponse(
    nextRank: Int,
    count: Int,
    rate: Option[Double],
) derives Codec.AsObject
object MomentumSwitchTransitionCellResponse:
  given Schema[MomentumSwitchTransitionCellResponse] = Schema.derived

final case class PlayerPerformanceProfilesResponse(
    rankStandardDeviationMedian: Option[Double],
    averageRankScoreMedian: Option[Double],
    averageRevenueAssetRateMedian: Option[Double],
    entries: List[PlayerPerformanceProfileResponse],
) derives Codec.AsObject
object PlayerPerformanceProfilesResponse:
  given Schema[PlayerPerformanceProfilesResponse] = Schema.derived

final case class PlayerPerformanceProfileResponse(
    memberId: String,
    rankStandardDeviation: Option[Double],
    podiumRate: Option[Double],
    averageRankScore: Option[Double],
    averageRevenueAssetRate: Option[Double],
    profileKind: Option[String],
    strategyKind: Option[String],
    status: String,
) derives Codec.AsObject
object PlayerPerformanceProfileResponse:
  given Schema[PlayerPerformanceProfileResponse] = Schema.derived

final case class AssetStyleProfilesResponse(
    lowAssetThreshold: Option[Int],
    highAssetThreshold: Option[Int],
    blowoutWinThreshold: Option[Int],
    nearMissSecondThreshold: Option[Int],
    heavyLossThreshold: Option[Int],
    entries: List[AssetStyleProfileResponse],
) derives Codec.AsObject
object AssetStyleProfilesResponse:
  given Schema[AssetStyleProfilesResponse] = Schema.derived

final case class AssetStyleProfileResponse(
    memberId: String,
    targetCount: Int,
    primaryKind: Option[String],
    secondaryKind: Option[String],
    shapeKind: Option[String],
    tags: List[String],
    metrics: AssetStyleMetricsResponse,
    status: String,
) derives Codec.AsObject
object AssetStyleProfileResponse:
  given Schema[AssetStyleProfileResponse] = Schema.derived

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
) derives Codec.AsObject
object AssetStyleMetricsResponse:
  given Schema[AssetStyleMetricsResponse] = Schema.derived

final case class MatchNoInEventBreakdownResponse(
    matchNoInEvent: Int,
    playerRows: List[MatchNoInEventPlayerBreakdownResponse],
) derives Codec.AsObject
object MatchNoInEventBreakdownResponse:
  given Schema[MatchNoInEventBreakdownResponse] = Schema.derived

final case class MatchNoInEventPlayerBreakdownResponse(
    memberId: String,
    targetCount: Int,
    averageRank: Option[Double],
    podiumRate: Option[Double],
    status: String,
) derives Codec.AsObject
object MatchNoInEventPlayerBreakdownResponse:
  given Schema[MatchNoInEventPlayerBreakdownResponse] = Schema.derived

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
) derives Codec.AsObject
object MatchTimelinePointResponse:
  given Schema[MatchTimelinePointResponse] = Schema.derived

final case class PlayOrderBaselineResponse(
    playOrder: Int,
    assetsAverage: Option[Double],
    revenueAverage: Option[Double],
    matchCount: Int,
) derives Codec.AsObject
object PlayOrderBaselineResponse:
  given Schema[PlayOrderBaselineResponse] = Schema.derived

final case class SeriesComparisonHighlightResponse(
    id: String,
    title: String,
    winnerMemberIds: List[String],
    metricId: String,
    value: Option[Double],
    targetCount: Int,
    status: String,
) derives Codec.AsObject
object SeriesComparisonHighlightResponse:
  given Schema[SeriesComparisonHighlightResponse] = Schema.derived

final case class SeriesComparisonDataQualityResponse(items: List[MetricQualityResponse])
    derives Codec.AsObject
object SeriesComparisonDataQualityResponse:
  given Schema[SeriesComparisonDataQualityResponse] = Schema.derived

final case class MetricQualityResponse(
    metricId: String,
    playerMemberId: Option[String],
    denominator: Int,
    targetCount: Int,
    status: String,
    hasTies: Boolean,
) derives Codec.AsObject
object MetricQualityResponse:
  given Schema[MetricQualityResponse] = Schema.derived
