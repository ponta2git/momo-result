package momo.api.usecases.seriescomparison

import momo.api.domain.constraints.RefinedTypes.MetricIdString
import momo.api.domain.ids.MemberId
import momo.api.domain.{SeriesComparisonMatchPlayerRow, SeriesComparisonResolvedScope}
import momo.api.usecases.seriescomparison.engine.SeriesComparisonEngine
import momo.api.usecases.seriescomparison.model.{
  SeriesComparisonDrilldownResponse,
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse
}

private[usecases] object SeriesComparisonPresenter:
  def aggregate(
      scope: SeriesComparisonResolvedScope,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonResponse =
    val dataset = SeriesComparisonEngine.dataset(scope, rows)
    SeriesComparisonAggregation.aggregate(dataset)

  def review(
      scope: SeriesComparisonResolvedScope,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonReviewResponse =
    val dataset = SeriesComparisonEngine.dataset(scope, rows)
    SeriesComparisonReviewAggregation.aggregate(dataset)

  def drilldown(
      scope: SeriesComparisonResolvedScope,
      metricId: MetricIdString,
      memberId: MemberId,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonDrilldownResponse =
    val dataset = SeriesComparisonEngine.dataset(scope, rows)
    SeriesComparisonDrilldownAggregation.aggregate(dataset, metricId, memberId)
