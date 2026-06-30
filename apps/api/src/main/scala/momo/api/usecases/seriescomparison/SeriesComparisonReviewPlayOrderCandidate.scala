package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewPlayOrderCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def playOrderCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val rowsByOrder = stats.rows.groupBy(_.playOrder.value)
    val scoredOrders = rowsByOrder.toList.flatMap { case (order, rows) =>
      Option.when(rows.size >= Thresholds.ReferenceSample)(order -> average(rows.map(rankScore)))
    }
    Option.when(scoredOrders.size >= 2) {
      val best = scoredOrders.maxBy(_._2)
      val worst = scoredOrders.minBy(_._2)
      val rawSymptom = best._2 - worst._2
      val worstRows = rowsByOrder.getOrElse(worst._1, Nil)
      val bestRows = rowsByOrder.getOrElse(best._1, Nil)
      val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
      val revenueRankDelta = StatsKernel.cliffsDelta(
        bestRows.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        worstRows.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val destinationDelta = StatsKernel
        .cliffsDelta(bestRows.map(destinationCount), worstRows.map(destinationCount))
      val accidentDelta =
        -StatsKernel.cliffsDelta(bestRows.map(accidentCount), worstRows.map(accidentCount))
      val driver = selectPrimaryActionDriver(List(
        ActionDriver("revenueRank", revenueRankDelta, 1.0),
        ActionDriver("destinationCount", destinationDelta, 0.95),
        ActionDriver("accidentAvoidance", accidentDelta, 0.85),
      ))
      val contrast = driver.map(_.selectionStrength).getOrElse(0.0)
      val status = conditionalStatus(worstRows.size)
      val stability = eventStability(stats.rows, rawSymptom)(rows =>
        val byOrder = rows.groupBy(_.playOrder.value).toList.flatMap { case (_, orderRows) =>
          Option
            .when(orderRows.size >= Thresholds.ReferenceSample)(average(orderRows.map(rankScore)))
        }
        if byOrder.size < 2 then 0.0 else byOrder.max - byOrder.min
      )
      val advice = adviceScore(
        symptomStrength = math.abs(StatsKernel.shrink(rawSymptom, worstRows.size)),
        contrastStrength = math.max(contrast, 0.25),
        exposure = worstRows.size,
        status = status,
        actionConnection = 0.7,
        stability = stability,
      )
      val text = playOrderText(driver.map(_.kind).getOrElse("revenueRank"), worst._1)
      val dataReason = playOrderDataReason(
        best = best,
        worst = worst,
        bestRows = bestRows,
        worstRows = worstRows,
        driverKind = driver.map(_.kind).getOrElse("revenueRank"),
        revenueRankScores = revenueRankScores,
      )
      val primaryContrastEvidence = playOrderDriverEvidence(
        driver,
        revenueRankDelta,
        destinationDelta,
        accidentDelta,
        worstRows.size,
        status,
      )
      val strongEnough = driver.exists(actionDriverStrongEnough(_, status))
      playbookCandidate(
        stats,
        playbookCard(
          id = "play-order",
          classification = "revise",
          category = "playOrder",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = dataReason,
          postMatchCheck = text.postMatchCheck,
          targetCount = worstRows.size,
          evidence = List(
            evidence(
              "playOrder.bestRankScore",
              s"${best._1}番手の順位スコア",
              decimal(best._2),
              bestRows.size,
              conditionalStatus(bestRows.size),
            ),
            evidence(
              "playOrder.worstRankScore",
              s"${worst._1}番手の順位スコア",
              decimal(worst._2),
              worstRows.size,
              status,
            ),
            primaryContrastEvidence,
            evidence(
              "playOrder.worstRevenueRankAverage",
              s"${worst._1}番手の収益順位スコア平均",
              decimal(average(
                worstRows.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row)))
              )),
              worstRows.size,
              status,
            ),
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "context",
            sectionId = "metric-play-order",
            label = "番手",
          ),
          score =
            if rawSymptom >= Thresholds.SignificantScoreDelta && strongEnough then advice else 0.0,
        ),
        peerEffectValue = rawSymptom,
      )
    }

