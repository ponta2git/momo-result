package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.AccountId

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
    accountId: AccountId,
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

enum IdempotencyReservation derives CanEqual:
  case Reserved
  case Replay(response: IdempotencyResponse)
  case InProgress
  case Conflict

/**
 * Pure algebra for the `idempotency_keys` table. Mirrors the `HeldEventsAlg` shape so the same
 * `fromConnectionIO` / `liftIdentity` patterns work.
 *
 * `F0` is `ConnectionIO` for Postgres and the user effect `F` for the in-memory adapter.
 */
trait IdempotencyAlg[F0[_]]:

  /** Look up a stored record by its full composite key. */
  def lookup(key: String, accountId: AccountId, endpoint: String): F0[Option[IdempotencyRecord]]

  /**
   * Persist the supplied record. Implementations MUST treat `(key, accountId, endpoint)` as the
   * primary key and surface the conflict (e.g. via raised error or returned `false`); higher
   * layers translate that into [[IdempotencyOutcome.Conflict]].
   */
  def record(entry: IdempotencyRecord): F0[Unit]

  /**
   * Atomically reserve the composite key before the API executes the side effect.
   *
   * A reserved row uses `response_status = 0` and an empty body. Existing rows with the same request
   * hash and `response_status = 0` are treated as in-flight; rows with a completed response replay.
   */
  def reserve(entry: IdempotencyRecord): F0[IdempotencyReservation]

  def complete(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
      response: IdempotencyResponse,
  ): F0[Unit]

  def abandon(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
  ): F0[Unit]

  /**
   * Delete records whose `expires_at` is at or before `now`. Returns the number of deleted rows.
   */
  def cleanup(now: Instant): F0[Int]
end IdempotencyAlg

/** Transactional facade over [[IdempotencyAlg]], parameterised by the user effect `F`. */
trait IdempotencyRepository[F[_]]:
  def lookup(key: String, accountId: AccountId, endpoint: String): F[Option[IdempotencyRecord]]
  def record(entry: IdempotencyRecord): F[Unit]
  def reserve(entry: IdempotencyRecord): F[IdempotencyReservation]
  def complete(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
      response: IdempotencyResponse,
  ): F[Unit]
  def abandon(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
  ): F[Unit]
  def cleanup(now: Instant): F[Int]

object IdempotencyRepository:

  /** Postgres facade: lift each Alg op into `F` via the supplied tx boundary. */
  def fromConnectionIO[F[_]](
      alg: IdempotencyAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): IdempotencyRepository[F] = new IdempotencyRepository[F]:
    def lookup(key: String, accountId: AccountId, endpoint: String): F[Option[IdempotencyRecord]] =
      transactK(alg.lookup(key, accountId, endpoint))
    def record(entry: IdempotencyRecord): F[Unit] = transactK(alg.record(entry))
    def reserve(entry: IdempotencyRecord): F[IdempotencyReservation] = transactK(alg.reserve(entry))
    def complete(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
        response: IdempotencyResponse,
    ): F[Unit] = transactK(alg.complete(key, accountId, endpoint, requestHash, response))
    def abandon(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
    ): F[Unit] = transactK(alg.abandon(key, accountId, endpoint, requestHash))
    def cleanup(now: Instant): F[Int] = transactK(alg.cleanup(now))

  /** InMemory facade: the algebra already runs in `F`, so the lift is identity. */
  def liftIdentity[F[_]](alg: IdempotencyAlg[F]): IdempotencyRepository[F] =
    new IdempotencyRepository[F]:
      export alg.*
end IdempotencyRepository
