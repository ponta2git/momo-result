package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonOptionsView(
    schemaVersion: Int,
    latestConfirmedGameTitleId: Option[String],
    series: List[SeriesComparisonSeriesOption],
)
final case class SeriesComparisonSeriesOption(
    gameTitleId: String,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
    latestConfirmedPlayedAt: Option[String],
    seasons: List[SeriesComparisonScopeOption],
    maps: List[SeriesComparisonScopeOption],
)
final case class SeriesComparisonScopeOption(
    id: String,
    name: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
)
