package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

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
