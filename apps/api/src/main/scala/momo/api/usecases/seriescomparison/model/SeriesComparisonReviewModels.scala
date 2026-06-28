package momo.api.usecases.seriescomparison.model


final case class SeriesComparisonReviewResponse(
    schemaVersion: Int,
    baseline: SeriesComparisonReviewBaselineResponse,
    commonPlaybookTopics: List[SeriesComparisonCommonPlaybookTopicResponse],
    playbookByPlayer: List[SeriesComparisonPlayerPlaybookResponse],
    dataQuality: SeriesComparisonDataQualityResponse,
)
