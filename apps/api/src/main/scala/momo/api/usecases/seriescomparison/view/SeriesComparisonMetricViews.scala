package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonScopeView(
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
final case class SeriesComparisonPlayerView(memberId: String, displayName: String)

final case class SeriesComparisonPlayerMetricsEntry(
    memberId: String,
    metrics: SeriesComparisonPlayerMetricsView,
)
final case class SeriesComparisonPlayerMetricsView(
    denominator: Int,
    rank: RankMetricsView,
    assets: MoneyDistributionMetricsView,
    revenue: RevenueDistributionMetricsView,
    podium: RateCountMetricsView,
    lowerHalf: RateCountMetricsView,
    playOrder: PlayOrderMetricsView,
    ginji: GinjiMetricsView,
    nonRevenue: NonRevenueMetricsView,
    destination: DestinationMetricsView,
    revenueOutcome: RevenueOutcomeMetricsView,
    destinationOutcome: DestinationOutcomeMetricsView,
    stability: StabilityMetricsView,
)
final case class RankMetricsView(
    average: Option[Double],
    distribution: List[RankDistributionView],
    standardDeviation: Option[Double],
)
final case class RankDistributionView(rank: Int, count: Int, rate: Option[Double])

final case class MoneyDistributionMetricsView(
    max: Option[Int],
    min: Option[Int],
    average: Option[Double],
    median: Option[Double],
)
final case class RevenueDistributionMetricsView(
    max: Option[Int],
    average: Option[Double],
    median: Option[Double],
)
final case class RateCountMetricsView(count: Int, rate: Option[Double])
final case class PlayOrderMetricsView(
    assetsDiff: Option[Double],
    revenueDiff: Option[Double],
    assetsIndex: Option[Double],
    revenueIndex: Option[Double],
    breakdown: List[PlayOrderBreakdownView],
)
final case class PlayOrderBreakdownView(
    playOrder: Int,
    matchCount: Int,
    rankAverage: Option[Double],
    assetsAverage: Option[Double],
    revenueAverage: Option[Double],
)
final case class GinjiMetricsView(
    count: Int,
    encounterMatches: Int,
    encounterRate: Option[Double],
    multiEncounterMatchCount: Int,
    maxInSingleMatch: Int,
    resilienceRankAverage: Option[Double],
    resilienceAssetsAverage: Option[Double],
    resilienceRevenueAverage: Option[Double],
)
final case class NonRevenueMetricsView(
    rankDelta: Option[Double],
    highRevenueNoWinCount: Int,
    highRevenueTopCount: Int,
    highRevenueNoWinRate: Option[Double],
)
final case class DestinationMetricsView(
    conversionDelta: Option[Double],
    dependenceScore: Option[Double],
    upperTargetCount: Int,
    lowerTargetCount: Int,
)
final case class ConditionalRankOutcomeView(
    targetCount: Int,
    winCount: Int,
    winRate: Option[Double],
    podiumCount: Int,
    podiumRate: Option[Double],
    lowerHalfCount: Int,
    lowerHalfRate: Option[Double],
    rankDistribution: List[RankDistributionView],
    status: String,
)
final case class RevenueOutcomeMetricsView(
    top: ConditionalRankOutcomeView,
    lowRevenue: ConditionalRankOutcomeView,
    nonTopWinCount: Int,
)
final case class DestinationOutcomeMetricsView(
    top: ConditionalRankOutcomeView,
    lowDestination: ConditionalRankOutcomeView,
    zeroDestination: ConditionalRankOutcomeView,
)
final case class CardShopDestinationView(entries: List[CardShopDestinationPlayerView])

final case class CardShopDestinationPlayerView(
    memberId: String,
    denominator: Int,
    cardShopMatchCount: Int,
    cardShopRate: Option[Double],
    cardShopWithoutDestinationCount: Int,
    cardShopWithoutDestinationRate: Option[Double],
    quadrants: List[CardShopDestinationQuadrantView],
)
final case class CardShopDestinationQuadrantView(
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
final case class StabilityMetricsView(rankStandardDeviation: Option[Double])
