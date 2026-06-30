package momo.api.usecases.seriescomparison

import cats.syntax.all.*

import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationAssetStyleShapeSupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def assetStyleShapeKind(
      base: AssetStyleProfileBase,
      medians: AssetStyleMedians,
  ): Option[String] =
    if base.targetCount == 0 then None
    else
      val metrics = base.metrics
      if above(
          metrics.highAssetRate,
          medians.highAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        ) && above(metrics.lowAssetRate, medians.lowAssetRate, 0.010)
      then Some("two_tailed")
      else if below(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleLowRiskRateDelta,
        ) && atLeast(metrics.highAssetRate, medians.highAssetRate)
      then Some("upper_side")
      else if above(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        ) && atMost(metrics.highAssetRate, medians.highAssetRate)
      then Some("lower_tail")
      else if below(
          metrics.highAssetRate,
          medians.highAssetRate,
          Thresholds.AssetStyleLowRiskRateDelta,
        )
      then Some("thin_right_tail")
      else if above(
          metrics.highAssetRate,
          medians.highAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        )
      then Some("right_tail")
      else Some("middle_heavy")

  protected final def assetStyleTags(
      base: AssetStyleProfileBase,
      medians: AssetStyleMedians,
      shapeKind: Option[String],
  ): List[String] =
    val metrics = base.metrics
    List(
      Option.when(shapeKind.contains("two_tailed"))("high_variance"),
      Option.when(above(
        metrics.destinationAverage,
        medians.destinationAverage,
        Thresholds.AssetStyleDestinationAverageDelta,
      ))("mobility_collecting"),
      Option.when(
        above(metrics.secondRate, medians.secondRate, Thresholds.AssetStyleSecondRateDelta)
      )("upper_chaser"),
      Option.when(above(
        metrics.averageRevenueAssetRate,
        medians.averageRevenueAssetRate,
        Thresholds.StrategyKindMedianDeltaThreshold,
      ))("property_base"),
      Option.when(
        above(metrics.lowAssetRate, medians.lowAssetRate, Thresholds.AssetStyleRateSignalDelta)
      )("downside_risk"),
      Option.when(below(
        metrics.averageRevenueAssetRate,
        medians.averageRevenueAssetRate,
        Thresholds.StrategyKindMedianDeltaThreshold,
      ))("card_base"),
      Option.when(
        below(metrics.winMedianMargin, medians.winMedianMargin, Thresholds.AssetStyleWinMarginDelta)
      )("close_finish"),
    ).flatten.distinct

  protected final def blowoutWinRate(metrics: AssetStyleMetricsView, targetCount: Int): Option[Double] =
    rate(metrics.blowoutWinCount, targetCount)

  protected final def above(value: Option[Double], baseline: Option[Double], delta: Double): Boolean =
    (value, baseline).mapN((v, b) => v >= b + delta).getOrElse(false)

  protected final def below(value: Option[Double], baseline: Option[Double], delta: Double): Boolean =
    (value, baseline).mapN((v, b) => v <= b - delta).getOrElse(false)

  protected final def atLeast(value: Option[Double], baseline: Option[Double]): Boolean = (value, baseline)
    .mapN(_ >= _).getOrElse(false)

  protected final def atMost(value: Option[Double], baseline: Option[Double]): Boolean = (value, baseline)
    .mapN(_ <= _).getOrElse(false)

