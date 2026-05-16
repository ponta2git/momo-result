package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.HeldEvent
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventsRepository, MatchesRepository}

final class ListHeldEvents[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
):
  def run(query: Option[String], limit: Option[Int]): F[Either[AppError, List[(HeldEvent, Int)]]] =
    ListLimit.validate("limit", limit, ListLimit.HeldEvents) match
      case Left(error) => Monad[F].pure(Left(error))
      case Right(validLimit) =>
        for
          items <- events.list(query, validLimit)
          counts <- matches.countByHeldEvents(items.map(_.id))
        yield Right(items.map(e => e -> counts.getOrElse(e.id, 0)))
