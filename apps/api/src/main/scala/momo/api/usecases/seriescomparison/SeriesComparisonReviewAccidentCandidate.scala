package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewAccidentCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def accidentAnyCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val target = stats.rows.filter(row => accidentCount(row) > 0)
    Option.when(target.size >= Thresholds.ReferenceSample) {
      val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
      val destinationRankScores = rankScoreByMatch(allRows, _.incidents.destination)
      val upper = target.filter(isUpper)
      val lower = target.filterNot(isUpper)
      val rawSymptom = average(target.map(rankScore)) - stats.averageRankScore
      val revenueDelta = StatsKernel.cliffsDelta(
        upper.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        lower.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val destinationDelta = StatsKernel.cliffsDelta(
        upper.map(row => destinationRankScores.getOrElse(rankKey(row), rankScore(row))),
        lower.map(row => destinationRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val additionalAccidentDelta =
        -StatsKernel.cliffsDelta(upper.map(minusStationCount), lower.map(minusStationCount))
      val driver = selectPrimaryActionDriver(List(
        ActionDriver("revenueRecovery", revenueDelta, 1.0),
        ActionDriver("destinationRecovery", destinationDelta, 0.95),
        ActionDriver("avoidFurtherMinus", additionalAccidentDelta, 0.85),
      ))
      val status = conditionalStatus(target.size)
      val contrast = driver.map(_.selectionStrength).getOrElse(0.0)
      val stability = eventStability(stats.rows, rawSymptom)(rows =>
        val reducedTarget = rows.filter(row => accidentCount(row) > 0)
        average(reducedTarget.map(rankScore)) - average(rows.map(rankScore))
      )
      val selectedKind = driver.map(_.kind).getOrElse("revenueRecovery")
      val driverInterval = driver.flatMap(selected =>
        eventBootstrapInterval(
          stats.rows,
          seedFor(stats.memberId, s"accident-any-${selected.kind}")
        )(rows =>
          accidentAnyDriverEffect(rows, revenueRankScores, destinationRankScores, selected.kind)
        )
      )
      val advice = adviceScore(
        symptomStrength = math.abs(StatsKernel.shrink(rawSymptom, target.size)),
        contrastStrength = contrast,
        exposure = target.size,
        status = status,
        actionConnection = 0.90,
        stability = stability,
      )
      val text = accidentAnyText(selectedKind)
      val strongEnough = rawSymptom < -0.10 && driver.exists(actionDriverStrongEnough(_, status)) &&
        upper.size >= Thresholds.ReferenceSample && lower.size >= Thresholds.ReferenceSample
      val driverEffect = driver.map(_.effect).getOrElse(0.0)
      playbookCandidate(
        stats,
        playbookCard(
          id = s"accident-any-$selectedKind",
          classification =
            if rawSymptom < -Thresholds.SignificantScoreDelta then "revise" else "verify",
          category = "accident",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = accidentAnyDataReason(
            score = average(target.map(rankScore)),
            rawSymptom = rawSymptom,
            upper = upper,
            lower = lower,
            driverKind = selectedKind,
            revenueRankScores = revenueRankScores,
            destinationRankScores = destinationRankScores,
          ),
          postMatchCheck = text.postMatchCheck,
          targetCount = target.size,
          evidence = List(
            evidence(
              "accidentAny.rankScore",
              "事故あり時の順位スコア",
              decimal(average(target.map(rankScore))),
              target.size,
              status,
            ),
            statisticalEvidence(
              "accidentAny.driver",
              accidentAnyDriverLabel(selectedKind),
              signed(driverEffect),
              target.size,
              status,
              "event_bootstrap",
              driverEffect,
              driverInterval.map(_.low),
              driverInterval.map(_.high),
              stability,
            ),
            evidence(
              "accidentAny.outcomeCounts",
              "入賞/下位件数",
              s"${upper.size}件 / ${lower.size}件",
              target.size,
              status,
            ),
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "flow",
            sectionId = "metric-match-digest",
            label = "期間内の荒れ",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.max(math.abs(rawSymptom), math.abs(driverEffect)),
      )
    }
