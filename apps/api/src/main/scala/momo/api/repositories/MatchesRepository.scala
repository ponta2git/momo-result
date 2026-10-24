package momo.api.repositories

import cats.{~>, MonadThrow}

import momo.api.domain.ids.*
import momo.api.domain.{MatchNoInEvent, MatchRecord, MatchUpdate}
import momo.api.errors.AppError

trait MatchesAlg[F0[_]]:
  def update(id: MatchId, change: MatchUpdate, updatedAt: java.time.Instant): F0[MatchRecord]
  def delete(id: MatchId, actor: Option[AccountId] = None): F0[Boolean]
  def find(id: MatchId): F0[Option[MatchRecord]]
  def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F0[Boolean]
  def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      excludeMatchId: MatchId,
  ): F0[Boolean]

/** Usecase-facing facade: expected update rejections are values; unexpected failures remain in F. */
trait MatchesRepository[F[_]]:
  def update(
      id: MatchId,
      change: MatchUpdate,
      updatedAt: java.time.Instant
  ): F[Either[AppError, MatchRecord]]
  def delete(id: MatchId, actor: Option[AccountId] = None): F[Boolean]
  def find(id: MatchId): F[Option[MatchRecord]]
  def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F[Boolean]
  def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      excludeMatchId: MatchId,
  ): F[Boolean]

object MatchesRepository:
  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: MatchesAlg[F0],
      liftK: F0 ~> F,
  ): MatchesRepository[F] =
    new MatchesRepository[F]:
      def update(
          id: MatchId,
          change: MatchUpdate,
          updatedAt: java.time.Instant,
      ): F[Either[AppError, MatchRecord]] =
        RepositoryResult.capture(liftK(alg.update(id, change, updatedAt)))
      def delete(id: MatchId, actor: Option[AccountId]): F[Boolean] =
        liftK(alg.delete(id, actor))
      def find(id: MatchId): F[Option[MatchRecord]] = liftK(alg.find(id))
      def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: MatchNoInEvent): F[Boolean] =
        liftK(alg.existsMatchNo(heldEventId, matchNoInEvent))
      def existsMatchNoExcept(
          heldEventId: HeldEventId,
          matchNoInEvent: MatchNoInEvent,
          excludeMatchId: MatchId,
      ): F[Boolean] = liftK(alg.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId))

end MatchesRepository
