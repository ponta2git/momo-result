package momo.api.usecases.seriescomparison

import cats.syntax.all.*

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationPlayerProfileSupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def playerPerformanceProfiles(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      metrics: Map[String, SeriesComparisonPlayerMetricsView],
  ): PlayerPerformanceProfilesView =
    val entriesBase = playerOrder.map { memberId =>
      val rows = rowsByPlayer.getOrElse(memberId, Nil)
      val rankScore = average(rows.map(row => asDecimal(5 - row.rank.value)))
      val revenueAssetRates = rows.flatMap(revenueAssetRate)
      val m = metrics.get(memberId.value)
      ProfileBase(
        memberId = memberId,
        rankStandardDeviation = m.flatMap(_.stability.rankStandardDeviation),
        podiumRate = m.flatMap(_.podium.rate),
        averageRankScore = rankScore,
        averageRevenueAssetRate = average(revenueAssetRates),
        status = normalStatus(rows.size),
      )
    }
    val riskMedian = medianDouble(entriesBase.flatMap(_.rankStandardDeviation))
    val returnMedian = medianDouble(entriesBase.flatMap(_.averageRankScore))
    val revenueAssetRateMedian = medianDouble(entriesBase.flatMap(_.averageRevenueAssetRate))
    PlayerPerformanceProfilesView(
      rankStandardDeviationMedian = riskMedian,
      averageRankScoreMedian = returnMedian,
      averageRevenueAssetRateMedian = revenueAssetRateMedian,
      entries = entriesBase.map { entry =>
        val kind = (entry.rankStandardDeviation, entry.averageRankScore, riskMedian, returnMedian)
          .mapN { (x, y, xMedian, yMedian) =>
            if x <= xMedian && y >= yMedian then "steady_leader"
            else if x > xMedian && y >= yMedian then "swing_leader"
            else if x <= xMedian && y < yMedian then "steady_chaser"
            else "swing_chaser"
          }
        PlayerPerformanceProfileView(
          memberId = entry.memberId.value,
          rankStandardDeviation = entry.rankStandardDeviation,
          podiumRate = entry.podiumRate,
          averageRankScore = entry.averageRankScore,
          averageRevenueAssetRate = entry.averageRevenueAssetRate,
          profileKind = kind,
          strategyKind = strategyKind(entry, entriesBase),
          status = entry.status,
        )
      },
    )

  protected final case class ProfileBase(
      memberId: MemberId,
      rankStandardDeviation: Option[Double],
      podiumRate: Option[Double],
      averageRankScore: Option[Double],
      averageRevenueAssetRate: Option[Double],
      status: String,
  )

  protected final def strategyKind(entry: ProfileBase, entries: List[ProfileBase]): Option[String] =
    val rates = entries.flatMap(_.averageRevenueAssetRate)
    for
      median <- medianDouble(rates)
      value <- entry.averageRevenueAssetRate
    yield {
      if rates.size < Thresholds.MinimumOkSampleSize then "balanced"
      else if value >= median + Thresholds.StrategyKindMedianDeltaThreshold then "property_focused"
      else if value <= median - Thresholds.StrategyKindMedianDeltaThreshold then "card_focused"
      else "balanced"
    }
