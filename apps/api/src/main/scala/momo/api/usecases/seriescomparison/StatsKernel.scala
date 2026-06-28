package momo.api.usecases.seriescomparison

private[seriescomparison] object StatsKernel:
  private val Epsilon = 0.000001

  def rate(count: Int, denominator: Int): Double =
    if denominator <= 0 then 0.0 else asDouble(count) / asDouble(denominator)

  def shrink(raw: Double, targetCount: Int): Double = raw * asDouble(targetCount) /
    (asDouble(targetCount) + SeriesComparisonReviewThresholds.PriorWeight)

  def standardizedDifference(a: List[Double], b: List[Double]): Double =
    if a.isEmpty || b.isEmpty then 0.0
    else
      val pooled = math.sqrt((variance(a) + variance(b)) / 2.0)
      if pooled <= Epsilon then 0.0 else (average(a) - average(b)) / pooled

  def cliffsDelta(a: List[Double], b: List[Double]): Double =
    if a.isEmpty || b.isEmpty then 0.0
    else
      val pairs =
        for
          left <- a
          right <- b
        yield if left > right then 1.0 else if left < right then -1.0 else 0.0
      average(pairs)

  def wilsonLower(success: Int, total: Int): Double =
    if total <= 0 then 0.0
    else
      val z = 1.96
      val n = asDouble(total)
      val phat = rate(success, total)
      val denominator = 1.0 + z * z / n
      val center = phat + z * z / (2.0 * n)
      val margin = z * math.sqrt((phat * (1.0 - phat) + z * z / (4.0 * n)) / n)
      clamp01((center - margin) / denominator)

  def logOddsRatio(successA: Int, totalA: Int, successB: Int, totalB: Int): Double =
    val a = asDouble(successA) + 0.5
    val b = asDouble(totalA - successA) + 0.5
    val c = asDouble(successB) + 0.5
    val d = asDouble(totalB - successB) + 0.5
    math.log((a / b) / (c / d))

  def percentile(values: List[Int], probability: Double): Option[Double] = values.sorted match
    case Nil => None
    case sorted =>
      val clamped = math.max(0.0, math.min(1.0, probability))
      val rank = clamped * asDouble(sorted.size - 1)
      val lower = math.floor(rank).toInt
      val upper = math.ceil(rank).toInt
      val weight = rank - asDouble(lower)
      Some(asDouble(sorted(lower)) + (asDouble(sorted(upper)) - asDouble(sorted(lower))) * weight)

  def clamp01(value: Double): Double = math.max(0.0, math.min(1.0, value))

  private def average(values: List[Double]): Double = values match
    case Nil => 0.0
    case nonEmpty => nonEmpty.sum / asDouble(nonEmpty.size)

  private def variance(values: List[Double]): Double =
    if values.size <= 1 then 0.0
    else
      val mean = average(values)
      values.map(value => math.pow(value - mean, 2)).sum / asDouble(values.size - 1)

  private def asDouble(value: Int): Double = value * 1.0
