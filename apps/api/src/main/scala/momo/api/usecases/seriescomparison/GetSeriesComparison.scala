package momo.api.usecases.seriescomparison

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.SeriesComparisonScope
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.usecases.seriescomparison.SeriesComparisonPresenter
import momo.api.usecases.seriescomparison.model.SeriesComparisonResponse

final class GetSeriesComparison[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(scope: SeriesComparisonScope): F[Either[AppError, SeriesComparisonResponse]] = readModel
    .resolveScope(scope).flatMap {
      case None => Monad[F]
          .pure(Left(AppError.NotFound("series comparison scope", scopeKey(scope))))
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows => Right(SeriesComparisonPresenter.aggregate(resolved, rows)))
    }

  private def scopeKey(scope: SeriesComparisonScope): String = scope.scopeIdValue
    .fold(scope.selectedGameTitleId.value)(id => s"${scope.selectedGameTitleId.value}:$id")

object GetSeriesComparison:
  def apply[F[_]: Monad](readModel: SeriesComparisonReadModel[F]): GetSeriesComparison[F] =
    new GetSeriesComparison(readModel)
