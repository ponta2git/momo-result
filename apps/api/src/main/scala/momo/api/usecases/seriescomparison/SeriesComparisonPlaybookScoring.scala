package momo.api.usecases.seriescomparison

import cats.data.NonEmptyList

import momo.api.domain.ids.MemberId
import momo.api.endpoints.{
  MetricQualityResponse,
  SeriesComparisonCommonPlaybookTopicResponse,
  SeriesComparisonPlaybookCardResponse,
  SeriesComparisonPlaybookEvidenceResponse,
  SeriesComparisonPlayerPlaybookResponse
}

private[seriescomparison] object SeriesComparisonPlaybookScoring:
  private val Thresholds = SeriesComparisonReviewThresholds

  import SeriesComparisonReviewText.*

  def score(candidates: List[PlaybookCandidate]): List[ScoredPlaybookCandidate] =
    val visible = candidates
      .filter(candidate => candidate.card.status != "hidden" && candidate.baseScore > 0.0)
    visible.groupBy(_.card.category).values.toList.flatMap(categoryCandidates =>
      NonEmptyList.fromList(categoryCandidates).fold(List.empty)(scoreCategory)
    )

  def cardsFor(
      memberId: MemberId,
      scoredCandidates: List[ScoredPlaybookCandidate],
  ): List[SeriesComparisonPlaybookCardResponse] = scoredCandidates
    .filter(_.candidate.memberId == memberId).filter(_.finalScore > 0.0).sortBy(scored =>
      (-scored.finalScore, scored.candidate.card.category, scored.candidate.card.id)
    ).foldLeft(List.empty[SeriesComparisonPlaybookCardResponse]) { (selected, scored) =>
      val card = scored.candidate.card
      if selected.size >= 3 || selected.exists(_.category == card.category) ||
        selected.count(existing => actionFamily(existing) == actionFamily(card)) >= 2
      then selected
      else selected :+ cardWithPeerContext(scored)
    }

  def commonTopics(
      scoredCandidates: List[ScoredPlaybookCandidate]
  ): List[SeriesComparisonCommonPlaybookTopicResponse] = scoredCandidates.filter(_.commonCategory)
    .groupBy(_.candidate.card.category).values.toList
    .sortBy(group => -group.map(_.candidate.baseScore).maxOption.getOrElse(0.0))
    .take(Thresholds.CommonTopicLimit).flatMap(group =>
      NonEmptyList.fromList(group).map(commonTopic).toList
    )

  def dataQualityItems(
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

  private def scoreCategory(
      categoryCandidates: NonEmptyList[PlaybookCandidate]
  ): List[ScoredPlaybookCandidate] =
    val ranked = categoryCandidates.toList.sortBy(candidate =>
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

  private def actionFamily(card: SeriesComparisonPlaybookCardResponse): String =
    val text = s"${card.actionHypothesis} ${card.recommendedAction}"
    if text.contains("収益順位") || text.contains("物件収益順位") then "revenue-rank"
    else if text.contains("目的地") then "destination"
    else if text.contains("事故") || text.contains("銀次") || text.contains("マイナス駅") then
      "accident"
    else card.category

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

  private def commonTopic(
      scoredCandidates: NonEmptyList[ScoredPlaybookCandidate]
  ): SeriesComparisonCommonPlaybookTopicResponse =
    val ranked = scoredCandidates.sortBy(scored =>
      (scored.peerRank, -scored.candidate.baseScore, scored.candidate.memberDisplayName)
    )
    val first = ranked.head
    val category = first.candidate.card.category
    val (title, summary, actionHint) = commonTopicText(category, ranked.size)
    SeriesComparisonCommonPlaybookTopicResponse(
      id = s"common-$category",
      category = category,
      title = title,
      summary = summary,
      actionHint = actionHint,
      affectedPlayerCount = ranked.size,
      memberDisplayNames = ranked.toList.map(_.candidate.memberDisplayName).distinct,
      status = if ranked.exists(_.candidate.card.status == "ok") then "ok" else "reference",
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
    method = None,
    effectEstimate = None,
    confidenceLow = None,
    confidenceHigh = None,
    stability = None,
  )

  private def rounded(value: Double): Double = BigDecimal(value)
    .setScale(4, BigDecimal.RoundingMode.HALF_UP).bigDecimal.doubleValue
