package momo.api.usecases.seriescomparison.model

final case class SeriesComparisonScopeResponse(
    gameTitleId: String,
    gameTitleName: String,
    layoutFamily: String,
    scopeKind: String,
    scopeId: Option[String],
    scopeName: String,
    seasonMasterId: Option[String] = None,
    seasonName: Option[String] = None,
    mapMasterId: Option[String] = None,
    mapName: Option[String] = None,
)
final case class SeriesComparisonPlayerResponse(memberId: String, displayName: String)

final case class SeriesComparisonPlayerMetricsEntry(
    memberId: String,
    metrics: SeriesComparisonPlayerMetricsResponse,
)
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
)
final case class RankMetricsResponse(
    average: Option[Double],
    distribution: List[RankDistributionResponse],
    standardDeviation: Option[Double],
)
final case class RankDistributionResponse(rank: Int, count: Int, rate: Option[Double])

final case class MoneyDistributionMetricsResponse(
    max: Option[Int],
    min: Option[Int],
    average: Option[Double],
    median: Option[Double],
)
final case class RevenueDistributionMetricsResponse(
    max: Option[Int],
    average: Option[Double],
    median: Option[Double],
)
final case class RateCountMetricsResponse(count: Int, rate: Option[Double])
final case class PlayOrderMetricsResponse(
    assetsDiff: Option[Double],
    revenueDiff: Option[Double],
    assetsIndex: Option[Double],
    revenueIndex: Option[Double],
    breakdown: List[PlayOrderBreakdownResponse],
)
final case class PlayOrderBreakdownResponse(
    playOrder: Int,
    matchCount: Int,
    rankAverage: Option[Double],
    assetsAverage: Option[Double],
    revenueAverage: Option[Double],
)
final case class GinjiMetricsResponse(
    count: Int,
    encounterMatches: Int,
    encounterRate: Option[Double],
    multiEncounterMatchCount: Int,
    maxInSingleMatch: Int,
    resilienceRankAverage: Option[Double],
    resilienceAssetsAverage: Option[Double],
    resilienceRevenueAverage: Option[Double],
)
final case class NonRevenueMetricsResponse(
    rankDelta: Option[Double],
    highRevenueNoWinCount: Int,
    highRevenueTopCount: Int,
    highRevenueNoWinRate: Option[Double],
)
final case class DestinationMetricsResponse(
    conversionDelta: Option[Double],
    dependenceScore: Option[Double],
    upperTargetCount: Int,
    lowerTargetCount: Int,
)
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
)
final case class RevenueOutcomeMetricsResponse(
    top: ConditionalRankOutcomeResponse,
    lowRevenue: ConditionalRankOutcomeResponse,
    nonTopWinCount: Int,
)
final case class DestinationOutcomeMetricsResponse(
    top: ConditionalRankOutcomeResponse,
    lowDestination: ConditionalRankOutcomeResponse,
    zeroDestination: ConditionalRankOutcomeResponse,
)
final case class CardShopDestinationResponse(entries: List[CardShopDestinationPlayerResponse])

final case class CardShopDestinationPlayerResponse(
    memberId: String,
    denominator: Int,
    cardShopMatchCount: Int,
    cardShopRate: Option[Double],
    cardShopWithoutDestinationCount: Int,
    cardShopWithoutDestinationRate: Option[Double],
    quadrants: List[CardShopDestinationQuadrantResponse],
)
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
)
final case class StabilityMetricsResponse(rankStandardDeviation: Option[Double])
