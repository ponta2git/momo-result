package momo.api.usecases.seriescomparison

import scala.util.Random

import momo.api.domain.ids.MemberId
import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewStatsSupport:
  protected val Thresholds: SeriesComparisonReviewThresholds.type = SeriesComparisonReviewThresholds

  import SeriesComparisonReviewText.*

  protected def sortedRows(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[SeriesComparisonMatchPlayerRow]

  protected final def playbookCard(
      id: String,
      classification: String,
      category: String,
      actionHypothesis: String,
      triggerCondition: String,
      recommendedAction: String,
      avoidAction: String,
      dataReason: String,
      postMatchCheck: String,
      targetCount: Int,
      evidence: List[SeriesComparisonPlaybookEvidenceView],
      status: String,
      anchor: SeriesComparisonPlaybookAnchorTargetView,
      score: Double,
  ): SeriesComparisonPlaybookCardView = SeriesComparisonPlaybookCardView(
    id = id,
    classification = classification,
    category = category,
    actionHypothesis = actionHypothesis,
    triggerCondition = triggerCondition,
    recommendedAction = recommendedAction,
    avoidAction = avoidAction,
    dataReason = dataReason,
    postMatchCheck = postMatchCheck,
    plainReason = defaultPlainReason(category),
    evidenceStrength = defaultEvidenceStrength(status, score),
    targetCount = targetCount,
    evidence = evidence,
    status = status,
    anchorTarget = anchor,
    actionAdviceScore = rounded(score),
  )

  protected final case class PlayerStats(
      memberId: MemberId,
      displayName: String,
      rows: List[SeriesComparisonMatchPlayerRow],
      averageRankScore: Double,
      winCount: Int,
      winRate: Double,
      podiumRate: Double,
      revenueTopRows: List[SeriesComparisonMatchPlayerRow],
  )

  protected object PlayerStats {
    def fromRows(
        memberId: MemberId,
        playerRows: List[SeriesComparisonMatchPlayerRow],
        allRows: List[SeriesComparisonMatchPlayerRow],
    ): PlayerStats =
      val rows = sortedRows(playerRows)
      val maxRevenueByMatch = allRows.groupBy(_.matchId).view
        .mapValues(_.map(_.revenueManYen.value).max).toMap
      val wins = rows.count(_.rank.value == 1)
      PlayerStats(
        memberId = memberId,
        displayName = rows.headOption.map(_.memberDisplayName).getOrElse(memberId.value),
        rows = rows,
        averageRankScore = average(rows.map(rankScore)),
        winCount = wins,
        winRate = StatsKernel.rate(wins, rows.size),
        podiumRate = StatsKernel.rate(rows.count(isUpper), rows.size),
        revenueTopRows = rows
          .filter(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value)),
      )
  }

  protected final def eventStability(rows: List[SeriesComparisonMatchPlayerRow], fullEffect: Double)(
      compute: List[SeriesComparisonMatchPlayerRow] => Double
  ): Double =
    val events = rows.groupBy(_.heldEventId).keys.toList
    if rows.size < Thresholds.MainConditionalSample || events.size < 2 then 0.75
    else
      val sign = math.signum(fullEffect)
      val reducedEffects = events.map(eventId => compute(rows.filterNot(_.heldEventId == eventId)))
        .filter(value => !value.isNaN && !value.isInfinity)
      if reducedEffects.isEmpty then 0.5
      else
        val sameDirection = StatsKernel.rate(
          reducedEffects.count(value => math.signum(value) == sign || math.abs(value) < 0.0001),
          reducedEffects.size,
        )
        val magnitude = average(
          reducedEffects
            .map(value => StatsKernel.clamp01(math.abs(value) / (math.abs(fullEffect) + 0.0001)))
        )
        StatsKernel.clamp01(0.35 + 0.65 * sameDirection * magnitude)

  protected final def eventBootstrapInterval(
      rows: List[SeriesComparisonMatchPlayerRow],
      seed: Long,
  )(
      compute: List[SeriesComparisonMatchPlayerRow] => Double
  ): Option[BootstrapInterval] =
    val eventIds = rows.map(_.heldEventId).distinct.sortBy(_.value)
    if eventIds.size < 3 || rows.size < Thresholds.MainConditionalSample then None
    else
      val rowsByEvent = rows.groupBy(_.heldEventId)
      val random = new Random(seed)
      val effects = List.fill(Thresholds.BootstrapIterations) {
        val sampledRows = List.fill(eventIds.size) {
          val eventId = eventIds(random.nextInt(eventIds.size))
          rowsByEvent.getOrElse(eventId, Nil)
        }.flatten
        compute(sampledRows)
      }.filter(value => !value.isNaN && !value.isInfinity).sorted
      if effects.size < 8 then None
      else
        val lowIndex = math
          .floor(asDouble(effects.size - 1) * 0.025).toInt.max(0).min(effects.size - 1)
        val highIndex = math
          .ceil(asDouble(effects.size - 1) * 0.975).toInt.max(0).min(effects.size - 1)
        Some(BootstrapInterval(effects(lowIndex), effects(highIndex)))

  protected final def seedFor(memberId: MemberId, category: String): Long =
    31L * memberId.value.hashCode.toLong + category.hashCode.toLong

  protected final def adviceScore(
      symptomStrength: Double,
      contrastStrength: Double,
      exposure: Int,
      status: String,
      actionConnection: Double,
      stability: Double,
  ): Double =
    val exposureWeight = math.min(1.0, asDouble(exposure) / Thresholds.MainConditionalSample)
    val reliability = status match
      case "ok" => 1.0
      case "reference" => 0.62
      case _ => 0.0
    symptomStrength * contrastStrength * exposureWeight * reliability * actionConnection * stability

  protected final def evidence(
      metricId: String,
      label: String,
      value: String,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceView = SeriesComparisonPlaybookEvidenceView(
    metricId = metricId,
    label = label,
    value = value,
    targetCount = targetCount,
    status = status,
    method = None,
    effectEstimate = None,
    confidenceLow = None,
    confidenceHigh = None,
    stability = None,
  )

  protected final def statisticalEvidence(
      metricId: String,
      label: String,
      value: String,
      targetCount: Int,
      status: String,
      method: String,
      effectEstimate: Double,
      confidenceLow: Option[Double],
      confidenceHigh: Option[Double],
      stability: Double,
  ): SeriesComparisonPlaybookEvidenceView = SeriesComparisonPlaybookEvidenceView(
    metricId = metricId,
    label = label,
    value = value,
    targetCount = targetCount,
    status = status,
    method = Some(method),
    effectEstimate = Some(rounded(effectEstimate)),
    confidenceLow = confidenceLow.map(rounded),
    confidenceHigh = confidenceHigh.map(rounded),
    stability = Some(rounded(stability)),
  )

  protected final def rankScore(row: SeriesComparisonMatchPlayerRow): Double = 5.0 -
    asDouble(row.rank.value)

  protected final def destinationCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.destination)

  protected final def ginjiCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.suriNoGinji)

  protected final def minusStationCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.minusStation)

  protected final def cardShopCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.cardShop)

  protected final def accidentCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.minusStation + row.incidents.suriNoGinji)

  protected final def isUpper(row: SeriesComparisonMatchPlayerRow): Boolean = row.rank.value <= 2

  protected final def afterLowerTransitions(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[(SeriesComparisonMatchPlayerRow, SeriesComparisonMatchPlayerRow)] = sortedRows(rows)
    .sliding(2)
    .collect { case List(previous, current) if previous.rank.value >= 3 => previous -> current }
    .toList

  protected final def recoveryRateDelta(rows: List[SeriesComparisonMatchPlayerRow]): Double =
    val transitions = afterLowerTransitions(rows)
    StatsKernel
      .rate(transitions.count { case (_, current) => isUpper(current) }, transitions.size) -
      StatsKernel.rate(rows.count(isUpper), rows.size)

  protected final def rankScoreByMatch(
      rows: List[SeriesComparisonMatchPlayerRow],
      value: SeriesComparisonMatchPlayerRow => Int,
  ): Map[(String, String), Double] = rows.groupBy(_.matchId).values.flatMap { matchRows =>
    val sortedValues = matchRows.map(value).distinct.sorted(using Ordering.Int.reverse)
    val ranksByValue = sortedValues.map { v =>
      val positions = matchRows.sortBy(row => -value(row)).zipWithIndex
        .collect { case (row, idx) if value(row) == v => idx + 1 }
      v -> average(positions.map(asDouble))
    }.toMap
    matchRows.map(row => rankKey(row) -> (5.0 - ranksByValue(value(row))))
  }.toMap

  protected final def rankKey(row: SeriesComparisonMatchPlayerRow): (String, String) = row.matchId.value ->
    row.memberId.value

  protected final def averageEventValue(
      rows: List[SeriesComparisonMatchPlayerRow]
  )(select: SeriesComparisonMatchPlayerRow => Int): String =
    if rows.isEmpty then "対象なし" else f"${average(rows.map(row => asDouble(select(row))))}%.2f回"

  protected final def rankScoreAverage(
      rows: List[SeriesComparisonMatchPlayerRow],
      rankScores: Map[(String, String), Double],
  ): String =
    if rows.isEmpty then "対象なし"
    else decimal(average(rows.map(row => rankScores.getOrElse(rankKey(row), rankScore(row)))))

  protected final def average(values: List[Double]): Double = values match
    case Nil => 0.0
    case nonEmpty => nonEmpty.sum / asDouble(nonEmpty.size)

  protected final def asDouble(value: Int): Double = value * 1.0

  protected final def percent(value: Double): String = f"${value * 100.0}%.1f%%"

  protected final def decimal(value: Double): String = f"$value%.2f"

  protected final def signed(value: Double): String =
    val sign = if value > 0 then "+" else ""
    f"$sign$value%.2f"

  protected final def signedPercent(value: Double): String =
    val sign = if value > 0 then "+" else ""
    f"$sign${value * 100.0}%.1f%%"

  protected final def rounded(value: Double): Double = BigDecimal(value)
    .setScale(4, BigDecimal.RoundingMode.HALF_UP).bigDecimal.doubleValue

  protected final def normalStatus(targetCount: Int, okThreshold: Int): String =
    if targetCount <= 0 then "no_target"
    else if targetCount < okThreshold then "reference"
    else "ok"

  protected final def conditionalStatus(targetCount: Int): String =
    if targetCount < Thresholds.ReferenceSample then "hidden"
    else if targetCount < Thresholds.MainConditionalSample then "reference"
    else "ok"
