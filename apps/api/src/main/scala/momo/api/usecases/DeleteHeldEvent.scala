package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.HeldEventId
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventsRepository, MatchDraftsRepository, MatchesRepository}

final class DeleteHeldEvent[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    drafts: MatchDraftsRepository[F],
):
  def run(id: HeldEventId): F[Either[AppError, Unit]] =
    events.find(id).flatMap {
      case None => Monad[F].pure(Left(AppError.NotFound("held event", id.value)))
      case Some(_) =>
        for
          matchCounts <- matches.countByHeldEvents(List(id))
          draftRefs <- drafts.list(MatchDraftsRepository.ListFilter(
            heldEventId = Some(id),
            limit = Some(1),
          ))
          result <-
            if matchCounts.getOrElse(id, 0) > 0 then
              Monad[F].pure(Left(AppError.Conflict("held event has confirmed matches.")))
            else if draftRefs.nonEmpty then
              Monad[F].pure(Left(AppError.Conflict("held event has match drafts.")))
            else
              events.delete(id).map(deleted =>
                if deleted then Right(())
                else Left(AppError.NotFound("held event", id.value))
              )
        yield result
    }
