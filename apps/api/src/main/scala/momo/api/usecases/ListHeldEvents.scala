package momo.api.usecases

import cats.Functor
import cats.syntax.all.*
import momo.api.domain.HeldEvent
import momo.api.repositories.HeldEventsRepository

final class ListHeldEvents[F[_]: Functor](events: HeldEventsRepository[F]):
  def run(query: Option[String], limit: Option[Int]): F[List[HeldEvent]] =
    events.list(query, limit.getOrElse(20))
