package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

final case class SeriesComparisonReviewBaselineResponse(
    scope: SeriesComparisonScopeResponse,
    matchCount: Int,
    playerCount: Int,
    status: String,
    supplementalScopeName: Option[String],
) derives Codec.AsObject
object SeriesComparisonReviewBaselineResponse:
  given Schema[SeriesComparisonReviewBaselineResponse] = Schema.derived

final case class SeriesComparisonCommonPlaybookTopicResponse(
    id: String,
    category: String,
    title: String,
    summary: String,
    actionHint: String,
    affectedPlayerCount: Int,
    memberDisplayNames: List[String],
    status: String,
) derives Codec.AsObject
object SeriesComparisonCommonPlaybookTopicResponse:
  given Schema[SeriesComparisonCommonPlaybookTopicResponse] = Schema.derived

final case class SeriesComparisonPlayerPlaybookResponse(
    memberId: String,
    memberDisplayName: String,
    cards: List[SeriesComparisonPlaybookCardResponse],
) derives Codec.AsObject
object SeriesComparisonPlayerPlaybookResponse:
  given Schema[SeriesComparisonPlayerPlaybookResponse] = Schema.derived

final case class SeriesComparisonPlaybookCardResponse(
    id: String,
    classification: String,
    category: String,
    actionHypothesis: String,
    triggerCondition: String,
    recommendedAction: String,
    avoidAction: String,
    dataReason: String,
    postMatchCheck: String,
    plainReason: String,
    evidenceStrength: String,
    targetCount: Int,
    evidence: List[SeriesComparisonPlaybookEvidenceResponse],
    status: String,
    anchorTarget: SeriesComparisonPlaybookAnchorTargetResponse,
    actionAdviceScore: Double,
) derives Codec.AsObject
object SeriesComparisonPlaybookCardResponse:
  given Schema[SeriesComparisonPlaybookCardResponse] = Schema.derived

final case class SeriesComparisonPlaybookEvidenceResponse(
    metricId: String,
    label: String,
    value: String,
    targetCount: Int,
    status: String,
    method: Option[String] = None,
    effectEstimate: Option[Double] = None,
    confidenceLow: Option[Double] = None,
    confidenceHigh: Option[Double] = None,
    stability: Option[Double] = None,
) derives Codec.AsObject
object SeriesComparisonPlaybookEvidenceResponse:
  given Schema[SeriesComparisonPlaybookEvidenceResponse] = Schema.derived

final case class SeriesComparisonPlaybookAnchorTargetResponse(
    view: String,
    sectionId: String,
    label: String,
) derives Codec.AsObject
object SeriesComparisonPlaybookAnchorTargetResponse:
  given Schema[SeriesComparisonPlaybookAnchorTargetResponse] = Schema.derived

