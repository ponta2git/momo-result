package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.SeriesComparisonScope
import momo.api.endpoints.SeriesComparisonReviewResponse
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.usecases.seriescomparison.SeriesComparisonReviewAggregation

final class GetSeriesComparisonReview[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(scope: SeriesComparisonScope): F[Either[AppError, SeriesComparisonReviewResponse]] =
    readModel.resolveScope(scope).flatMap {
      case None => AppError
          .NotFound("series comparison scope", scope.scopeIdValue.getOrElse(scope.kindWire))
          .asLeft[SeriesComparisonReviewResponse].pure[F]
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows => SeriesComparisonReviewAggregation.aggregate(resolved, rows).asRight)
    }

object GetSeriesComparisonReview:
  def apply[F[_]: Monad](readModel: SeriesComparisonReadModel[F]): GetSeriesComparisonReview[F] =
    new GetSeriesComparisonReview(readModel)
