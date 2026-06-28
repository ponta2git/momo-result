package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

final case class SeriesComparisonReviewResponse(
    schemaVersion: Int,
    baseline: SeriesComparisonReviewBaselineResponse,
    commonPlaybookTopics: List[SeriesComparisonCommonPlaybookTopicResponse],
    playbookByPlayer: List[SeriesComparisonPlayerPlaybookResponse],
    dataQuality: SeriesComparisonDataQualityResponse,
) derives Codec.AsObject
object SeriesComparisonReviewResponse:
  given Schema[SeriesComparisonReviewResponse] = Schema.derived
