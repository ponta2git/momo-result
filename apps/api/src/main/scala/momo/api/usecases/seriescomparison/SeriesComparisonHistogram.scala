package momo.api.usecases.seriescomparison

import cats.data.NonEmptyList

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.{
  HistogramBinView,
  HistogramView,
  HistogramSeriesView
}

private[seriescomparison] object SeriesComparisonHistogram:
  final case class Config(
      lowerPercentile: Double,
      upperPercentile: Double,
      targetBinCount: Int,
  )

  def forPlayers(
      allValues: List[Int],
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      value: SeriesComparisonMatchPlayerRow => Int,
      config: Config,
  ): HistogramView = forPlayers(
    allValues = allValues,
    playerOrder = playerOrder,
    rowsByPlayer = rowsByPlayer,
    value = value,
    binsFor = standardBins(config),
  )

  def forPlayers(
      allValues: List[Int],
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      value: SeriesComparisonMatchPlayerRow => Int,
      binsFor: List[Int] => List[HistogramBinView],
  ): HistogramView =
    val bins = binsFor(allValues)
    val series = playerOrder.map { memberId =>
      val counts = bins.map { bin =>
        rowsByPlayer.getOrElse(memberId, Nil).count(row =>
          value(row) >= bin.lowerInclusive && bin.upperExclusive.forall(value(row) < _)
        )
      }
      HistogramSeriesView(memberId.value, counts)
    }
    HistogramView(bins, series)

  def standardBins(config: Config)(values: List[Int]): List[HistogramBinView] =
    NonEmptyList.fromList(values) match
      case None => Nil
      case Some(nonEmptyValues) => standardBinsFrom(nonEmptyValues, config)

  def revenueBins(config: Config)(values: List[Int]): List[HistogramBinView] =
    if !values.contains(0) then standardBins(config)(values)
    else
      val baseBins = standardBins(config)(values.filterNot(_ == 0)).flatMap { bin =>
        val containsZero = bin.lowerInclusive <= 0 && bin.upperExclusive.forall(_ > 0)
        if !containsZero then List(bin)
        else
          val negativeBin = Option.when(bin.lowerInclusive < 0)(
            bin.copy(
              upperExclusive = Some(0),
              label = binLabel(bin.lowerInclusive, Some(0)),
            )
          )
          val positiveBin = Option.when(values.exists(_ > 0) && bin.upperExclusive.forall(_ > 1))(
            bin.copy(
              lowerInclusive = 1,
              label = binLabel(1, bin.upperExclusive),
            )
          )
          negativeBin.toList ++ positiveBin.toList
      }
      val (negativeBins, positiveBins) = baseBins.partition(_.lowerInclusive < 0)
      reindex(negativeBins ++ List(HistogramBinView(0, 0, Some(1), "0")) ++ positiveBins)

  private def standardBinsFrom(
      values: NonEmptyList[Int],
      config: Config,
  ): List[HistogramBinView] =
    val valueList = values.toList
    val min = valueList.min
    val max = valueList.max
    if min == max then List(HistogramBinView(0, min, None, s"$min+"))
    else
      val sorted = values.sorted
      val lowerAnchor =
        val p05 = percentile(sorted, config.lowerPercentile)
        if min < 0 && p05 >= 0 then 0 else math.floor(p05).toInt
      val p95 = percentile(sorted, config.upperPercentile)
      val rawSpan = math.max(1, math.ceil(p95 - asDecimal(lowerAnchor)).toInt)
      val step = niceStep(math.ceil(asDecimal(rawSpan) / config.targetBinCount).toInt)
      val lowerStart = math.floor(asDecimal(lowerAnchor) / asDecimal(step)).toInt * step
      val upperEnd = math.max(lowerStart + step, math.ceil(p95 / asDecimal(step)).toInt * step)
      val centralBins = Iterator.iterate(lowerStart)(_ + step).takeWhile(_ < upperEnd)
        .map(lower =>
          HistogramBinView(
            index = 0,
            lowerInclusive = lower,
            upperExclusive = Some(lower + step),
            label = binLabel(lower, Some(lower + step)),
          )
        ).toList
      val lowerBin = Option.when(min < lowerStart)(HistogramBinView(
        index = 0,
        lowerInclusive = min,
        upperExclusive = Some(lowerStart),
        label = binLabel(min, Some(lowerStart)),
      ))
      val upperBin = Option.when(max >= upperEnd)(HistogramBinView(
        index = 0,
        lowerInclusive = upperEnd,
        upperExclusive = None,
        label = binLabel(upperEnd, None),
      ))
      reindex(lowerBin.toList ++ centralBins ++ upperBin.toList)

  private def binLabel(lowerInclusive: Int, upperExclusive: Option[Int]): String =
    upperExclusive match
      case Some(upper) if upper == lowerInclusive + 1 => s"$lowerInclusive"
      case Some(upper) => s"$lowerInclusive-${upper - 1}"
      case None => s"$lowerInclusive+"

  private def reindex(bins: List[HistogramBinView]): List[HistogramBinView] =
    bins.zipWithIndex.map { case (bin, index) => bin.copy(index = index) }

  private def percentile(sortedValues: NonEmptyList[Int], probability: Double): Double =
    val values = sortedValues.toList
    val clamped = math.max(0.0, math.min(1.0, probability))
    val rank = clamped * asDecimal(values.size - 1)
    val lowerIndex = math.floor(rank).toInt
    val upperIndex = math.ceil(rank).toInt
    val weight = rank - lowerIndex
    asDecimal(values(lowerIndex)) * (1.0 - weight) + asDecimal(values(upperIndex)) * weight

  private def niceStep(rawStep: Int): Int =
    val safeStep = math.max(1, rawStep)
    val magnitude = math.pow(10.0, math.floor(math.log10(asDecimal(safeStep)))).toInt
    val normalized = math.ceil(asDecimal(safeStep) / asDecimal(magnitude)).toInt
    val factor =
      if normalized <= 1 then 1
      else if normalized <= 2 then 2
      else if normalized <= 5 then 5
      else 10
    factor * magnitude

  private def asDecimal(value: Int): Double = java.lang.Integer.valueOf(value).doubleValue()
