package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.MemberId
import momo.api.domain.{
  SeriesComparisonMatchPlayerRow, SeriesComparisonResolvedScope, SeriesComparisonScope,
}
import momo.api.endpoints.*
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel

final class GetSeriesComparisonReview[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(scope: SeriesComparisonScope): F[Either[AppError, SeriesComparisonReviewResponse]] =
    readModel.resolveScope(scope).flatMap {
      case None => AppError
          .NotFound("series comparison scope", scope.scopeIdValue.getOrElse(scope.kindWire))
          .asLeft[SeriesComparisonReviewResponse].pure[F]
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows => SeriesComparisonReviewAggregation.aggregate(resolved, rows).asRight)
    }

object GetSeriesComparisonReview:
  def apply[F[_]: Monad](readModel: SeriesComparisonReadModel[F]): GetSeriesComparisonReview[F] =
    new GetSeriesComparisonReview(readModel)

private object SeriesComparisonReviewAggregation {
  private val SchemaVersion = 3

  private object Thresholds {
    val MainNormalSample = 20
    val MainConditionalSample = 8
    val ReferenceSample = 3
    val PriorWeight = 8.0
    val SignificantScoreDelta = 0.35
    val MinimumContrast = 0.14
    val MinimumActionDriverEffect = 0.30
    val ReferenceActionDriverEffect = 0.50
    val ActionDriverTieDelta = 0.08
    val RecoverySignificantRateDelta = 0.05
    val RecoveryMinimumDriverContrast = 0.30
    val CommonTopicPlayerCount = 3
    val CommonTopicLimit = 2
  }

  def aggregate(
      scope: SeriesComparisonResolvedScope,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonReviewResponse =
    val orderedRows = sortedRows(rows)
    val matchGroups = matchGroupsFrom(orderedRows)
    val playerOrder = playerOrderFrom(orderedRows)
    val statsByPlayer = playerOrder.map(memberId =>
      memberId -> PlayerStats.fromRows(memberId, rowsByPlayer(orderedRows, memberId), orderedRows)
    ).toMap
    val allCandidates = playerOrder
      .flatMap(memberId => playbookCandidates(statsByPlayer(memberId), orderedRows))
    val scoredCandidates = scorePlaybookCandidates(allCandidates)
    val commonTopics = commonPlaybookTopics(scoredCandidates)
    val playbook = playerOrder.map(memberId =>
      val stats = statsByPlayer(memberId)
      SeriesComparisonPlayerPlaybookResponse(
        memberId = memberId.value,
        memberDisplayName = stats.displayName,
        cards = playbookCards(memberId, scoredCandidates),
      )
    )
    SeriesComparisonReviewResponse(
      schemaVersion = SchemaVersion,
      baseline = SeriesComparisonReviewBaselineResponse(
        scope = scopeResponse(scope),
        matchCount = matchGroups.size,
        playerCount = playerOrder.size,
        status = normalStatus(matchGroups.size, Thresholds.MainNormalSample),
        supplementalScopeName = None,
      ),
      commonPlaybookTopics = commonTopics,
      playbookByPlayer = playbook,
      dataQuality = SeriesComparisonDataQualityResponse(dataQualityItems(playbook)),
    )

  private def rowsByPlayer(
      rows: List[SeriesComparisonMatchPlayerRow],
      memberId: MemberId,
  ): List[SeriesComparisonMatchPlayerRow] = rows.filter(_.memberId == memberId)

  private def scopeResponse(scope: SeriesComparisonResolvedScope): SeriesComparisonScopeResponse =
    SeriesComparisonScopeResponse(
      gameTitleId = scope.gameTitleId.value,
      gameTitleName = scope.gameTitleName,
      layoutFamily = scope.layoutFamily,
      scopeKind = scope.scopeKind,
      scopeId = scope.scopeId,
      scopeName = scope.scopeName,
      seasonMasterId = scope.seasonMasterId.map(_.value),
      seasonName = scope.seasonName,
      mapMasterId = scope.mapMasterId.map(_.value),
      mapName = scope.mapName,
    )

  private final case class MatchGroup(matchIndex: Int, rows: List[SeriesComparisonMatchPlayerRow]):
    val matchId = rows.head.matchId
    val playedAt = rows.head.playedAt
    val heldEventId = rows.head.heldEventId
    val matchNoInEvent = rows.head.matchNoInEvent

  private def matchGroupsFrom(rows: List[SeriesComparisonMatchPlayerRow]): List[MatchGroup] = rows
    .groupBy(_.matchId).values.toList.sortBy(groupSortKey).zipWithIndex.map { case (group, index) =>
      MatchGroup(index + 1, sortedRows(group))
    }

  private def groupSortKey(rows: List[SeriesComparisonMatchPlayerRow]) =
    val first = rows.head
    (first.playedAt, first.heldEventId.value, first.matchNoInEvent.value, first.matchId.value)

  private def sortedRows(rows: List[SeriesComparisonMatchPlayerRow]) = rows.sortBy(row =>
    (
      row.playedAt,
      row.heldEventId.value,
      row.matchNoInEvent.value,
      row.matchId.value,
      row.playOrder.value,
    )
  )

  private val PreferredPlayerOrder = Map("ponta" -> 1, "akane" -> 2, "otaka" -> 3, "eu" -> 4)

  private def playerOrderFrom(rows: List[SeriesComparisonMatchPlayerRow]): List[MemberId] = rows
    .groupBy(_.memberId).values.toList.map(_.head).sortBy(row =>
      (
        PreferredPlayerOrder.getOrElse(row.memberId.value, Int.MaxValue),
        row.playOrder.value,
        row.memberDisplayName,
        row.memberId.value,
      )
    ).map(_.memberId)

  private final case class PlaybookCandidate(
      memberId: MemberId,
      memberDisplayName: String,
      card: SeriesComparisonPlaybookCardResponse,
      peerEffectValue: Double,
      baseScore: Double,
  )

  private final case class ScoredPlaybookCandidate(
      candidate: PlaybookCandidate,
      finalScore: Double,
      peerRank: Int,
      peerCount: Int,
      peerDistinctiveness: Double,
      commonCategory: Boolean,
  )

  private def playbookCards(
      memberId: MemberId,
      scoredCandidates: List[ScoredPlaybookCandidate],
  ): List[SeriesComparisonPlaybookCardResponse] = scoredCandidates
    .filter(_.candidate.memberId == memberId).filter(_.finalScore > 0.0).sortBy(scored =>
      (-scored.finalScore, scored.candidate.card.category, scored.candidate.card.id)
    ).foldLeft(List.empty[SeriesComparisonPlaybookCardResponse]) { (selected, scored) =>
      if selected.size >= 3 || selected.exists(_.category == scored.candidate.card.category) then
        selected
      else selected :+ cardWithPeerContext(scored)
    }

  private def playbookCandidates(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): List[PlaybookCandidate] = List(
    revenueTopCandidate(stats, allRows),
    destinationZeroCandidate(stats, allRows),
    lowAssetCandidate(stats, allRows),
    playOrderCandidate(stats, allRows),
    recoveryCandidate(stats, allRows),
    ginjiCandidate(stats, allRows),
  ).flatten

  private def scorePlaybookCandidates(
      candidates: List[PlaybookCandidate]
  ): List[ScoredPlaybookCandidate] =
    val visible = candidates
      .filter(candidate => candidate.card.status != "hidden" && candidate.baseScore > 0.0)
    visible.groupBy(_.card.category).values.toList.flatMap { categoryCandidates =>
      val ranked = categoryCandidates.sortBy(candidate =>
        (-math.abs(candidate.peerEffectValue), -candidate.baseScore, candidate.memberId.value)
      )
      val peerCount = ranked.size
      val commonCategory = peerCount >= Thresholds.CommonTopicPlayerCount
      ranked.zipWithIndex.map { case (candidate, rank) =>
        val rankWeight = peerRankWeight(rank, peerCount)
        val distinctivenessWeight = 0.55 + 0.45 * rankWeight
        val commonPenalty = if !commonCategory then 1.0 else if rank <= 1 then 0.86 else 0.0
        ScoredPlaybookCandidate(
          candidate = candidate,
          finalScore = candidate.baseScore * distinctivenessWeight * commonPenalty,
          peerRank = rank,
          peerCount = peerCount,
          peerDistinctiveness = rankWeight,
          commonCategory = commonCategory,
        )
      }
    }

  private def peerRankWeight(rank: Int, peerCount: Int): Double =
    if peerCount <= 1 then 1.0
    else
      rank match
        case 0 => 1.0
        case 1 => 0.78
        case 2 => 0.52
        case _ => 0.35

  private def cardWithPeerContext(
      scored: ScoredPlaybookCandidate
  ): SeriesComparisonPlaybookCardResponse =
    val card = scored.candidate.card
    val peerEvidence = evidence(
      metricId = s"playbook.${card.category}.peerRank",
      label = "4人内での目立ち方",
      value = peerRankLabel(scored),
      targetCount = card.targetCount,
      status = card.status,
    )
    card.copy(
      dataReason = s"${card.dataReason} ${peerReason(scored)}",
      evidence = card.evidence :+ peerEvidence,
      actionAdviceScore = rounded(scored.finalScore),
    )

  private def peerRankLabel(scored: ScoredPlaybookCandidate): String =
    if scored.peerCount <= 1 then "この人のみ" else s"${scored.peerCount}人中${scored.peerRank + 1}番目"

  private def peerReason(scored: ScoredPlaybookCandidate): String =
    if scored.peerCount <= 1 then "同じ条件の候補は他プレーヤーには出ていないため、個人差として扱います。"
    else if scored.commonCategory then
      s"同じカテゴリは${scored.peerCount}人に出ましたが、この候補は${peerRankLabel(scored)}に強く出たため個人カードとして残しています。"
    else s"同じ条件の候補内では${peerRankLabel(scored)}に強く出ており、個人差として扱います。"

  private def commonPlaybookTopics(
      scoredCandidates: List[ScoredPlaybookCandidate]
  ): List[SeriesComparisonCommonPlaybookTopicResponse] = scoredCandidates.filter(_.commonCategory)
    .groupBy(_.candidate.card.category).values.toList
    .sortBy(group => -group.map(_.candidate.baseScore).maxOption.getOrElse(0.0))
    .take(Thresholds.CommonTopicLimit).flatMap(buildCommonPlaybookTopic)

  private def buildCommonPlaybookTopic(
      scoredCandidates: List[ScoredPlaybookCandidate]
  ): Option[SeriesComparisonCommonPlaybookTopicResponse] =
    val ranked = scoredCandidates.sortBy(scored =>
      (scored.peerRank, -scored.candidate.baseScore, scored.candidate.memberDisplayName)
    )
    ranked.headOption.map { first =>
      val category = first.candidate.card.category
      val (title, summary, actionHint) = commonTopicText(category, ranked.size)
      SeriesComparisonCommonPlaybookTopicResponse(
        id = s"common-$category",
        category = category,
        title = title,
        summary = summary,
        actionHint = actionHint,
        affectedPlayerCount = ranked.size,
        memberDisplayNames = ranked.map(_.candidate.memberDisplayName).distinct,
        status = if ranked.exists(_.candidate.card.status == "ok") then "ok" else "reference",
      )
    }

  private def commonTopicText(category: String, count: Int): (String, String, String) =
    category match
      case "revenue" => (
          "収益先行後の勝ち切りが共通論点です",
          s"${count}人に物件収益先行時の候補が出ています。個人カードには、4人内で差が強い人だけを残しています。",
          "収益で上回った試合は、目的地到着、事故後の入賞維持、終盤の下位回避のどれが順位差に近いかを振り返ります。",
        )
      case "destination" => (
          "目的地なし展開の下位回避が共通論点です",
          s"${count}人に目的地0回時の候補が出ています。個人カードには、落ち込みが相対的に大きい人だけを残しています。",
          "目的地が取れない試合は、収益順位、事故回避、売り場経由のどれで2位圏へ戻せたかを見ます。",
        )
      case "assets" => (
          "低資産帯に入る前の切り替えが共通論点です",
          s"${count}人に低資産帯の候補が出ています。個人カードには、低資産帯率が4人内で目立つ人だけを残しています。",
          "総資産が伸びない試合は、収益順位、目的地不足、事故のどれで沈んだかを分けて振り返ります。",
        )
      case "playOrder" => (
          "苦手番手の初動補正が共通論点です",
          s"${count}人に番手差の候補が出ています。個人カードには、番手差が相対的に大きい人だけを残しています。",
          "苦手番手では、収益順位、目的地、事故回避のどれを早めに補正するかを決めます。",
        )
      case "ginji" => (
          "銀次被害後の方針転換が共通論点です",
          s"${count}人に銀次被害後の候補が出ています。個人カードには、被害時の落ち込みが相対的に大きい人だけを残しています。",
          "銀次被害後は、収益順位、目的地順位、追加事故回避のどれで入賞圏へ戻せたかを振り返ります。",
        )
      case "recovery" => (
          "下位後の戻し方が共通論点です",
          s"${count}人に前戦下位後の候補が出ています。個人カードには、復帰ドライバーが相対的に強い人だけを残しています。",
          "前戦下位の次戦は、目的地到着、収益基盤、事故後の資産維持のどれで2位圏へ戻せたかを振り返ります。",
        )
      case _ => (
          "複数人に共通する論点があります",
          s"${count}人に同じカテゴリの候補が出ています。個人カードには、相対的に強い候補だけを残しています。",
          "共通論点は全員分を繰り返さず、個人差が出た候補だけをカード化します。",
        )

  private def playbookCandidate(
      stats: PlayerStats,
      card: SeriesComparisonPlaybookCardResponse,
      peerEffectValue: Double,
  ): PlaybookCandidate = PlaybookCandidate(
    memberId = stats.memberId,
    memberDisplayName = stats.displayName,
    card = card.copy(id = s"${stats.memberId.value}.${card.id}"),
    peerEffectValue = peerEffectValue,
    baseScore = card.actionAdviceScore,
  )

  private def revenueTopCandidate(
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
          anchor = SeriesComparisonPlaybookAnchorTargetResponse(
            view = "drivers",
            sectionId = "metric-revenue-outcome",
            label = "物件収益と勝ち",
          ),
          score = if contrast >= Thresholds.MinimumContrast then score else 0.0,
        ),
        peerEffectValue = math.max(math.abs(rawSymptom), math.abs(odds) / 4.0),
      )
    }

  private def destinationZeroCandidate(
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
          anchor = SeriesComparisonPlaybookAnchorTargetResponse(
            view = "drivers",
            sectionId = "metric-destination-outcome",
            label = "目的地と勝ち",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.abs(rawSymptom),
      )
    }

  private def lowAssetCandidate(
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
          anchor = SeriesComparisonPlaybookAnchorTargetResponse(
            view = "drivers",
            sectionId = "metric-money",
            label = "資産と勝ち筋",
          ),
          score = if strongEnough && highLowAssetRate then advice else 0.0,
        ),
        peerEffectValue = math.max(0.0, lowRate - 0.10),
      )
    }

  private def playOrderCandidate(
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
          anchor = SeriesComparisonPlaybookAnchorTargetResponse(
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

  private def recoveryCandidate(
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
          anchor = SeriesComparisonPlaybookAnchorTargetResponse(
            view = "flow",
            sectionId = "metric-momentum-switch",
            label = "切り替え力",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.max(math.abs(rawSymptom), contrast),
      )
    }

  private def ginjiCandidate(
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
          anchor = SeriesComparisonPlaybookAnchorTargetResponse(
            view = "context",
            sectionId = "metric-ginji",
            label = "スリの銀次",
          ),
          score = if strongEnough then advice else 0.0,
        ),
        peerEffectValue = math.abs(rawSymptom),
      )
    }

  private def selectPrimaryActionDriver(
      drivers: List[ActionDriver]
  ): Option[ActionDriverSelection] =
    val ranked = drivers.map { driver =>
      ActionDriverSelection(
        kind = driver.kind,
        effect = driver.effect,
        effectStrength = math.max(0.0, driver.effect),
        selectionStrength =
          StatsKernel.clamp01(math.max(0.0, driver.effect) * driver.actionability),
        closeToSecond = false,
      )
    }.filter(_.effectStrength > 0.0).sortBy(driver => (-driver.selectionStrength, driver.kind))
    ranked match
      case Nil => None
      case head :: second :: _ => Some(head.copy(closeToSecond =
          head.selectionStrength - second.selectionStrength <= Thresholds.ActionDriverTieDelta
        ))
      case head :: Nil => Some(head)

  private def actionDriverStrongEnough(driver: ActionDriverSelection, status: String): Boolean =
    val minimum =
      if status == "reference" then Thresholds.ReferenceActionDriverEffect
      else Thresholds.MinimumActionDriverEffect
    driver.effectStrength >= minimum

  private def destinationZeroText(kind: String): RecoveryText = kind match
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "目的地なしで事故が重なったら下位連鎖を止める。",
        triggerCondition = "目的地到着がないまま、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "目的地を追い続けるより、追加事故を避けて入賞圏に戻す進行を優先する。",
        avoidAction = "目的地を取れない焦りで、被害後も大きな逆転狙いだけを続けること。",
        postMatchCheck = "次回、目的地0回だった試合を対象に、事故後に下位連鎖を止められたかを振り返る。",
      )
    case "cardShopRoute" => RecoveryText(
        actionHypothesis = "目的地なしの展開では、売り場経由で到着準備を作る。",
        triggerCondition = "目的地到着がないまま中盤を過ぎ、カード売り場に寄れるとき。",
        recommendedAction = "直行で届かないなら、売り場経由で移動や妨害の選択肢を整えて次の到着機会を作る。",
        avoidAction = "目的地が遠いまま、売り場にも寄らず終盤の一発逆転だけを待つこと。",
        postMatchCheck = "次回、目的地0回だった試合を対象に、売り場経由で到着準備を作れたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "目的地なしの展開では、収益下位のまま終盤へ入らない。",
        triggerCondition = "目的地到着がないまま中盤を過ぎ、物件収益順位も下がっているとき。",
        recommendedAction = "目的地だけの一発逆転を待つ前に、物件収益順位を2位圏へ戻す。",
        avoidAction = "目的地を取れないまま、収益順位も下げた状態で終盤へ入ること。",
        postMatchCheck = "次回、目的地0回だった試合を対象に、物件収益順位を戻せたか、4位を避けられたかを振り返る。",
      )

  private def lowAssetText(kind: String): RecoveryText = kind match
    case "destinationShortage" => RecoveryText(
        actionHypothesis = "低資産に沈む前に目的地到着で戻す。",
        triggerCondition = "総資産が伸びず、目的地回数でも遅れていると感じるとき。",
        recommendedAction = "高収益だけで巻き返す前に、目的地周辺への位置取りと1回到着を優先する。",
        avoidAction = "目的地も資産も遅れたまま、高収益だけで巻き返そうとすること。",
        postMatchCheck = "次回、総資産が伸びなかった試合で、目的地到着を作れたかを振り返る。",
      )
    case "ginjiBias" | "minusBias" => RecoveryText(
        actionHypothesis = "低資産に沈む前に事故連鎖を止める。",
        triggerCondition = "総資産が伸びず、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "大きな上振れ狙いより、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "低資産のまま、事故後も同じ勝ち切り方に固執すること。",
        postMatchCheck = "次回、総資産が伸びなかった試合で、事故後に下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "低資産に沈む前に収益順位を戻す。",
        triggerCondition = "総資産が伸びず、物件収益順位も下がっているとき。",
        recommendedAction = "目的地だけを追う前に、物件収益順位を2位圏へ戻す進行へ寄せる。",
        avoidAction = "収益下位のまま、目的地か上振れだけで巻き返そうとすること。",
        postMatchCheck = "次回、総資産が伸びなかった試合で、物件収益順位を戻せたかを振り返る。",
      )

  private def playOrderText(kind: String, order: Int): RecoveryText = kind match
    case "destinationCount" => RecoveryText(
        actionHypothesis = "苦手番手では目的地の遅れを早めに補正する。",
        triggerCondition = s"${order}番手に入り、目的地到着が遅れているとき。",
        recommendedAction = "普段より早く目的地周辺への位置取りを優先し、到着なしで終盤へ入らない。",
        avoidAction = "番手差を無視して普段通りの優先順位で進め続けること。",
        postMatchCheck = s"次回、${order}番手だった試合で、目的地回数を戻せたかを振り返る。",
      )
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "苦手番手では事故連鎖を早めに止める。",
        triggerCondition = s"${order}番手に入り、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "普段の勝ち筋を急ぐ前に、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "番手差と事故を無視して、普段通りの勝ち切り方へ寄せ続けること。",
        postMatchCheck = s"次回、${order}番手だった試合で、事故後に下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "苦手番手では収益順位の遅れを早めに補正する。",
        triggerCondition = s"${order}番手に入り、物件収益順位が下がったまま中盤へ入るとき。",
        recommendedAction = "目的地を急ぐ前に、物件収益順位を2位圏へ戻す進行を優先する。",
        avoidAction = "番手差を無視して、収益下位のまま普段通りの優先順位で進め続けること。",
        postMatchCheck = s"次回、${order}番手だった試合で、物件収益順位を戻せたかを振り返る。",
      )

  private def ginjiText(kind: String): RecoveryText = kind match
    case "destinationRank" => RecoveryText(
        actionHypothesis = "銀次被害後は目的地で順位圏を戻しに行く。",
        triggerCondition = "スリの銀次被害後も、目的地到着で順位圏へ戻せる余地があるとき。",
        recommendedAction = "被害額だけを見ず、目的地周辺への位置取りで入賞圏へ戻す。",
        avoidAction = "被害額だけで諦めて、目的地到着による順位回復を捨てること。",
        postMatchCheck = "次回、銀次被害があった試合で、目的地順位を戻して入賞圏へ戻れたかを振り返る。",
      )
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "銀次被害後は追加事故を避けて下位連鎖を止める。",
        triggerCondition = "スリの銀次被害後に、さらにマイナス駅などで資産差が広がりそうなとき。",
        recommendedAction = "1位狙いを続ける前に、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "被害後も同じ勝ち切り方に固執して、追加事故を受ける展開を続けること。",
        postMatchCheck = "次回、銀次被害があった試合で、追加事故を避けて下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "銀次被害後は収益順位を戻して入賞圏を守る。",
        triggerCondition = "スリの銀次被害を受け、物件収益順位も下がっているとき。",
        recommendedAction = "1位狙いを続ける前に、物件収益順位を2位圏へ戻して下位化を止める。",
        avoidAction = "被害前と同じ勝ち切り方に固執して、収益下位のまま終盤へ入ること。",
        postMatchCheck = "次回、銀次被害があった試合で、物件収益順位を戻して入賞圏を守れたかを振り返る。",
      )

  private def destinationZeroDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      accidentDelta: Double,
      cardShopDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceResponse = driver.map(_.kind).getOrElse("revenueRank") match
    case "accidentAvoidance" => evidence(
        "destinationOutcome.accidentAvoidanceContrast",
        "目的地0回時の事故回避差",
        signed(accidentDelta),
        targetCount,
        status,
      )
    case "cardShopRoute" => evidence(
        "destinationOutcome.cardShopContrast",
        "目的地0回時の売り場差",
        signed(cardShopDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "destinationOutcome.revenueRankContrast",
        "目的地0回時の収益順位差",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  private def lowAssetDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      destinationDelta: Double,
      ginjiDelta: Double,
      minusDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceResponse = driver.map(_.kind).getOrElse("revenueRank") match
    case "destinationShortage" => evidence(
        "assetStyleProfiles.lowAssetDestinationContrast",
        "低資産帯の目的地差",
        signed(destinationDelta),
        targetCount,
        status,
      )
    case "ginjiBias" => evidence(
        "assetStyleProfiles.lowAssetGinjiContrast",
        "低資産帯の銀次差",
        signed(ginjiDelta),
        targetCount,
        status,
      )
    case "minusBias" => evidence(
        "assetStyleProfiles.lowAssetMinusContrast",
        "低資産帯のマイナス駅差",
        signed(minusDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "assetStyleProfiles.lowAssetRevenueRankContrast",
        "低資産帯の収益順位差",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  private def playOrderDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      destinationDelta: Double,
      accidentDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceResponse = driver.map(_.kind).getOrElse("revenueRank") match
    case "destinationCount" => evidence(
        "playOrder.destinationContrast",
        "得意番手との差: 目的地",
        signed(destinationDelta),
        targetCount,
        status,
      )
    case "accidentAvoidance" => evidence(
        "playOrder.accidentAvoidanceContrast",
        "得意番手との差: 事故回避",
        signed(accidentDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "playOrder.revenueRankContrast",
        "得意番手との差: 収益順位",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  private def ginjiDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      destinationRankDelta: Double,
      accidentDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceResponse = driver.map(_.kind).getOrElse("revenueRank") match
    case "destinationRank" => evidence(
        "ginji.destinationRankContrast",
        "被害時の目的地順位差",
        signed(destinationRankDelta),
        targetCount,
        status,
      )
    case "accidentAvoidance" => evidence(
        "ginji.accidentAvoidanceContrast",
        "被害時の追加事故回避差",
        signed(accidentDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "ginji.revenueRankContrast",
        "被害時の収益順位差",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  private def destinationZeroDataReason(
      targetCount: Int,
      rankScoreDelta: Double,
      upper: List[SeriesComparisonMatchPlayerRow],
      lower: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening = s"目的地0回の試合は${targetCount}件で、順位スコアは本人平均より${signed(rankScoreDelta)}です。"
    val comparison = driverKind match
      case "accidentAvoidance" =>
        s"上位試合の事故平均は${decimal(average(upper.map(accidentCount)))}回、下位試合は${decimal(
            average(lower.map(accidentCount))
          )}回で、目的地なし展開では追加事故を避ける判断が順位差に効いている可能性があります。"
      case "cardShopRoute" =>
        s"上位試合のカード売り場平均は${averageEventValue(upper)(_.incidents.cardShop)}、下位試合は${averageEventValue(
            lower
          )(_.incidents.cardShop)}で、目的地なし展開では売り場経由で到着準備を作る動きが分岐になっている可能性があります。"
      case _ =>
        s"上位試合の物件収益順位スコア平均は${rankScoreAverage(upper, revenueRankScores)}、下位試合は${rankScoreAverage(
            lower,
            revenueRankScores,
          )}で、目的地なし展開では収益順位を下げないことが分岐になっている可能性があります。"
    s"$opening $comparison"

  private def lowAssetDataReason(
      lowRate: Double,
      target: List[SeriesComparisonMatchPlayerRow],
      nonLow: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening =
      s"選択範囲の低資産帯に入った試合は${percent(lowRate)}で、目安の10.0%より${signedPercent(lowRate - 0.10)}高いです。"
    val comparison = driverKind match
      case "destinationShortage" =>
        s"低資産帯の目的地平均は${averageEventValue(target)(_.incidents.destination)}、それ以外は${averageEventValue(
            nonLow
          )(_.incidents.destination)}で、資産が沈む前の目的地到着が分岐になっている可能性があります。"
      case "ginjiBias" =>
        s"低資産帯の銀次平均は${averageEventValue(target)(_.incidents.suriNoGinji)}、それ以外は${averageEventValue(
            nonLow
          )(_.incidents.suriNoGinji)}で、資産が沈む前の銀次被害後の切り替えが分岐になっている可能性があります。"
      case "minusBias" => s"低資産帯のマイナス駅平均は${averageEventValue(target)(
            _.incidents.minusStation
          )}、それ以外は${averageEventValue(nonLow)(
            _.incidents.minusStation
          )}で、資産が沈む前の追加事故回避が分岐になっている可能性があります。"
      case _ =>
        s"低資産帯の物件収益順位スコア平均は${rankScoreAverage(target, revenueRankScores)}、それ以外は${rankScoreAverage(
            nonLow,
            revenueRankScores,
          )}で、資産が沈む前に収益順位を戻す動きが分岐になっている可能性があります。"
    s"$opening $comparison"

  private def playOrderDataReason(
      best: (Int, Double),
      worst: (Int, Double),
      bestRows: List[SeriesComparisonMatchPlayerRow],
      worstRows: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening = s"得意番手の順位スコアは${decimal(best._2)}、苦手番手は${decimal(worst._2)}で、差は${decimal(
        best._2 - worst._2
      )}です。"
    val comparison = driverKind match
      case "destinationCount" => s"苦手番手の目的地平均は${averageEventValue(worstRows)(
            _.incidents.destination
          )}、得意番手は${averageEventValue(bestRows)(
            _.incidents.destination
          )}で、番手差が出る場面では目的地の遅れが分岐になっている可能性があります。"
      case "accidentAvoidance" =>
        s"苦手番手の事故平均は${decimal(average(worstRows.map(accidentCount)))}回、得意番手は${decimal(
            average(bestRows.map(accidentCount))
          )}回で、番手差が出る場面では事故連鎖を止める判断が分岐になっている可能性があります。"
      case _ => s"苦手番手の物件収益順位スコア平均は${rankScoreAverage(
            worstRows,
            revenueRankScores,
          )}、得意番手は${rankScoreAverage(
            bestRows,
            revenueRankScores,
          )}で、番手差が出る場面では収益順位の遅れが分岐になっている可能性があります。"
    s"$opening $comparison"

  private def ginjiDataReason(
      score: Double,
      rawSymptom: Double,
      upper: List[SeriesComparisonMatchPlayerRow],
      lower: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
      destinationRankScores: Map[(String, String), Double],
  ): String =
    val opening = s"銀次被害時の順位スコアは${decimal(score)}で、本人平均との差は${signed(rawSymptom)}です。"
    val comparison = driverKind match
      case "destinationRank" => s"被害時の上位試合の目的地順位スコア平均は${rankScoreAverage(
            upper,
            destinationRankScores,
          )}、下位試合は${rankScoreAverage(
            lower,
            destinationRankScores,
          )}で、被害後も目的地到着で順位圏へ戻す動きが分岐になっている可能性があります。"
      case "accidentAvoidance" =>
        s"被害時の上位試合の追加事故平均は${decimal(average(upper.map(minusStationCount)))}回、下位試合は${decimal(
            average(lower.map(minusStationCount))
          )}回で、被害後に追加事故を避ける判断が分岐になっている可能性があります。"
      case _ => s"被害時の上位試合の物件収益順位スコア平均は${rankScoreAverage(
            upper,
            revenueRankScores,
          )}、下位試合は${rankScoreAverage(lower, revenueRankScores)}で、被害後に収益順位を戻す動きが分岐になっている可能性があります。"
    s"$opening $comparison"

  private def recoveryText(kind: String): RecoveryText = kind match
    case "destination" => RecoveryText(
        actionHypothesis = "前戦下位の次戦は、目的地0回で終盤へ入らない。",
        triggerCondition = "前戦が3位以下で、次戦も中盤まで目的地到着がないとき。",
        recommendedAction = "1位狙いを続ける前に、目的地周辺への位置取りと1回到着で2位圏へ戻す。",
        avoidAction = "前戦の負けを取り返そうとして、目的地0回のまま終盤の一発逆転だけを待つこと。",
        postMatchCheck = "次回、前戦下位後の試合を対象に、目的地0回で終盤へ入ったか、入賞圏へ戻せたかを振り返る。",
      )
    case "revenue" => RecoveryText(
        actionHypothesis = "前戦下位の次戦は、収益下位のまま終盤へ入らない。",
        triggerCondition = "前戦が3位以下で、目的地が遠く物件収益順位も下がっていると感じるとき。",
        recommendedAction = "目的地だけを追い続ける前に、物件収益順位を2位圏へ戻す。",
        avoidAction = "目的地が遠いまま、収益も作らず逆転待ちで終盤へ入ること。",
        postMatchCheck = "次回、前戦下位後の試合を対象に、物件収益順位を戻せたか、入賞圏へ戻せたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "前戦下位の次戦は、下位連鎖を止める。",
        triggerCondition = "前戦が3位以下で、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "勝ち切りより、事故後に資産を残して入賞圏へ戻す進行を優先する。",
        avoidAction = "被害後も1位狙いのまま、資産を削る展開を続けること。",
        postMatchCheck = "次回、前戦下位後に事故が重なった試合で、資産を残して下位連鎖を止められたかを振り返る。",
      )

  private def recoveryDriverEvidence(
      driver: RecoveryDriver,
      destinationDelta: Double,
      revenueDelta: Double,
      accidentDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceResponse = driver.kind match
    case "destination" => evidence(
        "momentumSwitch.recoveryDestinationDriver",
        "復帰時の目的地順位差",
        signed(destinationDelta),
        targetCount,
        status,
      )
    case "revenue" => evidence(
        "momentumSwitch.recoveryRevenueDriver",
        "復帰時の収益順位差",
        signed(revenueDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "momentumSwitch.recoveryAccidentDriver",
        "復帰時の事故回避差",
        signed(accidentDelta),
        targetCount,
        status,
      )

  private def recoveryDataReason(
      recoveryRate: Double,
      baselinePodiumRate: Double,
      rawSymptom: Double,
      recovered: List[RecoveryTransition],
      lower: List[RecoveryTransition],
      driver: RecoveryDriver,
  ): String =
    val opening = s"前戦下位後の入賞率は${percent(recoveryRate)}で、本人全体の入賞率${percent(
        baselinePodiumRate
      )}との差は${signedPercent(rawSymptom)}です。"
    val comparison = driver.kind match
      case "destination" => s"入賞復帰試合の目的地順位スコア平均は${decimal(
            average(recovered.map(_.destinationRankScore))
          )}、下位継続試合は${decimal(
            average(lower.map(_.destinationRankScore))
          )}で、前戦下位後は目的地到着で2位圏へ戻す動きが分岐になっている可能性があります。"
      case "revenue" => s"入賞復帰試合の物件収益順位スコア平均は${decimal(
            average(recovered.map(_.revenueRankScore))
          )}、下位継続試合は${decimal(
            average(lower.map(_.revenueRankScore))
          )}で、前戦下位後は収益基盤を作り直す動きが分岐になっている可能性があります。"
      case _ => s"入賞復帰試合の事故平均は${decimal(average(recovered.map(_.accidentCount)))}回、下位継続試合は${decimal(
            average(lower.map(_.accidentCount))
          )}回で、前戦下位後は事故後の資産維持が分岐になっている可能性があります。"
    s"$opening $comparison"

  private def playbookCard(
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
      evidence: List[SeriesComparisonPlaybookEvidenceResponse],
      status: String,
      anchor: SeriesComparisonPlaybookAnchorTargetResponse,
      score: Double,
  ): SeriesComparisonPlaybookCardResponse = SeriesComparisonPlaybookCardResponse(
    id = id,
    classification = classification,
    category = category,
    actionHypothesis = actionHypothesis,
    triggerCondition = triggerCondition,
    recommendedAction = recommendedAction,
    avoidAction = avoidAction,
    dataReason = dataReason,
    postMatchCheck = postMatchCheck,
    targetCount = targetCount,
    evidence = evidence,
    status = status,
    anchorTarget = anchor,
    actionAdviceScore = rounded(score),
  )

  private final case class PlayerStats(
      memberId: MemberId,
      displayName: String,
      rows: List[SeriesComparisonMatchPlayerRow],
      averageRankScore: Double,
      winCount: Int,
      winRate: Double,
      podiumRate: Double,
      revenueTopRows: List[SeriesComparisonMatchPlayerRow],
  )

  private final case class RecoveryTransition(
      previous: SeriesComparisonMatchPlayerRow,
      current: SeriesComparisonMatchPlayerRow,
      revenueRankScore: Double,
      destinationRankScore: Double,
      accidentCount: Double,
  )

  private final case class RecoveryDriver(kind: String, strength: Double, effect: Double)

  private final case class ActionDriver(kind: String, effect: Double, actionability: Double)

  private final case class ActionDriverSelection(
      kind: String,
      effect: Double,
      effectStrength: Double,
      selectionStrength: Double,
      closeToSecond: Boolean,
  )

  private final case class RecoveryText(
      actionHypothesis: String,
      triggerCondition: String,
      recommendedAction: String,
      avoidAction: String,
      postMatchCheck: String,
  )

  private object PlayerStats {
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

  private object StatsKernel {
    private val Epsilon = 0.000001

    def rate(count: Int, denominator: Int): Double =
      if denominator <= 0 then 0.0 else asDouble(count) / asDouble(denominator)

    def shrink(raw: Double, targetCount: Int): Double = raw * asDouble(targetCount) /
      (asDouble(targetCount) + Thresholds.PriorWeight)

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
  }

  private def eventStability(rows: List[SeriesComparisonMatchPlayerRow], fullEffect: Double)(
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

  private def adviceScore(
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

  private def dataQualityItems(
      playbook: List[SeriesComparisonPlayerPlaybookResponse]
  ): List[MetricQualityResponse] = playbook.flatMap(entry =>
    entry.cards.flatMap(card =>
      card.evidence.map(evidence =>
        MetricQualityResponse(
          metricId = evidence.metricId,
          playerMemberId = Some(entry.memberId),
          denominator = evidence.targetCount,
          targetCount = evidence.targetCount,
          status = evidence.status,
          hasTies = false,
        )
      )
    )
  )

  private def evidence(
      metricId: String,
      label: String,
      value: String,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceResponse = SeriesComparisonPlaybookEvidenceResponse(
    metricId = metricId,
    label = label,
    value = value,
    targetCount = targetCount,
    status = status,
  )

  private def rankScore(row: SeriesComparisonMatchPlayerRow): Double = 5.0 -
    asDouble(row.rank.value)

  private def destinationCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.destination)

  private def ginjiCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.suriNoGinji)

  private def minusStationCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.minusStation)

  private def cardShopCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.cardShop)

  private def accidentCount(row: SeriesComparisonMatchPlayerRow): Double =
    asDouble(row.incidents.minusStation + row.incidents.suriNoGinji)

  private def isUpper(row: SeriesComparisonMatchPlayerRow): Boolean = row.rank.value <= 2

  private def afterLowerTransitions(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[(SeriesComparisonMatchPlayerRow, SeriesComparisonMatchPlayerRow)] = sortedRows(rows)
    .sliding(2)
    .collect { case List(previous, current) if previous.rank.value >= 3 => previous -> current }
    .toList

  private def recoveryRateDelta(rows: List[SeriesComparisonMatchPlayerRow]): Double =
    val transitions = afterLowerTransitions(rows)
    StatsKernel
      .rate(transitions.count { case (_, current) => isUpper(current) }, transitions.size) -
      StatsKernel.rate(rows.count(isUpper), rows.size)

  private def rankScoreByMatch(
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

  private def rankKey(row: SeriesComparisonMatchPlayerRow): (String, String) = row.matchId.value ->
    row.memberId.value

  private def averageEventValue(
      rows: List[SeriesComparisonMatchPlayerRow]
  )(select: SeriesComparisonMatchPlayerRow => Int): String =
    if rows.isEmpty then "対象なし" else f"${average(rows.map(row => asDouble(select(row))))}%.2f回"

  private def rankScoreAverage(
      rows: List[SeriesComparisonMatchPlayerRow],
      rankScores: Map[(String, String), Double],
  ): String =
    if rows.isEmpty then "対象なし"
    else decimal(average(rows.map(row => rankScores.getOrElse(rankKey(row), rankScore(row)))))

  private def average(values: List[Double]): Double = values match
    case Nil => 0.0
    case nonEmpty => nonEmpty.sum / asDouble(nonEmpty.size)

  private def variance(values: List[Double]): Double =
    if values.size <= 1 then 0.0
    else
      val mean = average(values)
      values.map(value => math.pow(value - mean, 2)).sum / asDouble(values.size - 1)

  private def asDouble(value: Int): Double = value * 1.0

  private def percent(value: Double): String = f"${value * 100.0}%.1f%%"

  private def decimal(value: Double): String = f"$value%.2f"

  private def signed(value: Double): String =
    val sign = if value > 0 then "+" else ""
    f"$sign$value%.2f"

  private def signedPercent(value: Double): String =
    val sign = if value > 0 then "+" else ""
    f"$sign${value * 100.0}%.1f%%"

  private def rounded(value: Double): Double = BigDecimal(value)
    .setScale(4, BigDecimal.RoundingMode.HALF_UP).bigDecimal.doubleValue

  private def normalStatus(targetCount: Int, okThreshold: Int): String =
    if targetCount <= 0 then "no_target"
    else if targetCount < okThreshold then "reference"
    else "ok"

  private def conditionalStatus(targetCount: Int): String =
    if targetCount < Thresholds.ReferenceSample then "hidden"
    else if targetCount < Thresholds.MainConditionalSample then "reference"
    else "ok"
}
