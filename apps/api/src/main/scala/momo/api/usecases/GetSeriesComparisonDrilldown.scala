package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.SeriesComparisonScope
import momo.api.domain.ids.MemberId
import momo.api.endpoints.SeriesComparisonDrilldownResponse
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.usecases.seriescomparison.SeriesComparisonDrilldownAggregation

final class GetSeriesComparisonDrilldown[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(
      scope: SeriesComparisonScope,
      metricId: String,
      memberId: MemberId,
  ): F[Either[AppError, SeriesComparisonDrilldownResponse]] = readModel.resolveScope(scope)
    .flatMap {
      case None => Monad[F]
          .pure(Left(AppError.NotFound("series comparison scope", scopeKey(scope))))
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows =>
            Right(SeriesComparisonDrilldownAggregation.aggregate(
              resolved,
              metricId,
              memberId,
              rows,
            ))
          )
    }

  private def scopeKey(scope: SeriesComparisonScope): String = scope.scopeIdValue
    .fold(scope.selectedGameTitleId.value)(id => s"${scope.selectedGameTitleId.value}:$id")

object GetSeriesComparisonDrilldown:
  def apply[F[_]: Monad](
      readModel: SeriesComparisonReadModel[F]
  ): GetSeriesComparisonDrilldown[F] =
    new GetSeriesComparisonDrilldown(readModel)
