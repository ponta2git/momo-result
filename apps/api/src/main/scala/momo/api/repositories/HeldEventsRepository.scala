package momo.api.repositories

import momo.api.domain.HeldEvent

trait HeldEventsRepository[F[_]]:
  def list(query: Option[String], limit: Int): F[List[HeldEvent]]
  def find(id: String): F[Option[HeldEvent]]
  def create(event: HeldEvent): F[Unit]
  def incrementMatchCount(id: String): F[Unit]
