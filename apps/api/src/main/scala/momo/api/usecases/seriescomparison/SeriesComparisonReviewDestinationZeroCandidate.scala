package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewDestinationZeroCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def destinationZeroCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val target = stats.rows.filter(_.incidents.destination == 0)
    Option.when(target.size >= Thresholds.ReferenceSample) {
      val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
      val score = average(target.map(rankScore))
      val rawSymptom = score - stats.averageRankScore
      val upper = target.filter(isUpper)
      val lower = target.filterNot(isUpper)
      val revenueRankDelta = StatsKernel.cliffsDelta(
        upper.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        lower.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val accidentDelta =
        -StatsKernel.cliffsDelta(upper.map(accidentCount), lower.map(accidentCount))
      val cardShopDelta = StatsKernel
        .cliffsDelta(upper.map(cardShopCount), lower.map(cardShopCount))
      val driver = selectPrimaryActionDriver(List(
        ActionDriver("revenueRank", revenueRankDelta, 1.0),
        ActionDriver("accidentAvoidance", accidentDelta, 0.85),
        ActionDriver("cardShopRoute", cardShopDelta, 0.75),
      ))
      val contrast = driver.map(_.selectionStrength).getOrElse(0.0)
      val stability = eventStability(stats.rows, rawSymptom)(rows =>
        val reducedTarget = rows.filter(_.incidents.destination == 0)
        average(reducedTarget.map(rankScore)) - average(rows.map(rankScore))
      )
      val classification =
        if rawSymptom < -Thresholds.SignificantScoreDelta then "revise"
        else if rawSymptom > Thresholds.SignificantScoreDelta then "reproduce"
        else "verify"
      val status = conditionalStatus(target.size)
      val advice = adviceScore(
        symptomStrength = math.abs(StatsKernel.shrink(rawSymptom, target.size)),
        contrastStrength = contrast,
        exposure = target.size,
        status = status,
        actionConnection = 1.0,
        stability = stability,
      )
      val text = destinationZeroText(driver.map(_.kind).getOrElse("revenueRank"))
      val primaryContrastEvidence = destinationZeroDriverEvidence(
        driver,
        revenueRankDelta,
        accidentDelta,
        cardShopDelta,
        target.size,
        status,
      )
      val dataReason = destinationZeroDataReason(
        targetCount = target.size,
        rankScoreDelta = rawSymptom,
        upper = upper,
        lower = lower,
        driverKind = driver.map(_.kind).getOrElse("revenueRank"),
        revenueRankScores = revenueRankScores,
      )
      val strongEnough = driver.exists(actionDriverStrongEnough(_, status))
      playbookCandidate(
        stats,
        playbookCard(
          id = "destination-zero",
          classification = classification,
          category = "destination",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = dataReason,
          postMatchCheck = text.postMatchCheck,
          targetCount = target.size,
          evidence = List(
            evidence(
              "destinationOutcome.zeroDestinationRankScore",
              "目的地0回の順位スコア",
              decimal(score),
              target.size,
              status,
            ),
            evidence(
              "destinationOutcome.baselineRankScore",
              "本人全体の順位スコア",
              decimal(stats.averageRankScore),
              stats.rows.size,
              normalStatus(stats.rows.size, Thresholds.MainNormalSample),
            ),
            primaryContrastEvidence,
            evidence(
              "destinationOutcome.zeroDestinationLowerRate",
              "目的地0回の下位率",
              percent(StatsKernel.rate(lower.size, target.size)),
              target.size,
              status,
            ),
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "drivers",
            sectionId = "metric-destination-outcome",
            label = "目的地と勝ち",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.abs(rawSymptom),
      )
    }

