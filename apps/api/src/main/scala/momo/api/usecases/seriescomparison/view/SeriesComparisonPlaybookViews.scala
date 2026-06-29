package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonReviewBaselineView(
    scope: SeriesComparisonScopeView,
    matchCount: Int,
    playerCount: Int,
    status: String,
    supplementalScopeName: Option[String],
)
final case class SeriesComparisonCommonPlaybookTopicView(
    id: String,
    category: String,
    title: String,
    summary: String,
    actionHint: String,
    affectedPlayerCount: Int,
    memberDisplayNames: List[String],
    status: String,
)
final case class SeriesComparisonPlayerPlaybookView(
    memberId: String,
    memberDisplayName: String,
    cards: List[SeriesComparisonPlaybookCardView],
)
final case class SeriesComparisonPlaybookCardView(
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
    evidence: List[SeriesComparisonPlaybookEvidenceView],
    status: String,
    anchorTarget: SeriesComparisonPlaybookAnchorTargetView,
    actionAdviceScore: Double,
)
final case class SeriesComparisonPlaybookEvidenceView(
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
)
final case class SeriesComparisonPlaybookAnchorTargetView(
    view: String,
    sectionId: String,
    label: String,
)
