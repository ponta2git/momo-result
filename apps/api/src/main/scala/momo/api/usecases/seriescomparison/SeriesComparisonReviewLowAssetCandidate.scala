package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewLowAssetCandidate
    extends SeriesComparisonReviewCandidateSupport:
  import SeriesComparisonReviewText.*

  protected final def lowAssetCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val threshold = StatsKernel.percentile(allRows.map(_.totalAssetsManYen.value).sorted, 0.10)
    val target = threshold.fold(List.empty[SeriesComparisonMatchPlayerRow])(line =>
      stats.rows.filter(_.totalAssetsManYen.value <= line)
    )
    Option.when(target.size >= Thresholds.ReferenceSample) {
      val revenueRankScores = rankScoreByMatch(allRows, _.revenueManYen.value)
      val lowRate = StatsKernel.rate(target.size, stats.rows.size)
      val rawSymptom = 0.10 - lowRate
      val lowMatchIds = target.map(_.matchId).toSet
      val nonLow = stats.rows.filterNot(row => lowMatchIds.contains(row.matchId))
      val revenueRankDelta = StatsKernel.cliffsDelta(
        nonLow.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        target.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
      )
      val destinationDelta = StatsKernel
        .cliffsDelta(nonLow.map(destinationCount), target.map(destinationCount))
      val ginjiDelta = StatsKernel.cliffsDelta(target.map(ginjiCount), nonLow.map(ginjiCount))
      val minusDelta = StatsKernel
        .cliffsDelta(target.map(minusStationCount), nonLow.map(minusStationCount))
      val driver = selectPrimaryActionDriver(List(
        ActionDriver("revenueRank", revenueRankDelta, 1.0),
        ActionDriver("destinationShortage", destinationDelta, 0.95),
        ActionDriver("ginjiBias", ginjiDelta, 0.85),
        ActionDriver("minusBias", minusDelta, 0.80),
      ))
      val contrast = driver.map(_.selectionStrength).getOrElse(0.0)
      val stability = eventStability(stats.rows, rawSymptom)(rows =>
        val reducedTarget = threshold.fold(List.empty[SeriesComparisonMatchPlayerRow])(line =>
          rows.filter(_.totalAssetsManYen.value <= line)
        )
        0.10 - StatsKernel.rate(reducedTarget.size, rows.size)
      )
      val status = conditionalStatus(target.size)
      val advice = adviceScore(
        symptomStrength = math.abs(StatsKernel.shrink(rawSymptom, target.size)),
        contrastStrength = contrast,
        exposure = target.size,
        status = status,
        actionConnection = 1.0,
        stability = stability,
      )
      val highLowAssetRate = lowRate > 0.10
      val text = lowAssetText(driver.map(_.kind).getOrElse("revenueRank"))
      val primaryContrastEvidence = lowAssetDriverEvidence(
        driver,
        revenueRankDelta,
        destinationDelta,
        ginjiDelta,
        minusDelta,
        target.size,
        status,
      )
      val dataReason = lowAssetDataReason(
        lowRate = lowRate,
        target = target,
        nonLow = nonLow,
        driverKind = driver.map(_.kind).getOrElse("revenueRank"),
        revenueRankScores = revenueRankScores,
      )
      val strongEnough = driver.exists(actionDriverStrongEnough(_, status))
      playbookCandidate(
        stats,
        playbookCard(
          id = "low-assets",
          classification = if rawSymptom < -0.05 then "revise" else "verify",
          category = "assets",
          actionHypothesis = text.actionHypothesis,
          triggerCondition = text.triggerCondition,
          recommendedAction = text.recommendedAction,
          avoidAction = text.avoidAction,
          dataReason = dataReason,
          postMatchCheck = text.postMatchCheck,
          targetCount = target.size,
          evidence = List(
            evidence(
              "assetStyleProfiles.lowAssetRate",
              "低資産帯率",
              percent(lowRate),
              stats.rows.size,
              normalStatus(stats.rows.size, Thresholds.MainNormalSample),
            ),
            evidence(
              "assetStyleProfiles.lowAssetThreshold",
              "低資産帯の基準",
              threshold.fold("対象なし")(value => f"$value%.0f万円以下"),
              allRows.size,
              normalStatus(allRows.size, Thresholds.MainNormalSample),
            ),
            primaryContrastEvidence,
            evidence(
              "assetStyleProfiles.lowAssetRevenueRankAverage",
              "低資産帯の収益順位スコア平均",
              decimal(average(
                target.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row)))
              )),
              target.size,
              status,
            ),
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "drivers",
            sectionId = "metric-money",
            label = "資産と勝ち筋",
          ),
          score = if strongEnough && highLowAssetRate then advice else 0.0,
        ),
        peerEffectValue = math.max(0.0, lowRate - 0.10),
      )
    }
