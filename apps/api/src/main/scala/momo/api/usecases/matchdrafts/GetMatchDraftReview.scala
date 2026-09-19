package momo.api.usecases.matchdrafts

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.MatchDraftReview
import momo.api.domain.ids.MatchDraftId
import momo.api.errors.AppError
import momo.api.repositories.MatchDraftReviewReadModel

final class GetMatchDraftReview[F[_]: Functor](reviews: MatchDraftReviewReadModel[F]):
  def run(draftId: MatchDraftId): F[Either[AppError, MatchDraftReview]] =
    reviews.find(draftId).map(_.toRight(AppError.NotFound("match draft", draftId.value)))
