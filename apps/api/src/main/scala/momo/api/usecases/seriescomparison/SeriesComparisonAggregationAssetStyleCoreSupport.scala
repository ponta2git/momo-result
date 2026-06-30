package momo.api.usecases.seriescomparison

import cats.syntax.all.*

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationAssetStyleCoreSupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def assetStyleProfiles(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): AssetStyleProfilesView =
    val matchRows = allRows.groupBy(_.matchId)
    val firstAssetsByMatch = assetsByRank(matchRows, 1)
    val secondAssetsByMatch = assetsByRank(matchRows, 2)
    val lowAssetThreshold = percentileDouble(
      allRows.map(_.totalAssetsManYen.value).sorted,
      Thresholds.AssetStyleLowAssetPercentile,
    )
    val highAssetThreshold = percentileDouble(
      allRows.map(_.totalAssetsManYen.value).sorted,
      Thresholds.AssetStyleHighAssetPercentile,
    )
    val winMargins = allRows.flatMap(row =>
      Option.when(row.rank.value == 1)(
        row.totalAssetsManYen.value -
          secondAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value)
      )
    )
    val secondGaps = allRows.flatMap(row =>
      Option.when(row.rank.value == 2)(
        firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
          row.totalAssetsManYen.value
      )
    )
    val lowerGaps = allRows.flatMap(row =>
      Option.when(row.rank.value >= 3)(
        firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
          row.totalAssetsManYen.value
      )
    )
    val blowoutWinThreshold =
      percentileDouble(winMargins.sorted, Thresholds.AssetStyleBlowoutWinPercentile)
    val nearMissSecondThreshold =
      percentileDouble(secondGaps.sorted, Thresholds.AssetStyleNearMissSecondPercentile)
    val heavyLossThreshold =
      percentileDouble(lowerGaps.sorted, Thresholds.AssetStyleHeavyLossPercentile)
    val bases = playerOrder.map { memberId =>
      val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
      assetStyleBase(
        memberId,
        rows,
        firstAssetsByMatch,
        secondAssetsByMatch,
        lowAssetThreshold,
        highAssetThreshold,
        blowoutWinThreshold,
        nearMissSecondThreshold,
        heavyLossThreshold,
      )
    }
    val medians = assetStyleMedians(bases)
    AssetStyleProfilesView(
      lowAssetThreshold = lowAssetThreshold.map(value => math.round(value).toInt),
      highAssetThreshold = highAssetThreshold.map(value => math.round(value).toInt),
      blowoutWinThreshold = blowoutWinThreshold.map(value => math.round(value).toInt),
      nearMissSecondThreshold = nearMissSecondThreshold.map(value => math.round(value).toInt),
      heavyLossThreshold = heavyLossThreshold.map(value => math.round(value).toInt),
      entries = bases.map { base =>
        val shapeKind = assetStyleShapeKind(base, medians)
        val tags = assetStyleTags(base, medians, shapeKind)
        AssetStyleProfileView(
          memberId = base.memberId.value,
          targetCount = base.targetCount,
          primaryKind = assetStylePrimaryKind(base, medians),
          secondaryKind = tags.headOption,
          shapeKind = shapeKind,
          tags = tags,
          metrics = base.metrics,
          status = base.status,
        )
      },
    )

  protected final def assetsByRank(
      matchRows: Map[momo.api.domain.ids.MatchId, List[SeriesComparisonMatchPlayerRow]],
      rank: Int,
  ): Map[momo.api.domain.ids.MatchId, Int] = matchRows.view.flatMap { case (matchId, rows) =>
    rows.find(_.rank.value == rank).map(row => matchId -> row.totalAssetsManYen.value)
  }.toMap

  protected final def assetStyleBase(
      memberId: MemberId,
      rows: List[SeriesComparisonMatchPlayerRow],
      firstAssetsByMatch: Map[momo.api.domain.ids.MatchId, Int],
      secondAssetsByMatch: Map[momo.api.domain.ids.MatchId, Int],
      lowAssetThreshold: Option[Double],
      highAssetThreshold: Option[Double],
      blowoutWinThreshold: Option[Double],
      nearMissSecondThreshold: Option[Double],
      heavyLossThreshold: Option[Double],
  ): AssetStyleProfileBase =
    val targetCount = rows.size
    val assets = rows.map(_.totalAssetsManYen.value)
    val winRows = rows.filter(_.rank.value == 1)
    val secondRows = rows.filter(_.rank.value == 2)
    val lowerRows = rows.filter(_.rank.value >= 3)
    val winMargins = winRows.map(row =>
      row.totalAssetsManYen.value -
        secondAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value)
    )
    val secondGaps = secondRows.map(row =>
      firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
        row.totalAssetsManYen.value
    )
    val lowerGaps = lowerRows.map(row =>
      firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
        row.totalAssetsManYen.value
    )
    val highAssetCount = highAssetThreshold
      .fold(0)(threshold => assets.count(value => asDecimal(value) >= threshold))
    val lowAssetCount = lowAssetThreshold
      .fold(0)(threshold => assets.count(value => asDecimal(value) <= threshold))
    val blowoutWinCount = blowoutWinThreshold
      .fold(0)(threshold => winMargins.count(value => asDecimal(value) >= threshold))
    val nearMissSecondCount = nearMissSecondThreshold
      .fold(0)(threshold => secondGaps.count(value => asDecimal(value) <= threshold))
    val heavyLossCount = heavyLossThreshold
      .fold(0)(threshold => lowerGaps.count(value => asDecimal(value) >= threshold))
    val destinationPositiveCount = rows.count(_.incidents.destination > 0)
    val metrics = AssetStyleMetricsView(
      p10Assets = percentileDouble(assets.sorted, 0.10),
      medianAssets = median(assets),
      p90Assets = percentileDouble(assets.sorted, 0.90),
      p90P10Spread = (percentileDouble(assets.sorted, 0.90), percentileDouble(assets.sorted, 0.10))
        .mapN(_ - _),
      highAssetCount = highAssetCount,
      highAssetRate = rate(highAssetCount, targetCount),
      lowAssetCount = lowAssetCount,
      lowAssetRate = rate(lowAssetCount, targetCount),
      winCount = winRows.size,
      winRate = rate(winRows.size, targetCount),
      podiumRate = rate(rows.count(_.rank.value <= 2), targetCount),
      secondCount = secondRows.size,
      secondRate = rate(secondRows.size, targetCount),
      lowerHalfRate = rate(lowerRows.size, targetCount),
      winMedianAssets = median(winRows.map(_.totalAssetsManYen.value)),
      winMedianMargin = median(winMargins),
      secondMedianGap = median(secondGaps),
      lowerHalfMedianGap = median(lowerGaps),
      blowoutWinCount = blowoutWinCount,
      nearMissSecondCount = nearMissSecondCount,
      heavyLossCount = heavyLossCount,
      averageRevenueAssetRate = average(rows.flatMap(revenueAssetRate)),
      destinationAverage = average(rows.map(row => asDecimal(row.incidents.destination))),
      destinationPositiveRate = rate(destinationPositiveCount, targetCount),
    )
    AssetStyleProfileBase(
      memberId = memberId,
      targetCount = targetCount,
      metrics = metrics,
      status = normalStatus(targetCount),
    )

  protected final case class AssetStyleProfileBase(
      memberId: MemberId,
      targetCount: Int,
      metrics: AssetStyleMetricsView,
      status: String,
  )

  protected final case class AssetStyleMedians(
      highAssetRate: Option[Double],
      lowAssetRate: Option[Double],
      winRate: Option[Double],
      podiumRate: Option[Double],
      secondRate: Option[Double],
      blowoutWinRate: Option[Double],
      winMedianAssets: Option[Double],
      winMedianMargin: Option[Double],
      lowerHalfMedianGap: Option[Double],
      averageRevenueAssetRate: Option[Double],
      destinationAverage: Option[Double],
  )

  protected final def assetStyleMedians(bases: List[AssetStyleProfileBase]): AssetStyleMedians =
    def medianOf(value: AssetStyleMetricsView => Option[Double]): Option[Double] =
      medianDouble(bases.flatMap(base => value(base.metrics)))
    def medianOfBase(value: AssetStyleProfileBase => Option[Double]): Option[Double] =
      medianDouble(bases.flatMap(value))
    AssetStyleMedians(
      highAssetRate = medianOf(_.highAssetRate),
      lowAssetRate = medianOf(_.lowAssetRate),
      winRate = medianOf(_.winRate),
      podiumRate = medianOf(_.podiumRate),
      secondRate = medianOf(_.secondRate),
      blowoutWinRate = medianOfBase(base => blowoutWinRate(base.metrics, base.targetCount)),
      winMedianAssets = medianOf(_.winMedianAssets),
      winMedianMargin = medianOf(_.winMedianMargin),
      lowerHalfMedianGap = medianOf(_.lowerHalfMedianGap),
      averageRevenueAssetRate = medianOf(_.averageRevenueAssetRate),
      destinationAverage = medianOf(_.destinationAverage),
    )

  protected final def assetStylePrimaryKind(
      base: AssetStyleProfileBase,
      medians: AssetStyleMedians,
  ): Option[String] =
    if base.targetCount == 0 then None
    else
      val metrics = base.metrics
      val explosionSignalCount = List(
        above(metrics.highAssetRate, medians.highAssetRate, Thresholds.AssetStyleRateSignalDelta),
        above(
          blowoutWinRate(metrics, base.targetCount),
          medians.blowoutWinRate,
          Thresholds.AssetStyleBlowoutWinRateDelta,
        ),
        above(
          metrics.winMedianAssets,
          medians.winMedianAssets,
          Thresholds.AssetStyleWinMedianAssetsDelta,
        ),
      ).count(identity)
      if explosionSignalCount >= 2 then Some("asset_explosion")
      else if above(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        ) &&
        (atLeast(metrics.winRate, medians.winRate) || above(
          metrics.lowerHalfMedianGap,
          medians.lowerHalfMedianGap,
          Thresholds.AssetStyleLowerGapDelta,
        ))
      then Some("high_risk_breakthrough")
      else if below(
          blowoutWinRate(metrics, base.targetCount),
          medians.blowoutWinRate,
          Thresholds.AssetStyleBlowoutWinRateDelta,
        ) ||
        below(metrics.winMedianMargin, medians.winMedianMargin, Thresholds.AssetStyleWinMarginDelta)
      then Some("close_collector")
      else if below(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleLowRiskRateDelta,
        ) && atLeast(metrics.podiumRate, medians.podiumRate)
      then Some("steady_accumulator")
      else if above(metrics.secondRate, medians.secondRate, Thresholds.AssetStyleSecondRateDelta)
      then Some("upper_chaser")
      else Some("balanced")

