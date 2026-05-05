package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.kernel.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate
import io.circe.Json
import io.circe.syntax.*

import momo.api.db.Database
import momo.api.domain.ids.MemberId
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  IdempotencyAlg, IdempotencyRecord, IdempotencyRepository, IdempotencyResponse,
}

/**
 * Postgres-backed [[IdempotencyAlg]].
 *
 * Schema is owned by momo-summit (see `apps/api/docs/proposals/idempotency-keys.md`). The actual
 * applied DDL matches the proposal: `(key, member_id, endpoint)` composite PK,
 * `request_hash bytea`, `response_status int`, `response_headers jsonb`, `response_body bytea`,
 * `created_at`/`expires_at` `timestamptz`.
 *
 * `record` translates the unique-violation that occurs when the same composite PK is inserted
 * twice into a domain-level [[IdempotencyConflict]] error so the HTTP layer can return 409.
 */
object PostgresIdempotency:

  /** Surface a composite-PK conflict to the caller without inspecting JDBC-level types. */
  final class IdempotencyConflict(message: String) extends RuntimeException(message)

  private[postgres] def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def headersToJson(headers: Map[String, String]): Json = headers.asJson

  private def headersFromJson(json: Json): Map[String, String] = json.as[Map[String, String]]
    .getOrElse(Map.empty)

  private def bytesToArray(bytes: Vector[Byte]): Array[Byte] = bytes.toArray

  private def arrayToBytes(bytes: Array[Byte]): Vector[Byte] = bytes.toVector

  private type Row = (
      String, // key
      MemberId,
      String, // endpoint
      Array[Byte], // request_hash
      Int, // response_status
      Json, // response_headers
      Option[Array[Byte]], // response_body
      Instant, // created_at
      Instant, // expires_at
  )

  private def toRecord(row: Row): IdempotencyRecord = IdempotencyRecord(
    key = row._1,
    memberId = row._2,
    endpoint = row._3,
    requestHash = arrayToBytes(row._4),
    response = IdempotencyResponse(
      status = row._5,
      headers = headersFromJson(row._6),
      body = row._7.fold(Vector.empty[Byte])(arrayToBytes),
    ),
    createdAt = row._8,
    expiresAt = row._9,
  )

  val alg: IdempotencyAlg[ConnectionIO] = new IdempotencyAlg[ConnectionIO]:
    override def lookup(
        key: String,
        memberId: MemberId,
        endpoint: String,
    ): ConnectionIO[Option[IdempotencyRecord]] = sql"""
        SELECT key, member_id, endpoint, request_hash, response_status,
               response_headers, response_body, created_at, expires_at
        FROM idempotency_keys
        WHERE key = $key AND member_id = $memberId AND endpoint = $endpoint
      """.query[Row].option.map(_.map(toRecord))

    override def record(entry: IdempotencyRecord): ConnectionIO[Unit] =
      val hashArray = bytesToArray(entry.requestHash)
      val bodyOpt: Option[Array[Byte]] =
        if entry.response.body.isEmpty then None else Some(bytesToArray(entry.response.body))
      val headersJson = headersToJson(entry.response.headers)
      sql"""
        INSERT INTO idempotency_keys (
          key, member_id, endpoint, request_hash, response_status,
          response_headers, response_body, created_at, expires_at
        ) VALUES (
          ${entry.key}, ${entry.memberId}, ${entry.endpoint}, $hashArray,
          ${entry.response.status}, $headersJson, $bodyOpt,
          ${entry.createdAt}, ${entry.expiresAt}
        )
      """.update.run.void.exceptSomeSqlState {
        case state if PostgresIdempotency.isUniqueViolation(state) =>
          MonadThrow[ConnectionIO].raiseError[Unit](new IdempotencyConflict(
            s"idempotency record already exists for key=${entry.key} endpoint=${entry.endpoint}"
          ))
      }

    override def cleanup(now: Instant): ConnectionIO[Int] = sql"""
        DELETE FROM idempotency_keys WHERE expires_at <= $now
      """.update.run
end PostgresIdempotency

/**
 * Class facade matching the Phase 3 convention: construct with a `Transactor[F]`, get an
 * `IdempotencyRepository[F]`. Each operation runs inside its own transaction.
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
