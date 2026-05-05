package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.MemberId

/**
 * Stable response snapshot kept under one idempotency key. Bytes are returned as-is so the HTTP
 * layer can replay binary payloads (CSV, etc.) without re-serialising.
 *
 * `headers` MUST NOT contain authorization, cookies or any secret material — the producer is
 * responsible for filtering before calling [[IdempotencyAlg.record]].
 */
final case class IdempotencyResponse(status: Int, headers: Map[String, String], body: Vector[Byte])

object IdempotencyResponse:
  given CanEqual[IdempotencyResponse, IdempotencyResponse] = CanEqual.derived

/**
 * One persisted record. Equality is structural so the in-memory adapter can be tested with simple
 * value comparisons.
 */
final case class IdempotencyRecord(
    key: String,
    memberId: MemberId,
    endpoint: String,
    requestHash: Vector[Byte],
    response: IdempotencyResponse,
    createdAt: Instant,
    expiresAt: Instant,
)

object IdempotencyRecord:
  given CanEqual[IdempotencyRecord, IdempotencyRecord] = CanEqual.derived

/** Outcome of a [[IdempotencyAlg.tryStore]] call. */
enum IdempotencyOutcome derives CanEqual:

  /** No record existed — the API may proceed to perform the side-effect. */
  case Fresh

  /** A record with the same hash existed — replay [[IdempotencyResponse]]. */
  case Replay(response: IdempotencyResponse)

  /** A record with a different hash existed — fail the request with HTTP 409. */
  case Conflict

/**
 * Pure algebra for the `idempotency_keys` table. Mirrors the `HeldEventsAlg` shape so the same
 * `fromConnectionIO` / `liftIdentity` patterns work.
 *
 * `F0` is `ConnectionIO` for Postgres and the user effect `F` for the in-memory adapter.
 */
trait IdempotencyAlg[F0[_]]:

  /** Look up a stored record by its full composite key. */
  def lookup(key: String, memberId: MemberId, endpoint: String): F0[Option[IdempotencyRecord]]

  /**
   * Persist the supplied record. Implementations MUST treat `(key, memberId, endpoint)` as the
   * primary key and surface the conflict (e.g. via raised error or returned `false`); higher
   * layers translate that into [[IdempotencyOutcome.Conflict]].
   */
  def record(entry: IdempotencyRecord): F0[Unit]

  /**
   * Delete records whose `expires_at` is at or before `now`. Returns the number of deleted rows.
   */
  def cleanup(now: Instant): F0[Int]
end IdempotencyAlg

/**
 * Transactional facade over [[IdempotencyAlg]], parameterised by the user effect `F`.
 *
 * Phase 4-d intentionally keeps this **un-wired** — no `Main.scala` references it yet. Wiring is
 * Phase 5 work, gated on the summit-side schema migration described in
 * `apps/api/docs/proposals/idempotency-keys.md`.
 */
trait IdempotencyRepository[F[_]]:
  def lookup(key: String, memberId: MemberId, endpoint: String): F[Option[IdempotencyRecord]]
  def record(entry: IdempotencyRecord): F[Unit]
  def cleanup(now: Instant): F[Int]

object IdempotencyRepository:

  /** Postgres facade: lift each Alg op into `F` via the supplied tx boundary. */
  def fromConnectionIO[F[_]](
      alg: IdempotencyAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): IdempotencyRepository[F] = new IdempotencyRepository[F]:
    def lookup(key: String, memberId: MemberId, endpoint: String): F[Option[IdempotencyRecord]] =
      transactK(alg.lookup(key, memberId, endpoint))
    def record(entry: IdempotencyRecord): F[Unit] = transactK(alg.record(entry))
    def cleanup(now: Instant): F[Int] = transactK(alg.cleanup(now))

  /** InMemory facade: the algebra already runs in `F`, so the lift is identity. */
  def liftIdentity[F[_]](alg: IdempotencyAlg[F]): IdempotencyRepository[F] =
    new IdempotencyRepository[F]:
      export alg.*
end IdempotencyRepository
