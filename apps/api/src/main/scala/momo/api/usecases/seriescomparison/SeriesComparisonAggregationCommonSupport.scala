package momo.api.usecases.seriescomparison

import java.time.format.DateTimeFormatter

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.SeriesComparisonRankSpreadSignalView

private[seriescomparison] trait SeriesComparisonAggregationCommonSupport:

  protected object Thresholds:
    val MinimumOkSampleSize = 3
    val MomentumSwitchMinimumOkSampleSize = 8
    val SemanticMatureSampleSize = 50
    val HeadToHeadReferenceMaxSampleSize = 2
    val AverageRankSpreadEarlyFlatBelow = 0.2
    val AverageRankSpreadEarlySmallBelow = 0.35
    val AverageRankSpreadEarlyLargeFrom = 0.6
    val AverageRankSpreadMatureFlatBelow = 0.15
    val AverageRankSpreadMatureSmallBelow = 0.25
    val AverageRankSpreadMatureLargeFrom = 0.5
    val HeadToHeadEarlySlightAdvantageFrom = 0.55
    val HeadToHeadEarlyStrongAdvantageFrom = 0.65
    val HeadToHeadEarlySlightDisadvantageTo = 0.45
    val HeadToHeadEarlyStrongDisadvantageTo = 0.35
    val HeadToHeadMatureSlightAdvantageFrom = 0.52
    val HeadToHeadMatureStrongAdvantageFrom = 0.6
    val HeadToHeadMatureSlightDisadvantageTo = 0.48
    val HeadToHeadMatureStrongDisadvantageTo = 0.4
    val HeadToHeadMatureRankDiffSlightFrom = 0.15
    val HeadToHeadMatureRankDiffStrongFrom = 0.25
    val MomentumSwitchAfterLowerDelta = 0.06
    val MomentumSwitchAfterFourthDelta = 0.1
    val MomentumSwitchAfterPodiumDelta = 0.06
    val RecentFormWindowSize = 8
    val HistogramLowerPercentile = 0.05
    val HistogramUpperPercentile = 0.95
    val HistogramTargetBinCount = 6
    val StrategyKindMedianDeltaThreshold = 0.0035
    val TimelineCloseFinishPercentile = 0.25
    val TimelineAssetBlowoutPercentile = 0.75
    val TimelineGinjiStormMinCount = 2
    val AssetStyleLowAssetPercentile = 0.10
    val AssetStyleHighAssetPercentile = 0.90
    val AssetStyleBlowoutWinPercentile = 0.75
    val AssetStyleNearMissSecondPercentile = 0.25
    val AssetStyleHeavyLossPercentile = 0.75
    val AssetStyleRateSignalDelta = 0.015
    val AssetStyleLowRiskRateDelta = 0.025
    val AssetStyleSecondRateDelta = 0.07
    val AssetStyleDestinationAverageDelta = 0.08
    val AssetStyleWinMedianAssetsDelta = 10000.0
    val AssetStyleWinMarginDelta = 3000.0
    val AssetStyleLowerGapDelta = 4000.0
    val AssetStyleBlowoutWinRateDelta = 0.025

  protected val Formatter = DateTimeFormatter.ISO_INSTANT
  protected val DenominatorMetricIds = List(
    "rank.average",
    "rank.distribution",
    "assets.max",
    "assets.min",
    "assets.average",
    "assets.median",
    "assets.histogram",
    "revenue.max",
    "revenue.average",
    "revenue.median",
    "revenue.histogram",
    "podium.rate",
    "lowerHalf.rate",
    "playOrder.assetsDiff",
    "playOrder.revenueDiff",
    "playOrder.assetsIndex",
    "playOrder.revenueIndex",
    "ginji.count",
    "ginji.encounterRate",
    "ginji.multiEncounterMatchCount",
    "ginji.maxInSingleMatch",
    "nonRevenue.rankDelta",
    "destination.conversionDelta",
    "stability.rankStandardDeviation",
    "recentForm.averageRank",
    "recentForm.podiumRate",
    "playerPerformanceProfiles.averageRankScore",
    "playerPerformanceProfiles.averageRevenueAssetRate",
    "assetStyleProfiles.primaryKind",
    "assetStyleProfiles.highAssetRate",
    "assetStyleProfiles.lowAssetRate",
    "assetStyleProfiles.winMedianMargin",
    "matchNoInEventBreakdown.averageRank",
    "matchNoInEventBreakdown.podiumRate",
  )
  protected val ConditionalMetricIds = List(
    "ginji.resilienceRankAverage",
    "ginji.resilienceAssetsAverage",
    "ginji.resilienceRevenueAverage",
    "nonRevenue.highRevenueNoWinRate",
    "destination.dependenceScore",
    "revenueOutcome.topWinRate",
    "revenueOutcome.topPodiumRate",
    "revenueOutcome.topLowerHalfRate",
    "revenueOutcome.lowRevenuePodiumRate",
    "destinationOutcome.topWinRate",
    "destinationOutcome.topPodiumRate",
    "destinationOutcome.topLowerHalfRate",
    "destinationOutcome.lowDestinationPodiumRate",
    "destinationOutcome.zeroDestinationPodiumRate",
    "cardShopDestination.destinationWithShop",
    "cardShopDestination.destinationWithoutShop",
    "cardShopDestination.noDestinationWithShop",
    "cardShopDestination.noDestinationWithoutShop",
  )
  protected val MomentumSwitchMetricIds = List(
    "momentumSwitch.afterLowerPodiumRate",
    "momentumSwitch.afterFourthPodiumRate",
    "momentumSwitch.afterPodiumLowerRate",
  )
  protected val HistogramConfig = SeriesComparisonHistogram.Config(
    lowerPercentile = Thresholds.HistogramLowerPercentile,
    upperPercentile = Thresholds.HistogramUpperPercentile,
    targetBinCount = Thresholds.HistogramTargetBinCount,
  )

  protected final case class MatchGroup(
      matchIndex: Int,
      rows: List[SeriesComparisonMatchPlayerRow]
  ):
    val matchId: momo.api.domain.ids.MatchId = rows.head.matchId
    val playedAt: java.time.Instant = rows.head.playedAt

  protected final def groupSortKey(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): (Long, String, Int, String) =
    val first = rows.head
    (
      first.playedAt.toEpochMilli,
      first.heldEventId.value,
      first.matchNoInEvent.value,
      first.matchId.value,
    )

  protected final def rankByMatch(
      rows: List[SeriesComparisonMatchPlayerRow],
      value: SeriesComparisonMatchPlayerRow => Int,
  ): Map[(String, String), Double] = rows.groupBy(_.matchId).values.flatMap { matchRows =>
    val sortedValues = matchRows.map(value).distinct.sorted(using Ordering.Int.reverse)
    val ranksByValue = sortedValues.map { v =>
      val positions = matchRows.sortBy(row => -value(row)).zipWithIndex
        .collect { case (row, idx) if value(row) == v => idx + 1 }
      v -> averageUnsafe(positions.map(asDecimal))
    }.toMap
    matchRows.map(row => rankKey(row) -> ranksByValue(value(row)))
  }.toMap

  protected final def rankKey(row: SeriesComparisonMatchPlayerRow): (String, String) =
    (row.matchId.value, row.memberId.value)

  protected final def average(values: List[Double]): Option[Double] = values match
    case Nil => None
    case nonEmpty => Some(averageUnsafe(nonEmpty))

  protected final def averageUnsafe(values: List[Double]): Double = values.sum /
    asDecimal(values.size)

  protected final def median(values: List[Int]): Option[Double] = values.sorted match
    case Nil => None
    case sorted if sorted.size % 2 == 1 => Some(asDecimal(sorted(sorted.size / 2)))
    case sorted =>
      val upper = sorted.size / 2
      Some((asDecimal(sorted(upper - 1)) + asDecimal(sorted(upper))) / 2.0)

  protected final def stddev(values: List[Double]): Option[Double] = values match
    case Nil => None
    case nonEmpty =>
      val avg = averageUnsafe(nonEmpty)
      Some(math.sqrt(nonEmpty.map(v => math.pow(v - avg, 2)).sum / asDecimal(nonEmpty.size)))

  protected final def rate(count: Int, denominator: Int): Option[Double] = Option
    .when(denominator > 0)(asDecimal(count) / asDecimal(denominator))

  protected final def sampleMaturity(targetCount: Int): String =
    if targetCount >= Thresholds.SemanticMatureSampleSize then "mature" else "early"

  protected final def rankSpreadSignal(
      averageRanks: Iterable[Option[Double]],
      matchCount: Int,
  ): SeriesComparisonRankSpreadSignalView =
    val values = averageRanks.flatten.toList
    if values.size < 2 then SeriesComparisonRankSpreadSignalView("insufficient", None)
    else
      val spread = values.max - values.min
      val bands = averageRankSpreadBands(matchCount)
      val signal =
        if spread < bands.flatBelow then "flat"
        else if spread < bands.smallBelow then "small"
        else if spread < bands.largeFrom then "visible"
        else "large"
      SeriesComparisonRankSpreadSignalView(signal = signal, spread = Some(spread))

  protected final def headToHeadSignal(
      matchCount: Int,
      betterRankRate: Option[Double],
      averageRankDiff: Option[Double],
      status: String,
  ): String =
    if status == "self" then "self"
    else if matchCount == 0 then "no_target"
    else if matchCount <= Thresholds.HeadToHeadReferenceMaxSampleSize then "reference"
    else
      val bands = headToHeadBands(matchCount)
      betterRankRate match
        case Some(value) if value >= bands.strongAdvantageFrom => "strong_advantage"
        case Some(value) if value >= bands.slightAdvantageFrom => "slight_advantage"
        case Some(value) if value <= bands.strongDisadvantageTo => "strong_disadvantage"
        case Some(value) if value <= bands.slightDisadvantageTo => "slight_disadvantage"
        case _ =>
          headToHeadRankDiffSignal(averageRankDiff, matchCount).getOrElse("neutral")

  protected final def momentumSwitchSignal(
      kind: String,
      deltaFromBaseline: Option[Double],
      status: String,
  ): String =
    if status != "ok" then "none"
    else
      deltaFromBaseline match
        case Some(delta) if kind == "afterPodium" =>
          val threshold = Thresholds.MomentumSwitchAfterPodiumDelta
          if delta <= -threshold then "strength"
          else if delta >= threshold then "risk"
          else "none"
        case Some(delta) =>
          val threshold =
            if kind == "afterFourth" then Thresholds.MomentumSwitchAfterFourthDelta
            else Thresholds.MomentumSwitchAfterLowerDelta
          if delta >= threshold then "strength"
          else if delta <= -threshold then "risk"
          else "none"
        case None => "none"

  protected final def revenueAssetRate(row: SeriesComparisonMatchPlayerRow): Option[Double] =
    Option.when(
      row.totalAssetsManYen.value > 0
    )(asDecimal(row.revenueManYen.value) / asDecimal(row.totalAssetsManYen.value))

  protected final def asDecimal(value: Int): Double = java.lang.Integer.valueOf(value).doubleValue()

  private final case class AverageRankSpreadBands(
      flatBelow: Double,
      smallBelow: Double,
      largeFrom: Double,
  )

  private final case class HeadToHeadBands(
      slightAdvantageFrom: Double,
      strongAdvantageFrom: Double,
      slightDisadvantageTo: Double,
      strongDisadvantageTo: Double,
  )

  private def averageRankSpreadBands(matchCount: Int): AverageRankSpreadBands =
    if sampleMaturity(matchCount) == "mature" then
      AverageRankSpreadBands(
        flatBelow = Thresholds.AverageRankSpreadMatureFlatBelow,
        smallBelow = Thresholds.AverageRankSpreadMatureSmallBelow,
        largeFrom = Thresholds.AverageRankSpreadMatureLargeFrom,
      )
    else
      AverageRankSpreadBands(
        flatBelow = Thresholds.AverageRankSpreadEarlyFlatBelow,
        smallBelow = Thresholds.AverageRankSpreadEarlySmallBelow,
        largeFrom = Thresholds.AverageRankSpreadEarlyLargeFrom,
      )

  private def headToHeadBands(matchCount: Int): HeadToHeadBands =
    if sampleMaturity(matchCount) == "mature" then
      HeadToHeadBands(
        slightAdvantageFrom = Thresholds.HeadToHeadMatureSlightAdvantageFrom,
        strongAdvantageFrom = Thresholds.HeadToHeadMatureStrongAdvantageFrom,
        slightDisadvantageTo = Thresholds.HeadToHeadMatureSlightDisadvantageTo,
        strongDisadvantageTo = Thresholds.HeadToHeadMatureStrongDisadvantageTo,
      )
    else
      HeadToHeadBands(
        slightAdvantageFrom = Thresholds.HeadToHeadEarlySlightAdvantageFrom,
        strongAdvantageFrom = Thresholds.HeadToHeadEarlyStrongAdvantageFrom,
        slightDisadvantageTo = Thresholds.HeadToHeadEarlySlightDisadvantageTo,
        strongDisadvantageTo = Thresholds.HeadToHeadEarlyStrongDisadvantageTo,
      )

  private def headToHeadRankDiffSignal(
      averageRankDiff: Option[Double],
      matchCount: Int,
  ): Option[String] =
    if sampleMaturity(matchCount) != "mature" then None
    else
      averageRankDiff.flatMap { value =>
        val absoluteDiff = math.abs(value)
        if absoluteDiff >= Thresholds.HeadToHeadMatureRankDiffStrongFrom then
          Some(if value > 0 then "strong_advantage" else "strong_disadvantage")
        else if absoluteDiff >= Thresholds.HeadToHeadMatureRankDiffSlightFrom then
          Some(if value > 0 then "slight_advantage" else "slight_disadvantage")
        else None
      }

  protected final def normalStatus(denominator: Int): String =
    if denominator == 0 then "no_target"
    else if denominator < Thresholds.MinimumOkSampleSize then "reference"
    else "ok"

  protected final def conditionalStatus(targetCount: Int): String =
    if targetCount == 0 then "no_target"
    else if targetCount < Thresholds.MinimumOkSampleSize then "reference"
    else "ok"

  protected final def momentumSwitchStatus(targetCount: Int): String =
    if targetCount == 0 then "no_target"
    else if targetCount < Thresholds.MomentumSwitchMinimumOkSampleSize then "reference"
    else "ok"

  protected final def metricHasTies(
      metricId: String,
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): Boolean =
    if metricId.startsWith("nonRevenue") || metricId.startsWith("revenueOutcome") then
      revenueRanks.values.exists(v => v != math.rint(v))
    else if metricId.startsWith("destination") || metricId.startsWith("destinationOutcome") then
      destinationRanks.values.exists(v => v != math.rint(v))
    else false
