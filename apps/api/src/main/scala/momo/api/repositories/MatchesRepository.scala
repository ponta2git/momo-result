package momo.api.repositories

import momo.api.domain.MatchRecord

trait MatchesRepository[F[_]]:
  def create(record: MatchRecord): F[Unit]
  def update(record: MatchRecord, updatedAt: java.time.Instant): F[Unit]
  def delete(id: String): F[Boolean]
  def find(id: String): F[Option[MatchRecord]]
  def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]]
  def listByHeldEvent(heldEventId: String): F[List[MatchRecord]]
  def existsMatchNo(heldEventId: String, matchNoInEvent: Int): F[Boolean]
  def existsMatchNoExcept(
      heldEventId: String,
      matchNoInEvent: Int,
      excludeMatchId: String,
  ): F[Boolean]
  def maxMatchNo(heldEventId: String): F[Int]
  def countByHeldEvents(heldEventIds: List[String]): F[Map[String, Int]]

object MatchesRepository:
  final case class ListFilter(
      heldEventId: Option[String] = None,
      gameTitleId: Option[String] = None,
      seasonMasterId: Option[String] = None,
      limit: Option[Int] = None,
  )
