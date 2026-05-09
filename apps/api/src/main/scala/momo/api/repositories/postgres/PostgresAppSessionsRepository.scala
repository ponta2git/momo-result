package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.ids.AccountId
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{AppSession, AppSessionsAlg, AppSessionsRepository}

/**
 * Postgres-backed [[AppSessionsAlg]]. The class facade preserves
 * `new PostgresAppSessionsRepository(xa)` wiring while exposing a tx-agnostic algebra.
 */
object PostgresAppSessions:

  val alg: AppSessionsAlg[ConnectionIO] = new AppSessionsAlg[ConnectionIO]:
    override def find(id: String): ConnectionIO[Option[AppSession]] = sql"""
        SELECT id, account_id, member_id, csrf_secret, created_at, last_seen_at, expires_at
        FROM app_sessions
        WHERE id = $id
      """.query[AppSession].option

    override def upsert(session: AppSession): ConnectionIO[Unit] = sql"""
        INSERT INTO app_sessions
          (id, account_id, member_id, csrf_secret, created_at, last_seen_at, expires_at)
        VALUES
          (${session.id}, ${session.accountId}, ${session.playerMemberId}, ${session.csrfSecret},
           ${session.createdAt}, ${session.lastSeenAt}, ${session.expiresAt})
        ON CONFLICT (id) DO UPDATE SET
          account_id   = EXCLUDED.account_id,
          member_id    = EXCLUDED.member_id,
          csrf_secret  = EXCLUDED.csrf_secret,
          last_seen_at = EXCLUDED.last_seen_at,
          expires_at   = EXCLUDED.expires_at
      """.update.run.void

    override def delete(id: String): ConnectionIO[Unit] =
      sql"DELETE FROM app_sessions WHERE id = $id".update.run.void

    override def deleteByAccount(accountId: AccountId): ConnectionIO[Int] =
      sql"DELETE FROM app_sessions WHERE account_id = $accountId".update.run

    override def touchLastSeen(id: String, lastSeenAt: Instant): ConnectionIO[Unit] =
      sql"UPDATE app_sessions SET last_seen_at = $lastSeenAt WHERE id = $id".update.run.void

    override def deleteExpired(now: Instant): ConnectionIO[Int] =
      sql"DELETE FROM app_sessions WHERE expires_at < $now".update.run
end PostgresAppSessions

/** Backwards-compatible class facade. */
final class PostgresAppSessionsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends AppSessionsRepository[F]:
  private val delegate: AppSessionsRepository[F] = AppSessionsRepository
    .fromConnectionIO(PostgresAppSessions.alg, Database.transactK(transactor))

  export delegate.*
end PostgresAppSessionsRepository
