package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewGinjiCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def ginjiCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val target = stats.rows.filter(_.incidents.suriNoGinji > 0)
    Option.when(target.size >= Thresholds.ReferenceSample) {
      val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
      val destinationRankScores = rankScoreByMatch(allRows, _.incidents.destination)
      val score = average(target.map(rankScore))
      val rawSymptom = score - stats.averageRankScore
      val upper = target.filter(isUpper)
      val lower = target.filterNot(isUpper)
      val revenueRankDelta = StatsKernel.cliffsDelta(
        upper.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        lower.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val destinationRankDelta = StatsKernel.cliffsDelta(
        upper.map(row => destinationRankScores.getOrElse(rankKey(row), rankScore(row))),
        lower.map(row => destinationRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val accidentDelta =
        -StatsKernel.cliffsDelta(upper.map(minusStationCount), lower.map(minusStationCount))
      val driver = selectPrimaryActionDriver(List(
        ActionDriver("revenueRank", revenueRankDelta, 1.0),
        ActionDriver("destinationRank", destinationRankDelta, 0.95),
        ActionDriver("accidentAvoidance", accidentDelta, 0.85),
      ))
      val contrast = driver.map(_.selectionStrength).getOrElse(0.0)
      val stability = eventStability(stats.rows, rawSymptom)(rows =>
        val reducedTarget = rows.filter(_.incidents.suriNoGinji > 0)
        average(reducedTarget.map(rankScore)) - average(rows.map(rankScore))
      )
      val status = conditionalStatus(target.size)
      val advice = adviceScore(
        symptomStrength = math.abs(StatsKernel.shrink(rawSymptom, target.size)),
        contrastStrength = contrast,
        exposure = target.size,
        status = status,
        actionConnection = 0.75,
        stability = stability,
      )
      val text = ginjiText(driver.map(_.kind).getOrElse("revenueRank"))
      val dataReason = ginjiDataReason(
        score = score,
        rawSymptom = rawSymptom,
        upper = upper,
        lower = lower,
        driverKind = driver.map(_.kind).getOrElse("revenueRank"),
        revenueRankScores = revenueRankScores,
        destinationRankScores = destinationRankScores,
      )
      val primaryContrastEvidence = ginjiDriverEvidence(
        driver,
        revenueRankDelta,
        destinationRankDelta,
        accidentDelta,
        target.size,
        status,
      )
      val secondaryContrastEvidence = evidence(
        "ginji.destinationRankContrast",
        "被害時の目的地順位差",
        signed(destinationRankDelta),
        target.size,
        status,
      )
      val strongEnough = driver.exists(actionDriverStrongEnough(_, status))
      playbookCandidate(
        stats,
        playbookCard(
          id = "ginji",
          classification =
            if rawSymptom < -Thresholds.SignificantScoreDelta then "revise" else "verify",
          category = "ginji",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = dataReason,
          postMatchCheck = text.postMatchCheck,
          targetCount = target.size,
          evidence = List(
            evidence(
              "ginji.resilienceRankScore",
              "銀次被害時の順位スコア",
              decimal(score),
              target.size,
              status,
            ),
            evidence(
              "ginji.baselineRankScore",
              "本人全体の順位スコア",
              decimal(stats.averageRankScore),
              stats.rows.size,
              normalStatus(stats.rows.size, Thresholds.MainNormalSample),
            ),
            primaryContrastEvidence,
            secondaryContrastEvidence,
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "context",
            sectionId = "metric-ginji",
            label = "スリの銀次",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.abs(rawSymptom),
      )
    }

