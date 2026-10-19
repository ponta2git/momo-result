package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json
import io.circe.syntax.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.AccountId
import momo.api.repositories.{
  IdempotencyAlg,
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyReservation,
  IdempotencyResponse
}

/**
 * Postgres-backed [[IdempotencyAlg]].
 *
 * Schema is owned by momo-db. The repository uses the `(key, account_id, endpoint)` composite key
 * and stores the request hash, response snapshot, and expiry timestamps defined by that schema.
 */
object PostgresIdempotency:

  private def headersToJson(headers: Map[String, String]): Json = headers.asJson

  private def headersFromJson(json: Json): Map[String, String] = json.as[Map[String, String]]
    .getOrElse(Map.empty)

  private def bytesToArray(bytes: Vector[Byte]): Array[Byte] = bytes.toArray

  private def arrayToBytes(bytes: Array[Byte]): Vector[Byte] = bytes.toVector

  private final case class Row(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Array[Byte],
      responseStatus: Int,
      responseHeaders: Json,
      responseBody: Option[Array[Byte]],
      createdAt: Instant,
      expiresAt: Instant,
  )

  private def toRecord(row: Row): IdempotencyRecord = IdempotencyRecord(
    key = row.key,
    accountId = row.accountId,
    endpoint = row.endpoint,
    requestHash = arrayToBytes(row.requestHash),
    response = IdempotencyResponse(
      status = row.responseStatus,
      headers = headersFromJson(row.responseHeaders),
      body = row.responseBody.fold(Vector.empty[Byte])(arrayToBytes),
    ),
    createdAt = row.createdAt,
    expiresAt = row.expiresAt,
  )

  private def classifyExisting(
      existing: IdempotencyRecord,
      entry: IdempotencyRecord,
  ): IdempotencyReservation =
    if existing.requestHash != entry.requestHash then IdempotencyReservation.Conflict
    else if existing.response.status == 0 then IdempotencyReservation.InProgress
    else IdempotencyReservation.Replay(existing.response)

  private def lockAccount(accountId: AccountId): ConnectionIO[Unit] = sql"""
        SELECT pg_advisory_xact_lock(hashtext(${accountId.value}), 0)
      """.query[Unit].unique.void

  private def activeKeyCount(accountId: AccountId, now: Instant): ConnectionIO[Long] = sql"""
        SELECT count(*)
        FROM idempotency_keys
        WHERE account_id = $accountId
          AND expires_at > $now
      """.query[Long].unique

  private def insertPending(entry: IdempotencyRecord): ConnectionIO[IdempotencyReservation] =
    val hashArray = bytesToArray(entry.requestHash)
    val headersJson = headersToJson(entry.response.headers)
    sql"""
        INSERT INTO idempotency_keys (
          key, account_id, endpoint, request_hash, response_status,
          response_headers, response_body, created_at, expires_at
        ) VALUES (
          ${entry.key}, ${entry.accountId}, ${entry.endpoint}, $hashArray,
          ${entry.response.status}, $headersJson, ${Option.empty[Array[Byte]]},
          ${entry.createdAt}, ${entry.expiresAt}
        )
        ON CONFLICT (key, account_id, endpoint) DO NOTHING
      """.update.run.flatMap {
      case 1 => IdempotencyReservation.Reserved.pure[ConnectionIO]
      case _ => sql"""
          SELECT key, account_id, endpoint, request_hash, response_status,
                 response_headers, response_body, created_at, expires_at
          FROM idempotency_keys
          WHERE key = ${entry.key}
            AND account_id = ${entry.accountId}
            AND endpoint = ${entry.endpoint}
        """.query[Row].option.map {
          case Some(existing) => classifyExisting(toRecord(existing), entry)
          case None => IdempotencyReservation.InProgress
        }
    }

  val alg: IdempotencyAlg[ConnectionIO] = new IdempotencyAlg[ConnectionIO]:
    override def lookup(
        key: String,
        accountId: AccountId,
        endpoint: String,
    ): ConnectionIO[Option[IdempotencyRecord]] = sql"""
        SELECT key, account_id, endpoint, request_hash, response_status,
               response_headers, response_body, created_at, expires_at
        FROM idempotency_keys
        WHERE key = $key AND account_id = $accountId AND endpoint = $endpoint
      """.query[Row].option.map(_.map(toRecord))

    override def reserveWithinAccountLimit(
        entry: IdempotencyRecord,
        now: Instant,
        activeKeyLimitPerAccount: Int,
    ): ConnectionIO[IdempotencyReservation] = lockAccount(entry.accountId) *>
      lookup(entry.key, entry.accountId, entry.endpoint).flatMap {
        case Some(existing) => classifyExisting(existing, entry).pure[ConnectionIO]
        case None => activeKeyCount(entry.accountId, now).flatMap { activeCount =>
            if activeCount >= activeKeyLimitPerAccount.toLong then
              IdempotencyReservation.AccountLimitExceeded.pure[ConnectionIO]
            else insertPending(entry)
          }
      }

    override def complete(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
        response: IdempotencyResponse,
    ): ConnectionIO[Unit] =
      val hashArray = bytesToArray(requestHash)
      val bodyOpt: Option[Array[Byte]] =
        if response.body.isEmpty then Some(Array.emptyByteArray)
        else Some(bytesToArray(response.body))
      val headersJson = headersToJson(response.headers)
      sql"""
        UPDATE idempotency_keys
        SET response_status = ${response.status},
            response_headers = $headersJson,
            response_body = $bodyOpt
        WHERE key = $key
          AND account_id = $accountId
          AND endpoint = $endpoint
          AND request_hash = $hashArray
      """.update.runAlteringExecution(execution =>
        execution.copy(
          prep = doobie.free.preparedstatement.setQueryTimeout(1) *> execution.prep
        )
      ).void

    override def abandon(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
    ): ConnectionIO[Unit] =
      val hashArray = bytesToArray(requestHash)
      sql"""
        DELETE FROM idempotency_keys
        WHERE key = $key
          AND account_id = $accountId
          AND endpoint = $endpoint
          AND request_hash = $hashArray
          AND response_status = 0
      """.update.runAlteringExecution(execution =>
        execution.copy(
          prep = doobie.free.preparedstatement.setQueryTimeout(1) *> execution.prep
        )
      ).void

    override def cleanup(now: Instant): ConnectionIO[Int] = sql"""
        DELETE FROM idempotency_keys WHERE expires_at <= $now
      """.update.run
end PostgresIdempotency

/** Transactor-backed facade for [[IdempotencyRepository]]; each operation runs in a transaction. */
final class PostgresIdempotencyRepository[F[_]: Async](transactor: Transactor[F])
    extends IdempotencyRepository[F]:
  private val delegate: IdempotencyRepository[F] = IdempotencyRepository
    .fromAlg(PostgresIdempotency.alg, transactor.trans)

  export delegate.{lookup, reserveWithinAccountLimit, cleanup}

  private val directExecutor: java.util.concurrent.Executor = command => command.run()
  private val recordingTransactor = transactor.copy(connect0 =
    kernel =>
      transactor.connect(kernel).flatMap { connection =>
        Resource.make(Async[F].blocking(connection.getNetworkTimeout)) { previous =>
          Async[F].blocking {
            if !connection.isClosed then connection.setNetworkTimeout(directExecutor, previous)
          }
        }.evalTap { previous =>
          val bounded = if previous > 0 then math.min(previous, 2000) else 2000
          Async[F].blocking(connection.setNetworkTimeout(directExecutor, bounded))
        }.as(connection)
      }
  )

  // Bound both SQL lock waits and a lost network response, including commit/rollback. The
  // borrowed connection's original network timeout is restored before it returns to the pool.
  override def complete(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
      response: IdempotencyResponse,
  ): F[Unit] = PostgresIdempotency.alg.complete(key, accountId, endpoint, requestHash, response)
    .transact(recordingTransactor)

  override def abandon(
      key: String,
      accountId: AccountId,
      endpoint: String,
      requestHash: Vector[Byte],
  ): F[Unit] = PostgresIdempotency.alg.abandon(key, accountId, endpoint, requestHash)
    .transact(recordingTransactor)
end PostgresIdempotencyRepository
