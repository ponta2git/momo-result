package momo.api.repositories

import momo.api.domain.MatchRecord
import momo.api.domain.ids.*

trait MatchesRepository[F[_]]:
  def create(record: MatchRecord): F[Unit]
  def update(record: MatchRecord, updatedAt: java.time.Instant): F[Unit]
  def delete(id: MatchId): F[Boolean]
  def find(id: MatchId): F[Option[MatchRecord]]
  def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]]
  def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]]
  def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: Int): F[Boolean]
  def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      excludeMatchId: MatchId,
  ): F[Boolean]
  def maxMatchNo(heldEventId: HeldEventId): F[Int]
  def countByHeldEvents(heldEventIds: List[HeldEventId]): F[Map[HeldEventId, Int]]

object MatchesRepository:
  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      limit: Option[Int] = None,
  )
