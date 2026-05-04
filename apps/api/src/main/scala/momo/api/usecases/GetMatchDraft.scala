package momo.api.usecases

import cats.Functor
import cats.syntax.all.*
import momo.api.domain.MatchDraft
import momo.api.domain.ids.MemberId
import momo.api.errors.AppError
import momo.api.repositories.MatchDraftsRepository

final class GetMatchDraft[F[_]: Functor](matchDrafts: MatchDraftsRepository[F]):
  def run(draftId: String, memberId: MemberId): F[Either[AppError, MatchDraft]] =
    matchDrafts.find(draftId).map {
      case None => Left(AppError.NotFound("match draft", draftId))
      case Some(draft) if draft.createdByMemberId != memberId.value =>
        Left(AppError.Forbidden("You cannot access this match draft."))
      case Some(draft) => Right(draft)
    }
