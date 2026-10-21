package momo.api.adapters.postgres

import java.time.Instant
import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresIdempotency.*
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.AccountId
import momo.api.repositories.{
  IdempotencyAlg,
  IdempotencyRecord,
  IdempotencyReservation,
  IdempotencyResponse
}

/** The retained raw-key namespace and the fresh UUID namespace never merge saved operations. */
private[postgres] object CanonicalPostgresIdempotency:
  private val Identities = PostgresIdentities.Canonical

  private def legacyLookup(
      key: String,
      account: AccountId,
      endpoint: String,
  ): ConnectionIO[Option[IdempotencyRecord]] = sql"""
    SELECT key, account_id, endpoint, request_hash, response_status,
           response_headers, response_body, created_at, expires_at
    FROM idempotency_keys_legacy
    WHERE key = $key AND account_id = $account AND endpoint = $endpoint
  """.query[Row].option.map(_.map(toRecord))

  private def uuidLookup(
      key: UUID,
      account: AccountId,
      endpoint: String,
  ): ConnectionIO[Option[IdempotencyRecord]] = sql"""
    SELECT replay.key::text, account.legacy_id, replay.endpoint, replay.request_hash,
           replay.response_status, replay.response_headers, replay.response_body,
           replay.created_at, replay.expires_at
    FROM idempotency_keys replay
    JOIN momo_login_accounts account ON account.id = replay.account_id
    WHERE replay.key = $key AND account.legacy_id = $account AND replay.endpoint = $endpoint
  """.query[Row].option.map(_.map(toRecord))

  private def conflictingLegacySpelling(
      rawKey: String,
      key: UUID,
      account: AccountId,
      endpoint: String,
  ): ConnectionIO[Boolean] =
    val pattern = CanonicalIdentity.UuidPattern
    val hex = key.toString.replace("-", "")
    // Compare normalized hexadecimal only after checking PostgreSQL's UUID spelling grammar.
    // No cast is attempted on a retained key, including malformed or non-UUID historical keys.
    sql"""SELECT EXISTS (
      SELECT 1 FROM idempotency_keys_legacy
      WHERE account_id = $account AND endpoint = $endpoint AND key <> $rawKey
        AND key ~ $pattern
        AND lower(regexp_replace(key, '[{}-]', '', 'g')) = $hex
    )""".query[Boolean].unique

  private def activeCount(account: AccountId, now: Instant): ConnectionIO[Long] = sql"""
    SELECT
      (SELECT count(*) FROM idempotency_keys_legacy
       WHERE account_id = $account AND expires_at > $now)
      + (SELECT count(*) FROM idempotency_keys
         WHERE account_id = ${Identities.lookup(
      Entity.Accounts,
      account.value
    )} AND expires_at > $now)
  """.query[Long].unique

  private def insert(entry: IdempotencyRecord, key: UUID): ConnectionIO[IdempotencyReservation] =
    val hash = bytesToArray(entry.requestHash)
    val headers = headersToJson(entry.response.headers)
    Identities.requireReference(Entity.Accounts, entry.accountId.value).flatMap { account =>
      sql"""
        INSERT INTO idempotency_keys
          (key, account_id, endpoint, request_hash, response_status,
           response_headers, response_body, created_at, expires_at)
        VALUES ($key, $account, ${entry.endpoint}, $hash, ${entry.response.status},
                $headers, ${Option.empty[Array[Byte]]}, ${entry.createdAt}, ${entry.expiresAt})
        ON CONFLICT (key, account_id, endpoint) DO NOTHING
      """.update.run.flatMap {
        case 1 => IdempotencyReservation.Reserved.pure[ConnectionIO]
        case _ => uuidLookup(key, entry.accountId, entry.endpoint).map {
            case Some(existing) => classifyExisting(existing, entry)
            case None => IdempotencyReservation.InProgress
          }
      }
    }

  private def reserveFresh(
      entry: IdempotencyRecord,
      now: Instant,
      limit: Int,
  ): ConnectionIO[IdempotencyReservation] = CanonicalIdentity.uuid(entry.key) match
    case None =>
      IdempotencyReservation.InvalidKey("Idempotency-Key must be a UUID for a new request.")
        .pure[ConnectionIO]
    case Some(key) => conflictingLegacySpelling(entry.key, key, entry.accountId, entry.endpoint)
        .flatMap {
          case true => IdempotencyReservation.LegacyAliasConflict.pure[ConnectionIO]
          case false => uuidLookup(key, entry.accountId, entry.endpoint).flatMap {
              case Some(existing) => classifyExisting(existing, entry).pure[ConnectionIO]
              case None => activeCount(entry.accountId, now).flatMap { count =>
                  if count >= limit.toLong then
                    IdempotencyReservation.AccountLimitExceeded.pure[ConnectionIO]
                  else insert(entry, key)
                }
            }
        }

  private final case class Target(table: Fragment, key: Fragment, account: Fragment)

  private def target(
      key: String,
      account: AccountId,
      endpoint: String,
  ): ConnectionIO[Option[Target]] = sql"""SELECT EXISTS (
    SELECT 1 FROM idempotency_keys_legacy
    WHERE key = $key AND account_id = $account AND endpoint = $endpoint
  )""".query[Boolean].unique.map {
    case true => Some(Target(fr"idempotency_keys_legacy", fr"$key", fr"$account"))
    case false => CanonicalIdentity.uuid(key).map(value =>
        Target(fr"idempotency_keys", fr"$value", Identities.lookup(Entity.Accounts, account.value))
      )
  }

  private def bounded(update: Update0): ConnectionIO[Unit] =
    update.runAlteringExecution(execution =>
      execution.copy(prep = doobie.free.preparedstatement.setQueryTimeout(1) *> execution.prep)
    ).void

  val alg: IdempotencyAlg[ConnectionIO] = new IdempotencyAlg[ConnectionIO]:
    override def lookup(
        key: String,
        accountId: AccountId,
        endpoint: String,
    ): ConnectionIO[Option[IdempotencyRecord]] = legacyLookup(key, accountId, endpoint).flatMap {
      case some @ Some(_) => some.pure[ConnectionIO]
      case None => CanonicalIdentity.uuid(key).traverse { parsed =>
          conflictingLegacySpelling(key, parsed, accountId, endpoint).flatMap {
            case true => none[IdempotencyRecord].pure[ConnectionIO]
            case false => uuidLookup(parsed, accountId, endpoint)
          }
        }.map(_.flatten)
    }

    override def reserveWithinAccountLimit(
        entry: IdempotencyRecord,
        now: Instant,
        activeKeyLimitPerAccount: Int,
    ): ConnectionIO[IdempotencyReservation] = lockAccount(entry.accountId) *>
      legacyLookup(entry.key, entry.accountId, entry.endpoint).flatMap {
        case Some(existing) => classifyExisting(existing, entry).pure[ConnectionIO]
        case None => reserveFresh(entry, now, activeKeyLimitPerAccount)
      }

    override def complete(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
        response: IdempotencyResponse,
    ): ConnectionIO[Unit] =
      val hash = bytesToArray(requestHash)
      val headers = headersToJson(response.headers)
      val body = Some(bytesToArray(response.body))
      target(key, accountId, endpoint).flatMap(_.traverse_ { selected =>
        bounded(sql"""
          UPDATE ${selected.table}
          SET response_status = ${response.status}, response_headers = $headers, response_body = $body
          WHERE key = ${selected.key} AND account_id = ${selected.account}
            AND endpoint = $endpoint AND request_hash = $hash
        """.update)
      })

    override def abandon(
        key: String,
        accountId: AccountId,
        endpoint: String,
        requestHash: Vector[Byte],
    ): ConnectionIO[Unit] =
      val hash = bytesToArray(requestHash)
      target(key, accountId, endpoint).flatMap(_.traverse_ { selected =>
        bounded(sql"""
          DELETE FROM ${selected.table}
          WHERE key = ${selected.key} AND account_id = ${selected.account}
            AND endpoint = $endpoint AND request_hash = $hash AND response_status = 0
        """.update)
      })

    override def cleanup(now: Instant): ConnectionIO[Int] = (
      sql"DELETE FROM idempotency_keys_legacy WHERE expires_at <= $now".update.run,
      sql"DELETE FROM idempotency_keys WHERE expires_at <= $now".update.run,
    ).mapN(_ + _)
