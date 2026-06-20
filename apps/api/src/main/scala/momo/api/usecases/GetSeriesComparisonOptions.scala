package momo.api.usecases

import java.time.format.DateTimeFormatter

import cats.Functor
import cats.syntax.all.*

import momo.api.endpoints.{
  SeriesComparisonOptionsResponse,
  SeriesComparisonScopeOption,
  SeriesComparisonSeriesOption
}
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel

final class GetSeriesComparisonOptions[F[_]: Functor](readModel: SeriesComparisonReadModel[F]):
  def run: F[Either[AppError, SeriesComparisonOptionsResponse]] = readModel.options.map { data =>
    Right(SeriesComparisonOptionsResponse(
      schemaVersion = 1,
      latestConfirmedGameTitleId = data.latestConfirmedGameTitleId.map(_.value),
      series = data.series.map(series =>
        SeriesComparisonSeriesOption(
          gameTitleId = series.gameTitleId.value,
          name = series.name,
          layoutFamily = series.layoutFamily,
          displayOrder = series.displayOrder,
          confirmedMatchCount = series.confirmedMatchCount,
          latestConfirmedPlayedAt = series.latestConfirmedPlayedAt
            .map(DateTimeFormatter.ISO_INSTANT.format),
          seasons = series.seasons.map(scope =>
            SeriesComparisonScopeOption(
              id = scope.id,
              name = scope.name,
              displayOrder = scope.displayOrder,
              confirmedMatchCount = scope.confirmedMatchCount,
            )
          ),
          maps = series.maps.map(scope =>
            SeriesComparisonScopeOption(
              id = scope.id,
              name = scope.name,
              displayOrder = scope.displayOrder,
              confirmedMatchCount = scope.confirmedMatchCount,
            )
          ),
        )
      ),
    ))
  }

object GetSeriesComparisonOptions:
  def apply[F[_]: Functor](readModel: SeriesComparisonReadModel[F]): GetSeriesComparisonOptions[F] =
    new GetSeriesComparisonOptions(readModel)
