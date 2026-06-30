package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationQualitySupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def dataQuality(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): SeriesComparisonDataQualityView =
    val items = playerOrder.flatMap { memberId =>
      val rows = rowsByPlayer.getOrElse(memberId, Nil)
      val denominator = rows.size
      val ginjiTarget = rows.count(_.incidents.suriNoGinji >= 1)
      val maxRevenueByMatch = allRows.groupBy(_.matchId).view
        .mapValues(rs => rs.map(_.revenueManYen.value).max).toMap
      val highRevenueTarget = rows
        .count(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value))
      val destinationMetric = destinationMetrics(rows, destinationRanks)
      val revenueOutcome = revenueOutcomeMetrics(rows, allRows, revenueRanks)
      val destinationOutcome = destinationOutcomeMetrics(rows, allRows, destinationRanks)
      val momentumTargetCounts = momentumSwitchTargetCounts(rows)
      val cardShopDestinationCounts = Map(
        "cardShopDestination.destinationWithShop" ->
          rows.count(row => row.incidents.destination > 0 && row.incidents.cardShop > 0),
        "cardShopDestination.destinationWithoutShop" ->
          rows.count(row => row.incidents.destination > 0 && row.incidents.cardShop == 0),
        "cardShopDestination.noDestinationWithShop" ->
          rows.count(row => row.incidents.destination == 0 && row.incidents.cardShop > 0),
        "cardShopDestination.noDestinationWithoutShop" ->
          rows.count(row => row.incidents.destination == 0 && row.incidents.cardShop == 0),
      )
      val normal = DenominatorMetricIds.map(metricId =>
        MetricQualityView(
          metricId,
          Some(memberId.value),
          denominator,
          denominator,
          normalStatus(denominator),
          hasTies = metricHasTies(metricId, revenueRanks, destinationRanks),
        )
      )
      val conditionalCounts = Map(
        "ginji.resilienceRankAverage" -> ginjiTarget,
        "ginji.resilienceAssetsAverage" -> ginjiTarget,
        "ginji.resilienceRevenueAverage" -> ginjiTarget,
        "nonRevenue.highRevenueNoWinRate" -> highRevenueTarget,
        "destination.dependenceScore" ->
          math.min(destinationMetric.upperTargetCount, destinationMetric.lowerTargetCount),
        "revenueOutcome.topWinRate" -> revenueOutcome.top.targetCount,
        "revenueOutcome.topPodiumRate" -> revenueOutcome.top.targetCount,
        "revenueOutcome.topLowerHalfRate" -> revenueOutcome.top.targetCount,
        "revenueOutcome.lowRevenuePodiumRate" -> revenueOutcome.lowRevenue.targetCount,
        "destinationOutcome.topWinRate" -> destinationOutcome.top.targetCount,
        "destinationOutcome.topPodiumRate" -> destinationOutcome.top.targetCount,
        "destinationOutcome.topLowerHalfRate" -> destinationOutcome.top.targetCount,
        "destinationOutcome.lowDestinationPodiumRate" ->
          destinationOutcome.lowDestination.targetCount,
        "destinationOutcome.zeroDestinationPodiumRate" ->
          destinationOutcome.zeroDestination.targetCount,
      ) ++ cardShopDestinationCounts
      val conditional = ConditionalMetricIds.map { metricId =>
        val target = conditionalCounts.getOrElse(metricId, 0)
        MetricQualityView(
          metricId,
          Some(memberId.value),
          denominator,
          target,
          conditionalStatus(target),
          hasTies = metricHasTies(metricId, revenueRanks, destinationRanks),
        )
      }
      val momentumSwitch = MomentumSwitchMetricIds.map { metricId =>
        val target = momentumTargetCounts.getOrElse(metricId, 0)
        MetricQualityView(
          metricId,
          Some(memberId.value),
          denominator,
          target,
          momentumSwitchStatus(target),
          hasTies = false,
        )
      }
      normal ++ conditional ++ momentumSwitch
    }
    SeriesComparisonDataQualityView(items)

  protected final def momentumSwitchTargetCounts(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): Map[String, Int] =
    val transitions = rankTransitions(sortedPlayerRows(rows))
    Map(
      "momentumSwitch.afterLowerPodiumRate" -> transitions.count(_.previous.rank.value >= 3),
      "momentumSwitch.afterFourthPodiumRate" -> transitions.count(_.previous.rank.value == 4),
      "momentumSwitch.afterPodiumLowerRate" -> transitions.count(_.previous.rank.value <= 2),
    )

  protected final def highlights(
      metrics: Map[String, SeriesComparisonPlayerMetricsView]
  ): List[SeriesComparisonHighlightView] = List(
    highlightMin(
      "highlight.ginjiResilience",
      "銀次リカバリー王",
      "ginji.resilienceRankAverage",
      metrics,
      _.ginji.resilienceRankAverage,
      _.ginji.encounterMatches,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.highRevenueNoWin",
      "収益空振り注意報",
      "nonRevenue.highRevenueNoWinRate",
      metrics,
      _.nonRevenue.highRevenueNoWinRate,
      _.nonRevenue.highRevenueTopCount,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.destinationCraft",
      "目的地職人",
      "destination.dependenceScore",
      metrics,
      _.destination.dependenceScore,
      m => math.min(m.destination.upperTargetCount, m.destination.lowerTargetCount),
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.destinationIndependent",
      "寄り道勝ち筋",
      "destination.conversionDelta",
      metrics,
      _.destination.conversionDelta,
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.assetsPeak",
      "資産ピーク王",
      "assets.max",
      metrics,
      _.assets.max.map(asDecimal),
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.revenuePeak",
      "収益爆発王",
      "revenue.max",
      metrics,
      _.revenue.max.map(asDecimal),
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMin(
      "highlight.stability",
      "安定社長",
      "stability.rankStandardDeviation",
      metrics,
      _.stability.rankStandardDeviation,
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
  ).flatten

  protected final def highlightMax(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsView],
      value: SeriesComparisonPlayerMetricsView => Option[Double],
      target: SeriesComparisonPlayerMetricsView => Int,
      requireTarget: Int,
  ): Option[SeriesComparisonHighlightView] =
    highlight(id, title, metricId, metrics, value, target, requireTarget, chooseMax = true)

  protected final def highlightMin(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsView],
      value: SeriesComparisonPlayerMetricsView => Option[Double],
      target: SeriesComparisonPlayerMetricsView => Int,
      requireTarget: Int,
  ): Option[SeriesComparisonHighlightView] =
    highlight(id, title, metricId, metrics, value, target, requireTarget, chooseMax = false)

  protected final def highlight(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsView],
      value: SeriesComparisonPlayerMetricsView => Option[Double],
      target: SeriesComparisonPlayerMetricsView => Int,
      requireTarget: Int,
      chooseMax: Boolean,
  ): Option[SeriesComparisonHighlightView] =
    val candidates = metrics.toList.flatMap { case (memberId, m) =>
      value(m).filter(_ => target(m) >= requireTarget).map(v => (memberId, v, target(m)))
    }
    if candidates.isEmpty then None
    else
      val bestValue = if chooseMax then candidates.map(_._2).max else candidates.map(_._2).min
      val winners = candidates.filter(_._2 == bestValue)
      Some(SeriesComparisonHighlightView(
        id = id,
        title = title,
        winnerMemberIds = winners.map(_._1),
        metricId = metricId,
        value = Some(bestValue),
        targetCount = winners.map(_._3).min,
        status = "ok",
      ))
