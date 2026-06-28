package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

final case class SeriesComparisonOptionsResponse(
    schemaVersion: Int,
    latestConfirmedGameTitleId: Option[String],
    series: List[SeriesComparisonSeriesOption],
) derives Codec.AsObject
object SeriesComparisonOptionsResponse:
  given Schema[SeriesComparisonOptionsResponse] = Schema.derived

final case class SeriesComparisonSeriesOption(
    gameTitleId: String,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
    latestConfirmedPlayedAt: Option[String],
    seasons: List[SeriesComparisonScopeOption],
    maps: List[SeriesComparisonScopeOption],
) derives Codec.AsObject
object SeriesComparisonSeriesOption:
  given Schema[SeriesComparisonSeriesOption] = Schema.derived

final case class SeriesComparisonScopeOption(
    id: String,
    name: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
) derives Codec.AsObject
object SeriesComparisonScopeOption:
  given Schema[SeriesComparisonScopeOption] = Schema.derived
