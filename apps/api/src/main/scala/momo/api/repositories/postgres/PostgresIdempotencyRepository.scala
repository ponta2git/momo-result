package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.kernel.MonadCancelThrow
import doobie.*

import momo.api.db.Database
import momo.api.domain.ids.MemberId
import momo.api.repositories.{IdempotencyAlg, IdempotencyRecord, IdempotencyRepository}

/**
 * Postgres-backed [[IdempotencyAlg]] **stub** for Phase 4-d.
 *
 * The schema for `idempotency_keys` is owned by the summit app (see
 * `apps/api/docs/proposals/idempotency-keys.md` for the proposed DDL and rollout order). Until
 * that migration lands, every operation here is intentionally unimplemented — the alg is a
 * placeholder that compiles, threads through the Phase 3 facade conventions, and lets the wiring
 * layer adopt the type without committing to a specific SQL shape.
 *
 * NOTE(idempotency-keys schema): this entire object MUST be filled in once the summit-side
 * migration is merged. The intended SQL skeleton is sketched in the proposal doc.
 */
object PostgresIdempotency:

  /** The alg-level effect is `ConnectionIO` so callers can compose with other repository ops. */
  val alg: IdempotencyAlg[ConnectionIO] = new IdempotencyAlg[ConnectionIO]:
    private def notImplemented[A](op: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
      .raiseError[A](new UnsupportedOperationException(
        s"PostgresIdempotency.$op is not yet implemented; see apps/api/docs/proposals/idempotency-keys.md"
      ))

    override def lookup(
        key: String,
        memberId: MemberId,
        endpoint: String,
    ): ConnectionIO[Option[IdempotencyRecord]] = notImplemented("lookup")

    override def record(entry: IdempotencyRecord): ConnectionIO[Unit] = notImplemented("record")

    override def cleanup(now: Instant): ConnectionIO[Int] = notImplemented("cleanup")
end PostgresIdempotency

/**
 * Class facade matching the Phase 3 convention. Exists so future wiring can simply construct
 * `new PostgresIdempotencyRepository(xa)` without learning a new shape; once the alg is
 * implemented this class will start working transparently.
 */
final class PostgresIdempotencyRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends IdempotencyRepository[F]:
  private val delegate: IdempotencyRepository[F] = IdempotencyRepository
    .fromConnectionIO(PostgresIdempotency.alg, Database.transactK(transactor))

  override def lookup(
      key: String,
      memberId: MemberId,
      endpoint: String,
  ): F[Option[IdempotencyRecord]] = delegate.lookup(key, memberId, endpoint)
  override def record(entry: IdempotencyRecord): F[Unit] = delegate.record(entry)
  override def cleanup(now: Instant): F[Int] = delegate.cleanup(now)
end PostgresIdempotencyRepository
