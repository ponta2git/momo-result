package momo.api.repositories

import momo.api.domain.MatchRecord

trait MatchesRepository[F[_]]:
  def create(record: MatchRecord): F[Unit]
  def find(id: String): F[Option[MatchRecord]]
  def listByHeldEvent(heldEventId: String): F[List[MatchRecord]]
  def existsMatchNo(heldEventId: String, matchNoInEvent: Int): F[Boolean]
  def maxMatchNo(heldEventId: String): F[Int]
  def countByHeldEvents(heldEventIds: List[String]): F[Map[String, Int]]
