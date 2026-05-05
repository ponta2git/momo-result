package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.MatchRecord
import momo.api.domain.ids.*

trait MatchesAlg[F0[_]]:
  def create(record: MatchRecord): F0[Unit]
  def update(record: MatchRecord, updatedAt: java.time.Instant): F0[Unit]
  def delete(id: MatchId): F0[Boolean]
  def find(id: MatchId): F0[Option[MatchRecord]]
  def list(filter: MatchesRepository.ListFilter): F0[List[MatchRecord]]
  def listByHeldEvent(heldEventId: HeldEventId): F0[List[MatchRecord]]
  def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: Int): F0[Boolean]
  def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      excludeMatchId: MatchId,
  ): F0[Boolean]
  def maxMatchNo(heldEventId: HeldEventId): F0[Int]
  def countByHeldEvents(heldEventIds: List[HeldEventId]): F0[Map[HeldEventId, Int]]

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
      matchId: Option[MatchId] = None,
      limit: Option[Int] = None,
  )

  def fromConnectionIO[F[_]](
      alg: MatchesAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MatchesRepository[F] = new MatchesRepository[F]:
    def create(record: MatchRecord): F[Unit] = transactK(alg.create(record))
    def update(record: MatchRecord, updatedAt: java.time.Instant): F[Unit] =
      transactK(alg.update(record, updatedAt))
    def delete(id: MatchId): F[Boolean] = transactK(alg.delete(id))
    def find(id: MatchId): F[Option[MatchRecord]] = transactK(alg.find(id))
    def list(filter: ListFilter): F[List[MatchRecord]] = transactK(alg.list(filter))
    def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]] =
      transactK(alg.listByHeldEvent(heldEventId))
    def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: Int): F[Boolean] =
      transactK(alg.existsMatchNo(heldEventId, matchNoInEvent))
    def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: Int,
        excludeMatchId: MatchId,
    ): F[Boolean] = transactK(alg.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId))
    def maxMatchNo(heldEventId: HeldEventId): F[Int] = transactK(alg.maxMatchNo(heldEventId))
    def countByHeldEvents(heldEventIds: List[HeldEventId]): F[Map[HeldEventId, Int]] =
      transactK(alg.countByHeldEvents(heldEventIds))

  def liftIdentity[F[_]](alg: MatchesAlg[F]): MatchesRepository[F] = new MatchesRepository[F]:
    export alg.*
end MatchesRepository
