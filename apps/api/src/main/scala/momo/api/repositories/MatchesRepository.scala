package momo.api.repositories

import cats.{~>, MonadThrow}

import momo.api.domain.ids.*
import momo.api.domain.{MatchNoInEvent, MatchRecord}
import momo.api.errors.AppError

trait MatchesAlg[F0[_]]:
  def update(record: MatchRecord, updatedAt: java.time.Instant): F0[Unit]
  def delete(id: MatchId): F0[Boolean]
  def find(id: MatchId): F0[Option[MatchRecord]]
  def list(filter: MatchesRepository.ListFilter): F0[List[MatchRecord]]
  def listByHeldEvent(heldEventId: HeldEventId): F0[List[MatchRecord]]
  def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F0[Boolean]
  def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      excludeMatchId: MatchId,
  ): F0[Boolean]
  def statsByHeldEvents(
      heldEventIds: List[HeldEventId]
  ): F0[Map[HeldEventId, MatchesRepository.HeldEventStats]]

/** Usecase-facing facade: expected update rejections are values; unexpected failures remain in F. */
trait MatchesRepository[F[_]]:
  def update(record: MatchRecord, updatedAt: java.time.Instant): F[Either[AppError, Unit]]
  def delete(id: MatchId): F[Boolean]
  def find(id: MatchId): F[Option[MatchRecord]]
  def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]]
  def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]]
  def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F[Boolean]
  def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      excludeMatchId: MatchId,
  ): F[Boolean]
  def statsByHeldEvents(
      heldEventIds: List[HeldEventId]
  ): F[Map[HeldEventId, MatchesRepository.HeldEventStats]]

object MatchesRepository:
  final case class HeldEventStats(matchCount: Int, maxMatchNo: Int)

  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      matchId: Option[MatchId] = None,
      limit: Option[Int] = None,
  )

  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: MatchesAlg[F0],
      liftK: F0 ~> F,
  ): MatchesRepository[F] =
    new MatchesRepository[F]:
      def update(
          record: MatchRecord,
          updatedAt: java.time.Instant,
      ): F[Either[AppError, Unit]] = RepositoryResult.capture(liftK(alg.update(record, updatedAt)))
      def delete(id: MatchId): F[Boolean] = liftK(alg.delete(id))
      def find(id: MatchId): F[Option[MatchRecord]] = liftK(alg.find(id))
      def list(filter: ListFilter): F[List[MatchRecord]] = liftK(alg.list(filter))
      def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]] =
        liftK(alg.listByHeldEvent(heldEventId))
      def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F[Boolean] =
        liftK(alg.existsMatchNo(heldEventId, matchNoInEvent))
      def existsMatchNoExcept(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
          excludeMatchId: MatchId,
      ): F[Boolean] = liftK(alg.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId))
      def statsByHeldEvents(
          heldEventIds: List[HeldEventId]
      ): F[Map[HeldEventId, HeldEventStats]] = liftK(alg.statsByHeldEvents(heldEventIds))

end MatchesRepository
