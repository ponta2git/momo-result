package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewRevenueCandidate
    extends SeriesComparisonReviewCandidateSupport:
  protected final def revenueTopCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate] =
    val target = stats.revenueTopRows
    Option.when(target.size >= Thresholds.ReferenceSample) {
      val wins = target.filter(_.rank.value == 1)
      val nonWins = target.filterNot(_.rank.value == 1)
      val topWinRate = StatsKernel.rate(wins.size, target.size)
      val rawSymptom = topWinRate - stats.winRate
      val destinationDelta = StatsKernel
        .standardizedDifference(wins.map(destinationCount), nonWins.map(destinationCount))
      val destinationCliff = StatsKernel
        .cliffsDelta(wins.map(destinationCount), nonWins.map(destinationCount))
      val ginjiCliff = -StatsKernel.cliffsDelta(wins.map(ginjiCount), nonWins.map(ginjiCount))
      val contrast = StatsKernel.clamp01(math.max(
        math.abs(destinationCliff),
        math.max(math.abs(ginjiCliff), math.abs(destinationDelta) / 2.0),
      ))
      val odds = StatsKernel.logOddsRatio(wins.size, target.size, stats.winCount, stats.rows.size)
      val stability = eventStability(allRows, rawSymptom)(rows =>
        val reduced = PlayerStats.fromRows(stats.memberId, rowsByPlayer(rows, stats.memberId), rows)
        val reducedTarget = reduced.revenueTopRows
        StatsKernel.rate(reducedTarget.count(_.rank.value == 1), reducedTarget.size) -
          reduced.winRate
      )
      val classification =
        if rawSymptom < -0.05 then "revise" else if rawSymptom > 0.05 then "reproduce" else "verify"
      val score = adviceScore(
        symptomStrength = math
          .max(math.abs(StatsKernel.shrink(rawSymptom, target.size)), math.abs(odds) / 4.0),
        contrastStrength = contrast,
        exposure = target.size,
        status = conditionalStatus(target.size),
        actionConnection = 1.0,
        stability = stability,
      )
      val status = conditionalStatus(target.size)
      val destinationDominant = math.abs(destinationCliff) >= math.abs(ginjiCliff)
      val actionHypothesis =
        if destinationDominant then "収益先行時は目的地0回で終えない。" else "収益先行後の事故は目的地到着で入賞圏を守る。"
      val triggerCondition =
        if destinationDominant then "中盤以降、物件収益で上位だが目的地到着がないとき。" else "物件収益で上位だが、銀次被害などで総資産差が詰まったとき。"
      val recommendedAction =
        if destinationDominant then "追加収益より、目的地周辺への位置取り、到着、下位回避を優先する。"
        else "勝ち切りだけに寄せず、目的地周辺への位置取りと下位回避で入賞圏を守る。"
      val avoidAction =
        if destinationDominant then "収益トップだから安全と見て、目的地0回のまま終盤へ入ること。"
        else "収益で先行していたことを理由に、被害後も追加収益と1位狙いだけへ寄せ続けること。"
      val dataReason =
        if destinationDominant then
          s"物件収益トップ時の1位率は${percent(topWinRate)}で、本人全体の1位率${percent(stats.winRate)}との差は${signed(
              rawSymptom
            )}です。勝ち切り試合の目的地平均は${averageEventValue(wins)(
              _.incidents.destination
            )}、非勝利試合は${averageEventValue(nonWins)(
              _.incidents.destination
            )}で、収益先行時も目的地到着が順位差に効いている可能性があります。"
        else
          s"物件収益トップ時の1位率は${percent(topWinRate)}で、本人全体の1位率${percent(stats.winRate)}との差は${signed(
              rawSymptom
            )}です。勝ち切り試合の銀次平均は${averageEventValue(wins)(
              _.incidents.suriNoGinji
            )}、非勝利試合は${averageEventValue(nonWins)(
              _.incidents.suriNoGinji
            )}で、収益先行後の事故対応が順位差に効いている可能性があります。"
      val postMatchCheck =
        if destinationDominant then "次回、収益で上位だった試合を対象に、目的地0回で終えたか、入賞または下位回避できたかを振り返る。"
        else "次回、収益で上位だった試合を対象に、銀次被害後も目的地到着または下位回避で入賞圏を守れたかを振り返る。"
      val primaryContrastEvidence =
        if destinationDominant then
          evidence(
            "revenueOutcome.destinationContrast",
            "目的地差の偏り",
            signed(destinationCliff),
            target.size,
            status,
          )
        else
          evidence(
            "revenueOutcome.ginjiContrast",
            "銀次差の偏り",
            signed(ginjiCliff),
            target.size,
            status,
          )
      playbookCandidate(
        stats,
        playbookCard(
          id = "revenue-top",
          classification = classification,
          category = "revenue",
          actionHypothesis = actionHypothesis,
          triggerCondition = triggerCondition,
          recommendedAction = recommendedAction,
          avoidAction = avoidAction,
          dataReason = dataReason,
          postMatchCheck = postMatchCheck,
          targetCount = target.size,
          evidence = List(
            evidence(
              "revenueOutcome.topWinRate",
              "物件収益トップ時の1位率",
              percent(topWinRate),
              target.size,
              status,
            ),
            evidence(
              "revenueOutcome.baselineWinRate",
              "本人全体の1位率",
              percent(stats.winRate),
              stats.rows.size,
              normalStatus(stats.rows.size, Thresholds.MainNormalSample),
            ),
            primaryContrastEvidence,
            evidence(
              "revenueOutcome.wilsonLower",
              "1位率の下振れ込み目安",
              percent(StatsKernel.wilsonLower(wins.size, target.size)),
              target.size,
              status,
            ),
          ),
          status = status,
          anchor = SeriesComparisonPlaybookAnchorTargetView(
            view = "drivers",
            sectionId = "metric-revenue-outcome",
            label = "物件収益と勝ち",
          ),
          score = if contrast >= Thresholds.MinimumContrast then score else 0.0,
        ),
        peerEffectValue = math.max(math.abs(rawSymptom), math.abs(odds) / 4.0),
      )
    }
