package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewRecoveryCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def recoveryCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
    val destinationRankScores = rankScoreByMatch(allRows, _.incidents.destination)
    val transitions = afterLowerTransitions(stats.rows).map { case (previous, current) =>
      RecoveryTransition(
        previous = previous,
        current = current,
        revenueRankScore = revenueRankScores.getOrElse(rankKey(current), rankScore(current)),
        destinationRankScore =
          destinationRankScores.getOrElse(rankKey(current), rankScore(current)),
        accidentCount = accidentCount(current),
      )
    }
    val recovered = transitions.filter(transition => isUpper(transition.current))
    val lower = transitions.filterNot(transition => isUpper(transition.current))
    Option.when(
      transitions.size >= Thresholds.ReferenceSample &&
        recovered.size >= Thresholds.ReferenceSample && lower.size >= Thresholds.ReferenceSample
    ) {
      val recoveryRate = StatsKernel.rate(recovered.size, transitions.size)
      val rawSymptom = recoveryRate - stats.podiumRate
      val destinationDelta = StatsKernel
        .cliffsDelta(recovered.map(_.destinationRankScore), lower.map(_.destinationRankScore))
      val revenueDelta = StatsKernel
        .cliffsDelta(recovered.map(_.revenueRankScore), lower.map(_.revenueRankScore))
      val accidentDelta =
        -StatsKernel.cliffsDelta(recovered.map(_.accidentCount), lower.map(_.accidentCount))
      val drivers = List(
        RecoveryDriver("destination", math.max(0.0, destinationDelta), destinationDelta),
        RecoveryDriver("revenue", math.max(0.0, revenueDelta), revenueDelta),
        RecoveryDriver("accident", math.max(0.0, accidentDelta), accidentDelta),
      )
      val strongest = drivers.maxBy(_.strength)
      val contrast = StatsKernel.clamp01(strongest.strength)
      val status = conditionalStatus(transitions.size)
      val odds = StatsKernel
        .logOddsRatio(recovered.size, transitions.size, stats.rows.count(isUpper), stats.rows.size)
      val stability = eventStability(stats.rows, rawSymptom)(recoveryRateDelta)
      val symptomStrength = List(
        math.abs(StatsKernel.shrink(rawSymptom, transitions.size)),
        math.abs(odds) / 4.0,
        contrast / 2.0,
      ).max
      val advice = adviceScore(
        symptomStrength = symptomStrength,
        contrastStrength = contrast,
        exposure = transitions.size,
        status = status,
        actionConnection = 0.85,
        stability = stability,
      )
      val classification =
        if rawSymptom >= Thresholds.RecoverySignificantRateDelta then "reproduce"
        else if rawSymptom <= -Thresholds.RecoverySignificantRateDelta then "revise"
        else "verify"
      val text = recoveryText(strongest.kind)
      val driverEvidence = recoveryDriverEvidence(
        strongest,
        destinationDelta,
        revenueDelta,
        accidentDelta,
        transitions.size,
        status,
      )
      val dataReason = recoveryDataReason(
        recoveryRate = recoveryRate,
        baselinePodiumRate = stats.podiumRate,
        rawSymptom = rawSymptom,
        recovered = recovered,
        lower = lower,
        driver = strongest,
      )
      val strongEnough = contrast >= Thresholds.RecoveryMinimumDriverContrast ||
        math.abs(rawSymptom) >= Thresholds.RecoverySignificantRateDelta
      playbookCandidate(
        stats,
        playbookCard(
          id = s"recovery-${strongest.kind}",
          classification = classification,
          category = "recovery",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = dataReason,
          postMatchCheck = text.postMatchCheck,
          targetCount = transitions.size,
          evidence = List(
            evidence(
              "momentumSwitch.afterLowerPodiumRate",
              "下位後入賞率",
              percent(recoveryRate),
              transitions.size,
              status,
            ),
            evidence(
              "momentumSwitch.baselinePodiumRate",
              "本人全体の入賞率",
              percent(stats.podiumRate),
              stats.rows.size,
              normalStatus(stats.rows.size, Thresholds.MainNormalSample),
            ),
            driverEvidence,
            evidence(
              "momentumSwitch.recoveryOutcomeCounts",
              "復帰/下位継続件数",
              s"${recovered.size}件 / ${lower.size}件",
              transitions.size,
              status,
            ),
            evidence(
              "momentumSwitch.afterLowerWilsonLower",
              "下位後入賞率の下振れ込み目安",
              percent(StatsKernel.wilsonLower(recovered.size, transitions.size)),
              transitions.size,
              status,
            ),
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "flow",
            sectionId = "metric-momentum-switch",
            label = "切り替え力",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.max(math.abs(rawSymptom), contrast),
      )
    }
