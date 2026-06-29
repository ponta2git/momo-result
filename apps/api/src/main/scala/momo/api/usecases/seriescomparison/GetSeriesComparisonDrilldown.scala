package momo.api.usecases.seriescomparison

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.SeriesComparisonScope
import momo.api.domain.constraints.RefinedTypes.MetricIdString
import momo.api.domain.ids.MemberId
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.usecases.seriescomparison.SeriesComparisonPresenter
import momo.api.usecases.seriescomparison.view.SeriesComparisonDrilldownView

final class GetSeriesComparisonDrilldown[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(
      scope: SeriesComparisonScope,
      metricId: MetricIdString,
      memberId: MemberId,
  ): F[Either[AppError, SeriesComparisonDrilldownView]] =
    readModel.resolveScope(scope).flatMap {
      case None => Monad[F]
          .pure(Left(AppError.NotFound("series comparison scope", scopeKey(scope))))
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows =>
            Right(SeriesComparisonPresenter.drilldown(
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
