package momo.api.usecases.seriescomparison

import cats.syntax.all.*

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationMetricsSupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def playerMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): SeriesComparisonPlayerMetricsView =
    val denominator = rows.size
    val ranks = rows.map(_.rank.value)
    val assets = rows.map(_.totalAssetsManYen.value)
    val revenue = rows.map(_.revenueManYen.value)
    val podiumCount = ranks.count(r => r == 1 || r == 2)
    val lowerHalfCount = ranks.count(r => r == 3 || r == 4)
    val ginjiRows = rows.filter(_.incidents.suriNoGinji >= 1)
    val highRevenue = highRevenueNoWin(rows, allRows, revenueRanks)
    val destination = destinationMetrics(rows, destinationRanks)
    val revenueOutcome = revenueOutcomeMetrics(rows, allRows, revenueRanks)
    val destinationOutcome = destinationOutcomeMetrics(rows, allRows, destinationRanks)
    SeriesComparisonPlayerMetricsView(
      denominator = denominator,
      rank = RankMetricsView(
        average = average(ranks.map(asDecimal)),
        distribution = (1 to 4).toList.map { rank =>
          val count = ranks.count(_ == rank)
          RankDistributionView(rank, count, rate(count, denominator))
        },
        standardDeviation = stddev(ranks.map(asDecimal)),
      ),
      assets = MoneyDistributionMetricsView(
        max = assets.maxOption,
        min = assets.minOption,
        average = average(assets.map(asDecimal)),
        median = median(assets),
      ),
      revenue = RevenueDistributionMetricsView(
        max = revenue.maxOption,
        average = average(revenue.map(asDecimal)),
        median = median(revenue),
      ),
      podium = RateCountMetricsView(podiumCount, rate(podiumCount, denominator)),
      lowerHalf = RateCountMetricsView(lowerHalfCount, rate(lowerHalfCount, denominator)),
      playOrder = playOrderMetrics(rows, allRows),
      ginji = GinjiMetricsView(
        count = rows.map(_.incidents.suriNoGinji).sum,
        encounterMatches = ginjiRows.size,
        encounterRate = rate(ginjiRows.size, denominator),
        multiEncounterMatchCount = rows.count(_.incidents.suriNoGinji >= 2),
        maxInSingleMatch = rows.map(_.incidents.suriNoGinji).maxOption.getOrElse(0),
        resilienceRankAverage = average(ginjiRows.map(row => asDecimal(row.rank.value))),
        resilienceAssetsAverage =
          average(ginjiRows.map(row => asDecimal(row.totalAssetsManYen.value))),
        resilienceRevenueAverage =
          average(ginjiRows.map(row => asDecimal(row.revenueManYen.value))),
      ),
      nonRevenue = highRevenue,
      destination = destination,
      revenueOutcome = revenueOutcome,
      destinationOutcome = destinationOutcome,
      stability = StabilityMetricsView(stddev(ranks.map(asDecimal))),
    )

  protected final def playOrderMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): PlayOrderMetricsView =
    def baseline(value: SeriesComparisonMatchPlayerRow => Double): Map[Int, Double] = allRows
      .groupBy(_.playOrder.value).view.mapValues(rs => averageUnsafe(rs.map(value))).toMap
    def diff(value: SeriesComparisonMatchPlayerRow => Double): Option[Double] =
      val base = baseline(value)
      average(rows.flatMap(row => base.get(row.playOrder.value).map(b => value(row) - b)))
    def index(value: SeriesComparisonMatchPlayerRow => Double): Option[Double] =
      val base = baseline(value)
      val values = rows.flatMap { row =>
        base.get(row.playOrder.value).filter(b => b > 0.0 && math.abs(b) >= 1e-9)
          .map(b => value(row) / b)
      }
      if values.size == rows.size then average(values) else None
    PlayOrderMetricsView(
      assetsDiff = diff(row => asDecimal(row.totalAssetsManYen.value)),
      revenueDiff = diff(row => asDecimal(row.revenueManYen.value)),
      assetsIndex = index(row => asDecimal(row.totalAssetsManYen.value)),
      revenueIndex = index(row => asDecimal(row.revenueManYen.value)),
      breakdown = playOrderBreakdown(rows),
    )

  protected final def playOrderBreakdown(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[PlayOrderBreakdownView] = (1 to 4).toList.map { playOrder =>
    val targetRows = rows.filter(_.playOrder.value == playOrder)
    PlayOrderBreakdownView(
      playOrder = playOrder,
      matchCount = targetRows.size,
      rankAverage = average(targetRows.map(row => asDecimal(row.rank.value))),
      assetsAverage = average(targetRows.map(row => asDecimal(row.totalAssetsManYen.value))),
      revenueAverage = average(targetRows.map(row => asDecimal(row.revenueManYen.value))),
    )
  }

  protected final def playOrderBaselines(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[PlayOrderBaselineView] =
    if rows.isEmpty then Nil
    else
      (1 to 4).toList.map { playOrder =>
        val targetRows = rows.filter(_.playOrder.value == playOrder)
        PlayOrderBaselineView(
          playOrder = playOrder,
          assetsAverage = average(targetRows.map(row => asDecimal(row.totalAssetsManYen.value))),
          revenueAverage = average(targetRows.map(row => asDecimal(row.revenueManYen.value))),
          matchCount = targetRows.size,
        )
      }

  protected final def highRevenueNoWin(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
  ): NonRevenueMetricsView =
    val revenueRankValues = rows.flatMap(row => revenueRanks.get(rankKey(row)))
    val rankDelta =
      for
        avgRevenueRank <- average(revenueRankValues)
        avgRank <- average(rows.map(row => asDecimal(row.rank.value)))
      yield avgRevenueRank - avgRank
    val maxRevenueByMatch = allRows.groupBy(_.matchId).view
      .mapValues(rs => rs.map(_.revenueManYen.value).max).toMap
    val topRows = rows
      .filter(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value))
    val noWin = topRows.count(_.rank.value != 1)
    NonRevenueMetricsView(
      rankDelta = rankDelta,
      highRevenueNoWinCount = noWin,
      highRevenueTopCount = topRows.size,
      highRevenueNoWinRate = rate(noWin, topRows.size),
    )

  protected final def destinationMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      destinationRanks: Map[(String, String), Double],
  ): DestinationMetricsView =
    val destinationRankValues = rows.flatMap(row => destinationRanks.get(rankKey(row)))
    val conversion =
      for
        avgDestinationRank <- average(destinationRankValues)
        avgRank <- average(rows.map(row => asDecimal(row.rank.value)))
      yield avgDestinationRank - avgRank
    val rankedRows = rows.flatMap(row => destinationRanks.get(rankKey(row)).map(_ -> row))
    val upper = rankedRows.collect { case (r, row) if r < 2.5 => asDecimal(5 - row.rank.value) }
    val lower = rankedRows.collect { case (r, row) if r > 2.5 => asDecimal(5 - row.rank.value) }
    DestinationMetricsView(
      conversionDelta = conversion,
      dependenceScore = (average(upper), average(lower)).mapN(_ - _),
      upperTargetCount = upper.size,
      lowerTargetCount = lower.size,
    )

  protected final def revenueOutcomeMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
  ): RevenueOutcomeMetricsView =
    val maxRevenueByMatch = allRows.groupBy(_.matchId).view
      .mapValues(rs => rs.map(_.revenueManYen.value).max).toMap
    val topRows = rows
      .filter(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value))
    val lowRevenueRows = rows.filter(row => revenueRanks.get(rankKey(row)).exists(_ > 2.5))
    RevenueOutcomeMetricsView(
      top = conditionalRankOutcome(topRows),
      lowRevenue = conditionalRankOutcome(lowRevenueRows),
      nonTopWinCount = rows.count(row =>
        row.rank.value == 1 && !maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value)
      ),
    )

  protected final def destinationOutcomeMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      destinationRanks: Map[(String, String), Double],
  ): DestinationOutcomeMetricsView =
    val maxDestinationByMatch = allRows.groupBy(_.matchId).view
      .mapValues(rs => rs.map(_.incidents.destination).max).toMap
    val topRows = rows.filter(row =>
      maxDestinationByMatch.get(row.matchId)
        .exists(value => value > 0 && row.incidents.destination == value)
    )
    val lowDestinationRows = rows.filter(row => destinationRanks.get(rankKey(row)).exists(_ > 2.5))
    val zeroDestinationRows = rows.filter(_.incidents.destination == 0)
    DestinationOutcomeMetricsView(
      top = conditionalRankOutcome(topRows),
      lowDestination = conditionalRankOutcome(lowDestinationRows),
      zeroDestination = conditionalRankOutcome(zeroDestinationRows),
    )

  protected final def conditionalRankOutcome(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): ConditionalRankOutcomeView =
    val targetCount = rows.size
    val winCount = rows.count(_.rank.value == 1)
    val podiumCount = rows.count(_.rank.value <= 2)
    val lowerHalfCount = rows.count(_.rank.value >= 3)
    ConditionalRankOutcomeView(
      targetCount = targetCount,
      winCount = winCount,
      winRate = rate(winCount, targetCount),
      podiumCount = podiumCount,
      podiumRate = rate(podiumCount, targetCount),
      lowerHalfCount = lowerHalfCount,
      lowerHalfRate = rate(lowerHalfCount, targetCount),
      rankDistribution = (1 to 4).toList.map { rank =>
        val count = rows.count(_.rank.value == rank)
        RankDistributionView(rank, count, rate(count, targetCount))
      },
      status = conditionalStatus(targetCount),
    )

