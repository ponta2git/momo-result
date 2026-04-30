package momo.api.usecases

import cats.Monad
import cats.syntax.all.*
import momo.api.domain.HeldEvent
import momo.api.repositories.HeldEventsRepository
import momo.api.repositories.MatchesRepository

final class ListHeldEvents[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F]
):
  def run(query: Option[String], limit: Option[Int]): F[List[(HeldEvent, Int)]] =
    for
      items <- events.list(query, limit.getOrElse(20))
      counts <- matches.countByHeldEvents(items.map(_.id))
    yield items.map(e => e -> counts.getOrElse(e.id, 0))
