package momo.api.usecases

import cats.Functor
import cats.syntax.functor.*

import momo.api.domain.ids.HeldEventId
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventDeletionRepository, HeldEventDeletionResult}

final class DeleteHeldEvent[F[_]: Functor](deletions: HeldEventDeletionRepository[F]):
  def run(id: HeldEventId): F[Either[AppError, Unit]] = deletions.deleteIfUnreferenced(id).map {
    case HeldEventDeletionResult.Deleted => Right(())
    case HeldEventDeletionResult.NotFound => Left(AppError.NotFound("held event", id.value))
    case HeldEventDeletionResult.HasConfirmedMatches =>
      Left(AppError.Conflict("held event has confirmed matches."))
    case HeldEventDeletionResult.HasMatchDrafts =>
      Left(AppError.Conflict("held event has match drafts."))
    case HeldEventDeletionResult.Referenced =>
      Left(AppError.Conflict("held event is still referenced."))
  }
