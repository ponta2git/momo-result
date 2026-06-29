package momo.api.usecases.seriescomparison

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.SeriesComparisonScope
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.usecases.seriescomparison.SeriesComparisonPresenter
import momo.api.usecases.seriescomparison.view.SeriesComparisonReviewView

final class GetSeriesComparisonReview[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(scope: SeriesComparisonScope): F[Either[AppError, SeriesComparisonReviewView]] =
    readModel.resolveScope(scope).flatMap {
      case None => AppError
          .NotFound("series comparison scope", scope.scopeIdValue.getOrElse(scope.kindWire))
          .asLeft[SeriesComparisonReviewView].pure[F]
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows => SeriesComparisonPresenter.review(resolved, rows).asRight)
    }

object GetSeriesComparisonReview:
  def apply[F[_]: Monad](readModel: SeriesComparisonReadModel[F]): GetSeriesComparisonReview[F] =
    new GetSeriesComparisonReview(readModel)
