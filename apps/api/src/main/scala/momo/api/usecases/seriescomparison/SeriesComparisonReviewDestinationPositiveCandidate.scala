package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewDestinationPositiveCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def destinationPositiveCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val target = stats.rows.filter(_.incidents.destination > 0)
    Option.when(target.size >= Thresholds.ReferenceSample) {
      val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
      val upper = target.filter(isUpper)
      val lower = target.filterNot(isUpper)
      val rawSymptom = average(target.map(rankScore)) - stats.averageRankScore
      val revenueDelta = StatsKernel.cliffsDelta(
        upper.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        lower.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val accidentDelta =
        -StatsKernel.cliffsDelta(upper.map(accidentCount), lower.map(accidentCount))
      val cardShopDelta = StatsKernel
        .cliffsDelta(upper.map(cardShopCount), lower.map(cardShopCount))
      val driver = selectPrimaryActionDriver(List(
        ActionDriver("revenueKeep", revenueDelta, 1.0),
        ActionDriver("accidentAvoidance", accidentDelta, 0.90),
        ActionDriver("cardShopFollowup", cardShopDelta, 0.70),
      ))
      val status = conditionalStatus(target.size)
      val contrast = driver.map(_.selectionStrength).getOrElse(0.0)
      val stability = eventStability(stats.rows, rawSymptom)(rows =>
        val reducedTarget = rows.filter(_.incidents.destination > 0)
        average(reducedTarget.map(rankScore)) - average(rows.map(rankScore))
      )
      val driverInterval = driver.flatMap(selected =>
        eventBootstrapInterval(
          stats.rows,
          seedFor(stats.memberId, s"destination-positive-${selected.kind}"),
        )(rows => destinationPositiveDriverEffect(rows, revenueRankScores, selected.kind))
      )
      val advice = adviceScore(
        symptomStrength = math.abs(StatsKernel.shrink(rawSymptom, target.size)),
        contrastStrength = contrast,
        exposure = target.size,
        status = status,
        actionConnection = 0.95,
        stability = stability,
      )
      val selectedKind = driver.map(_.kind).getOrElse("revenueKeep")
      val text = destinationPositiveText(selectedKind)
      val strongEnough = driver.exists(actionDriverStrongEnough(_, status)) &&
        upper.size >= Thresholds.ReferenceSample && lower.size >= Thresholds.ReferenceSample
      val driverEffect = driver.map(_.effect).getOrElse(0.0)
      playbookCandidate(
        stats,
        playbookCard(
          id = s"destination-positive-$selectedKind",
          classification =
            if rawSymptom > Thresholds.SignificantScoreDelta then "reproduce" else "verify",
          category = "destinationPositive",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = destinationPositiveDataReason(
            target = target,
            upper = upper,
            lower = lower,
            driverKind = selectedKind,
            revenueRankScores = revenueRankScores,
          ),
          postMatchCheck = text.postMatchCheck,
          targetCount = target.size,
          evidence = List(
            evidence(
              "destinationPositive.rankScore",
              "目的地あり時の順位スコア",
              decimal(average(target.map(rankScore))),
              target.size,
              status,
            ),
            statisticalEvidence(
              "destinationPositive.driver",
              destinationPositiveDriverLabel(selectedKind),
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
              "destinationPositive.outcomeCounts",
              "入賞/下位件数",
              s"${upper.size}件 / ${lower.size}件",
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
        peerEffectValue = math.max(math.abs(rawSymptom), math.abs(driverEffect)),
      )
    }
