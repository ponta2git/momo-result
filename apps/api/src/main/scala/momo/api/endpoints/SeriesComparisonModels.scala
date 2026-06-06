package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

final case class SeriesComparisonOptionsResponse(
    schemaVersion: Int,
    latestConfirmedGameTitleId: Option[String],
    series: List[SeriesComparisonSeriesOption],
) derives Codec.AsObject
object SeriesComparisonOptionsResponse:
  given Schema[SeriesComparisonOptionsResponse] = Schema.derived

final case class SeriesComparisonSeriesOption(
    gameTitleId: String,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
    latestConfirmedPlayedAt: Option[String],
    seasons: List[SeriesComparisonScopeOption],
    maps: List[SeriesComparisonScopeOption],
) derives Codec.AsObject
object SeriesComparisonSeriesOption:
  given Schema[SeriesComparisonSeriesOption] = Schema.derived

final case class SeriesComparisonScopeOption(
    id: String,
    name: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
) derives Codec.AsObject
object SeriesComparisonScopeOption:
  given Schema[SeriesComparisonScopeOption] = Schema.derived

final case class SeriesComparisonResponse(
    schemaVersion: Int,
    scope: SeriesComparisonScopeResponse,
    matchCount: Int,
    players: List[SeriesComparisonPlayerResponse],
    metricsByPlayer: List[SeriesComparisonPlayerMetricsEntry],
    trends: SeriesComparisonTrendsResponse,
    histograms: SeriesComparisonHistogramsResponse,
    headToHead: HeadToHeadResponse,
    matchPlayerPoints: List[MatchPlayerPointResponse],
    recentFormByPlayer: List[RecentFormPlayerResponse],
    playerPerformanceProfiles: PlayerPerformanceProfilesResponse,
    assetStyleProfiles: AssetStyleProfilesResponse,
    matchNoInEventBreakdown: List[MatchNoInEventBreakdownResponse],
    matchTimeline: List[MatchTimelinePointResponse],
    cardShopDestination: CardShopDestinationResponse,
    playOrderBaselines: List[PlayOrderBaselineResponse],
    highlights: List[SeriesComparisonHighlightResponse],
    dataQuality: SeriesComparisonDataQualityResponse,
) derives Codec.AsObject
object SeriesComparisonResponse:
  given Schema[SeriesComparisonResponse] = Schema.derived

final case class SeriesComparisonScopeResponse(
    gameTitleId: String,
    gameTitleName: String,
    layoutFamily: String,
    scopeKind: String,
    scopeId: Option[String],
    scopeName: String,
) derives Codec.AsObject
object SeriesComparisonScopeResponse:
  given Schema[SeriesComparisonScopeResponse] = Schema.derived

final case class SeriesComparisonPlayerResponse(memberId: String, displayName: String)
    derives Codec.AsObject
object SeriesComparisonPlayerResponse:
  given Schema[SeriesComparisonPlayerResponse] = Schema.derived

final case class SeriesComparisonPlayerMetricsEntry(
    memberId: String,
    metrics: SeriesComparisonPlayerMetricsResponse,
) derives Codec.AsObject
object SeriesComparisonPlayerMetricsEntry:
  given Schema[SeriesComparisonPlayerMetricsEntry] = Schema.derived

final case class SeriesComparisonPlayerMetricsResponse(
    denominator: Int,
    rank: RankMetricsResponse,
    assets: MoneyDistributionMetricsResponse,
    revenue: RevenueDistributionMetricsResponse,
    podium: RateCountMetricsResponse,
    lowerHalf: RateCountMetricsResponse,
    playOrder: PlayOrderMetricsResponse,
    ginji: GinjiMetricsResponse,
    nonRevenue: NonRevenueMetricsResponse,
    destination: DestinationMetricsResponse,
    revenueOutcome: RevenueOutcomeMetricsResponse,
    destinationOutcome: DestinationOutcomeMetricsResponse,
    stability: StabilityMetricsResponse,
) derives Codec.AsObject
object SeriesComparisonPlayerMetricsResponse:
  given Schema[SeriesComparisonPlayerMetricsResponse] = Schema.derived

final case class RankMetricsResponse(
    average: Option[Double],
    distribution: List[RankDistributionResponse],
    standardDeviation: Option[Double],
) derives Codec.AsObject
object RankMetricsResponse:
  given Schema[RankMetricsResponse] = Schema.derived

final case class RankDistributionResponse(rank: Int, count: Int, rate: Option[Double])
    derives Codec.AsObject
object RankDistributionResponse:
  given Schema[RankDistributionResponse] = Schema.derived

final case class MoneyDistributionMetricsResponse(
    max: Option[Int],
    min: Option[Int],
    average: Option[Double],
    median: Option[Double],
) derives Codec.AsObject
object MoneyDistributionMetricsResponse:
  given Schema[MoneyDistributionMetricsResponse] = Schema.derived

final case class RevenueDistributionMetricsResponse(
    max: Option[Int],
    average: Option[Double],
    median: Option[Double],
) derives Codec.AsObject
object RevenueDistributionMetricsResponse:
  given Schema[RevenueDistributionMetricsResponse] = Schema.derived

final case class RateCountMetricsResponse(count: Int, rate: Option[Double]) derives Codec.AsObject
object RateCountMetricsResponse:
  given Schema[RateCountMetricsResponse] = Schema.derived

final case class PlayOrderMetricsResponse(
    assetsDiff: Option[Double],
    revenueDiff: Option[Double],
    assetsIndex: Option[Double],
    revenueIndex: Option[Double],
    breakdown: List[PlayOrderBreakdownResponse],
) derives Codec.AsObject
object PlayOrderMetricsResponse:
  given Schema[PlayOrderMetricsResponse] = Schema.derived

final case class PlayOrderBreakdownResponse(
    playOrder: Int,
    matchCount: Int,
    rankAverage: Option[Double],
    assetsAverage: Option[Double],
    revenueAverage: Option[Double],
) derives Codec.AsObject
object PlayOrderBreakdownResponse:
  given Schema[PlayOrderBreakdownResponse] = Schema.derived

final case class GinjiMetricsResponse(
    count: Int,
    encounterMatches: Int,
    encounterRate: Option[Double],
    multiEncounterMatchCount: Int,
    maxInSingleMatch: Int,
    resilienceRankAverage: Option[Double],
    resilienceAssetsAverage: Option[Double],
    resilienceRevenueAverage: Option[Double],
) derives Codec.AsObject
object GinjiMetricsResponse:
  given Schema[GinjiMetricsResponse] = Schema.derived

final case class NonRevenueMetricsResponse(
    rankDelta: Option[Double],
    highRevenueNoWinCount: Int,
    highRevenueTopCount: Int,
    highRevenueNoWinRate: Option[Double],
) derives Codec.AsObject
object NonRevenueMetricsResponse:
  given Schema[NonRevenueMetricsResponse] = Schema.derived

final case class DestinationMetricsResponse(
    conversionDelta: Option[Double],
    dependenceScore: Option[Double],
    upperTargetCount: Int,
    lowerTargetCount: Int,
) derives Codec.AsObject
object DestinationMetricsResponse:
  given Schema[DestinationMetricsResponse] = Schema.derived

final case class ConditionalRankOutcomeResponse(
    targetCount: Int,
    winCount: Int,
    winRate: Option[Double],
    podiumCount: Int,
    podiumRate: Option[Double],
    lowerHalfCount: Int,
    lowerHalfRate: Option[Double],
    rankDistribution: List[RankDistributionResponse],
    status: String,
) derives Codec.AsObject
object ConditionalRankOutcomeResponse:
  given Schema[ConditionalRankOutcomeResponse] = Schema.derived

final case class RevenueOutcomeMetricsResponse(
    top: ConditionalRankOutcomeResponse,
    lowRevenue: ConditionalRankOutcomeResponse,
    nonTopWinCount: Int,
) derives Codec.AsObject
object RevenueOutcomeMetricsResponse:
  given Schema[RevenueOutcomeMetricsResponse] = Schema.derived

final case class DestinationOutcomeMetricsResponse(
    top: ConditionalRankOutcomeResponse,
    lowDestination: ConditionalRankOutcomeResponse,
    zeroDestination: ConditionalRankOutcomeResponse,
) derives Codec.AsObject
object DestinationOutcomeMetricsResponse:
  given Schema[DestinationOutcomeMetricsResponse] = Schema.derived

final case class CardShopDestinationResponse(entries: List[CardShopDestinationPlayerResponse])
    derives Codec.AsObject
object CardShopDestinationResponse:
  given Schema[CardShopDestinationResponse] = Schema.derived

final case class CardShopDestinationPlayerResponse(
    memberId: String,
    denominator: Int,
    cardShopMatchCount: Int,
    cardShopRate: Option[Double],
    cardShopWithoutDestinationCount: Int,
    cardShopWithoutDestinationRate: Option[Double],
    quadrants: List[CardShopDestinationQuadrantResponse],
) derives Codec.AsObject
object CardShopDestinationPlayerResponse:
  given Schema[CardShopDestinationPlayerResponse] = Schema.derived

final case class CardShopDestinationQuadrantResponse(
    kind: String,
    targetCount: Int,
    rate: Option[Double],
    averageRank: Option[Double],
    winRate: Option[Double],
    podiumRate: Option[Double],
    averageAssets: Option[Double],
    averageRevenue: Option[Double],
    status: String,
) derives Codec.AsObject
object CardShopDestinationQuadrantResponse:
  given Schema[CardShopDestinationQuadrantResponse] = Schema.derived

final case class StabilityMetricsResponse(rankStandardDeviation: Option[Double])
    derives Codec.AsObject
object StabilityMetricsResponse:
  given Schema[StabilityMetricsResponse] = Schema.derived

final case class SeriesComparisonTrendsResponse(
    rankCumulativeAverage: List[TrendSeriesResponse],
    rankCumulativeStandardDeviation: List[TrendSeriesResponse],
    podiumCumulativeRate: List[TrendSeriesResponse],
    lowerHalfCumulativeRate: List[TrendSeriesResponse],
    ginjiCumulativeCount: List[TrendSeriesResponse],
) derives Codec.AsObject
object SeriesComparisonTrendsResponse:
  given Schema[SeriesComparisonTrendsResponse] = Schema.derived

final case class TrendSeriesResponse(memberId: String, points: List[TrendPointResponse])
    derives Codec.AsObject
object TrendSeriesResponse:
  given Schema[TrendSeriesResponse] = Schema.derived

final case class TrendPointResponse(
    index: Int,
    matchId: String,
    playedAt: String,
    value: Option[Double],
) derives Codec.AsObject
object TrendPointResponse:
  given Schema[TrendPointResponse] = Schema.derived

final case class SeriesComparisonHistogramsResponse(
    assets: HistogramResponse,
    revenue: HistogramResponse,
) derives Codec.AsObject
object SeriesComparisonHistogramsResponse:
  given Schema[SeriesComparisonHistogramsResponse] = Schema.derived

final case class HistogramResponse(
    bins: List[HistogramBinResponse],
    series: List[HistogramSeriesResponse],
) derives Codec.AsObject
object HistogramResponse:
  given Schema[HistogramResponse] = Schema.derived

final case class HistogramBinResponse(
    index: Int,
    lowerInclusive: Int,
    upperExclusive: Option[Int],
    label: String,
) derives Codec.AsObject
object HistogramBinResponse:
  given Schema[HistogramBinResponse] = Schema.derived

final case class HistogramSeriesResponse(memberId: String, counts: List[Int]) derives Codec.AsObject
object HistogramSeriesResponse:
  given Schema[HistogramSeriesResponse] = Schema.derived

final case class HeadToHeadResponse(entries: List[HeadToHeadEntryResponse]) derives Codec.AsObject
object HeadToHeadResponse:
  given Schema[HeadToHeadResponse] = Schema.derived

final case class HeadToHeadEntryResponse(
    subjectMemberId: String,
    opponentMemberId: String,
    matchCount: Int,
    betterRankCount: Int,
    betterRankRate: Option[Double],
    averageRankDiff: Option[Double],
    averageAssetsDiff: Option[Double],
    status: String,
) derives Codec.AsObject
object HeadToHeadEntryResponse:
  given Schema[HeadToHeadEntryResponse] = Schema.derived

final case class MatchPlayerPointResponse(
    matchIndex: Int,
    matchId: String,
    playedAt: String,
    memberId: String,
    rank: Int,
    totalAssets: Int,
    revenue: Int,
    revenueAssetRate: Option[Double],
    assetsRank: Double,
    revenueRank: Double,
) derives Codec.AsObject
object MatchPlayerPointResponse:
  given Schema[MatchPlayerPointResponse] = Schema.derived

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
