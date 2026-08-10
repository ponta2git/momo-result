package momo.api.endpoints

import io.circe.Codec

import momo.api.domain.{SeriesAnalysisOptions, SeriesAnalysisTitleOption}

final case class SeriesAnalysisSeasonOptionResponse(
    seasonMasterId: String,
    displayName: String,
) derives Codec.AsObject

final case class SeriesAnalysisMapOptionResponse(mapMasterId: String, displayName: String)
    derives Codec.AsObject

final case class SeriesAnalysisSeasonMapPairResponse(
    seasonMasterId: String,
    mapMasterId: String,
) derives Codec.AsObject

final case class SeriesAnalysisTitleOptionResponse(
    gameTitleId: String,
    displayName: String,
    confirmedMatchCount: Long,
    seasons: List[SeriesAnalysisSeasonOptionResponse],
    maps: List[SeriesAnalysisMapOptionResponse],
    seasonMapPairs: List[SeriesAnalysisSeasonMapPairResponse],
) derives Codec.AsObject

final case class SeriesAnalysisOptionsResponse(
    schemaVersion: Int,
    defaultGameTitleId: Option[String],
    titles: List[SeriesAnalysisTitleOptionResponse],
) derives Codec.AsObject

object SeriesAnalysisOptionsResponse:
  def from(value: SeriesAnalysisOptions): SeriesAnalysisOptionsResponse =
    SeriesAnalysisOptionsResponse(
      schemaVersion = 1,
      defaultGameTitleId = value.defaultGameTitleId.map(_.value),
      titles = value.titles.map(titleOption),
    )

  private def titleOption(value: SeriesAnalysisTitleOption): SeriesAnalysisTitleOptionResponse =
    SeriesAnalysisTitleOptionResponse(
      value.gameTitleId.value,
      value.displayName,
      value.confirmedMatchCount,
      value.seasons.map(value =>
        SeriesAnalysisSeasonOptionResponse(value.id.value, value.displayName)
      ),
      value.maps.map(value => SeriesAnalysisMapOptionResponse(value.id.value, value.displayName)),
      value.seasonMapPairs.map(value =>
        SeriesAnalysisSeasonMapPairResponse(
          value.seasonMasterId.value,
          value.mapMasterId.value,
        )
      ),
    )
