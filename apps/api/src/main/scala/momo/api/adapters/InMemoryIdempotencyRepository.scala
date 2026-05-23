package momo.api.adapters

import java.time.Instant

import cats.MonadThrow
import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.AccountId
import momo.api.repositories.{
  IdempotencyAlg, IdempotencyRecord, IdempotencyRepository, IdempotencyReservation,
  IdempotencyResponse,
}

/**
 * In-memory adapter for [[IdempotencyRepository]]. Used by tests and local development runs.
 * Conflicts on the composite primary key are surfaced via `IllegalStateException`, mirroring what
 * the Postgres `unique_violation` raise will look like at the call site.
 */
final class InMemoryIdempotencyRepository[F[_]: MonadThrow] private (
    ref: Ref[F, Map[InMemoryIdempotencyRepository.Key, IdempotencyRecord]]
) extends IdempotencyRepository[F]:
  private val alg: IdempotencyAlg[F] = new IdempotencyAlg[F]:
    override def lookup(
        key: String,
        accountId: AccountId,
        endpoint: String,
    ): F[Option[IdempotencyRecord]] = ref.get
      .map(_.get(InMemoryIdempotencyRepository.Key(key, accountId, endpoint)))

    override def record(entry: IdempotencyRecord): F[Unit] =
      val pk = InMemoryIdempotencyRepository.Key(entry.key, entry.accountId, entry.endpoint)
      ref.modify { state =>
        state.get(pk) match
          case Some(existing) => (state, Left(existing))
          case None => (state.updated(pk, entry), Right(()))
      }.flatMap {
        case Right(_) => MonadThrow[F].unit
        case Left(_) => MonadThrow[F].raiseError(new IllegalStateException(
            s"idempotency record already exists for key=${entry.key} endpoint=${entry.endpoint}"
          ))
      }

    override def reserve(entry: IdempotencyRecord): F[IdempotencyReservation] =
      val pk = InMemoryIdempotencyRepository.Key(entry.key, entry.accountId, entry.endpoint)
      ref.modify { state =>
        state.get(pk) match
          case None => (state.updated(pk, entry), IdempotencyReservation.Reserved)
          case Some(existing) if existing.requestHash != entry.requestHash =>
            (state, IdempotencyReservation.Conflict)
          case Some(existing) if existing.response.status == 0 =>
            (state, IdempotencyReservation.InProgress)
          case Some(existing) => (state, IdempotencyReservation.Replay(existing.response))
      }

    override def reserveWithinAccountLimit(
        entry: IdempotencyRecord,
        now: Instant,
        activeKeyLimitPerAccount: Int,
    ): F[IdempotencyReservation] =
      val pk = InMemoryIdempotencyRepository.Key(entry.key, entry.accountId, entry.endpoint)
      ref.modify { state =>
        state.get(pk) match
          case Some(existing) if existing.requestHash != entry.requestHash =>
            (state, IdempotencyReservation.Conflict)
          case Some(existing) if existing.response.status == 0 =>
            (state, IdempotencyReservation.InProgress)
          case Some(existing) => (state, IdempotencyReservation.Replay(existing.response))
          case None =>
            val activeCount = state.values
              .count(record => record.accountId == entry.accountId && record.expiresAt.isAfter(now))
            if activeCount >= activeKeyLimitPerAccount then
              (state, IdempotencyReservation.AccountLimitExceeded)
            else (state.updated(pk, entry), IdempotencyReservation.Reserved)
      }

    override def complete(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
        response: IdempotencyResponse,
    ): F[Unit] =
      val pk = InMemoryIdempotencyRepository.Key(key, accountId, endpoint)
      ref.update { state =>
        state.get(pk) match
          case Some(existing) if existing.requestHash == requestHash =>
            state.updated(pk, existing.copy(response = response))
          case _ => state
      }

    override def abandon(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
    ): F[Unit] =
      val pk = InMemoryIdempotencyRepository.Key(key, accountId, endpoint)
      ref.update { state =>
        state.get(pk) match
          case Some(existing)
              if existing.requestHash == requestHash && existing.response.status == 0 => state - pk
          case _ => state
      }

    override def cleanup(now: Instant): F[Int] = ref.modify { state =>
      val (expired, kept) = state.partition { case (_, r) => !r.expiresAt.isAfter(now) }
      (kept, expired.size)
    }

  private val delegate: IdempotencyRepository[F] = IdempotencyRepository.liftIdentity(alg)

  override def lookup(
      key: String,
      accountId: AccountId,
      endpoint: String,
  ): F[Option[IdempotencyRecord]] = delegate.lookup(key, accountId, endpoint)
  override def record(entry: IdempotencyRecord): F[Unit] = delegate.record(entry)
  override def reserve(entry: IdempotencyRecord): F[IdempotencyReservation] = delegate
    .reserve(entry)
  override def reserveWithinAccountLimit(
      entry: IdempotencyRecord,
      now: Instant,
      activeKeyLimitPerAccount: Int,
  ): F[IdempotencyReservation] = delegate
    .reserveWithinAccountLimit(entry, now, activeKeyLimitPerAccount)
  override def complete(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
      response: IdempotencyResponse,
  ): F[Unit] = delegate.complete(key, accountId, endpoint, requestHash, response)
  override def abandon(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
  ): F[Unit] = delegate.abandon(key, accountId, endpoint, requestHash)
  override def cleanup(now: Instant): F[Int] = delegate.cleanup(now)
end InMemoryIdempotencyRepository

object InMemoryIdempotencyRepository:
  private[adapters] final case class Key(key: String, accountId: AccountId, endpoint: String)
      derives CanEqual

  def create[F[_]: Sync]: F[InMemoryIdempotencyRepository[F]] = Ref
    .of[F, Map[Key, IdempotencyRecord]](Map.empty).map(new InMemoryIdempotencyRepository(_))
end InMemoryIdempotencyRepository
