package momo.api.adapters

import java.time.Instant

import cats.MonadThrow
import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.MemberId
import momo.api.repositories.{IdempotencyAlg, IdempotencyRecord, IdempotencyRepository}

/**
 * In-memory adapter for [[IdempotencyRepository]]. Used by tests and by future local development
 * runs. Conflicts on the composite primary key are surfaced via `IllegalStateException`, mirroring
 * what the Postgres `unique_violation` raise will look like at the call site.
 *
 * Phase 4-d note: this is **not yet wired** into `Main.scala`. See
 * `apps/api/docs/proposals/idempotency-keys.md` for the rollout plan.
 */
final class InMemoryIdempotencyRepository[F[_]: MonadThrow] private (
    ref: Ref[F, Map[InMemoryIdempotencyRepository.Key, IdempotencyRecord]]
) extends IdempotencyRepository[F]:
  private val alg: IdempotencyAlg[F] = new IdempotencyAlg[F]:
    override def lookup(
        key: String,
        memberId: MemberId,
        endpoint: String,
    ): F[Option[IdempotencyRecord]] = ref.get
      .map(_.get(InMemoryIdempotencyRepository.Key(key, memberId, endpoint)))

    override def record(entry: IdempotencyRecord): F[Unit] =
      val pk = InMemoryIdempotencyRepository.Key(entry.key, entry.memberId, entry.endpoint)
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

    override def cleanup(now: Instant): F[Int] = ref.modify { state =>
      val (expired, kept) = state.partition { case (_, r) => !r.expiresAt.isAfter(now) }
      (kept, expired.size)
    }

  private val delegate: IdempotencyRepository[F] = IdempotencyRepository.liftIdentity(alg)

  override def lookup(
      key: String,
      memberId: MemberId,
      endpoint: String,
  ): F[Option[IdempotencyRecord]] = delegate.lookup(key, memberId, endpoint)
  override def record(entry: IdempotencyRecord): F[Unit] = delegate.record(entry)
  override def cleanup(now: Instant): F[Int] = delegate.cleanup(now)
end InMemoryIdempotencyRepository

object InMemoryIdempotencyRepository:
  private[adapters] final case class Key(key: String, memberId: MemberId, endpoint: String)
      derives CanEqual

  def create[F[_]: Sync]: F[InMemoryIdempotencyRepository[F]] = Ref
    .of[F, Map[Key, IdempotencyRecord]](Map.empty).map(new InMemoryIdempotencyRepository(_))
end InMemoryIdempotencyRepository
