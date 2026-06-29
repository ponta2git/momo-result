package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonReviewView(
    schemaVersion: Int,
    baseline: SeriesComparisonReviewBaselineView,
    commonPlaybookTopics: List[SeriesComparisonCommonPlaybookTopicView],
    playbookByPlayer: List[SeriesComparisonPlayerPlaybookView],
    dataQuality: SeriesComparisonDataQualityView,
)
