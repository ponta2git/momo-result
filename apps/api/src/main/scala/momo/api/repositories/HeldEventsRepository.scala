package momo.api.repositories

import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId

trait HeldEventsRepository[F[_]]:
  def list(query: Option[String], limit: Int): F[List[HeldEvent]]
  def find(id: HeldEventId): F[Option[HeldEvent]]
  def create(event: HeldEvent): F[Unit]
