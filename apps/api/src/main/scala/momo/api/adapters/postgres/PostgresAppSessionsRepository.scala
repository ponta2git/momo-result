package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.AccountId
import momo.api.repositories.{AppSession, AppSessionsAlg, AppSessionsRepository}

/**
 * Postgres-backed [[AppSessionsAlg]]. The class facade preserves
 * `new PostgresAppSessionsRepository(xa)` wiring while exposing a tx-agnostic algebra.
 */
object PostgresAppSessions:
  private final case class AppSessionRow(
      idHash: String,
      accountId: AccountId,
      playerMemberId: Option[momo.api.domain.ids.MemberId],
      csrfSecretHash: String,
      createdAt: Instant,
      lastSeenAt: Instant,
      expiresAt: Instant,
  )

  private def selectAll(using ids: PostgresIdentities) = fr"""
    SELECT s.id_hash, ${ids.wireReference(Entity.Accounts, fr"s.account_id")},
           ${ids.retainedColumn("s", "member_id")},
           s.csrf_secret_hash, s.created_at, s.last_seen_at, s.expires_at
    FROM app_sessions s
  """

  private def fromRow(row: AppSessionRow): AppSession = AppSession(
    idHash = row.idHash,
    accountId = row.accountId,
    playerMemberId = row.playerMemberId,
    csrfSecretHash = row.csrfSecretHash,
    createdAt = row.createdAt,
    lastSeenAt = row.lastSeenAt,
    expiresAt = row.expiresAt,
  )

  def alg(using ids: PostgresIdentities): AppSessionsAlg[ConnectionIO] =
    new AppSessionsAlg[ConnectionIO]:
      override def find(idHash: String): ConnectionIO[Option[AppSession]] =
        (selectAll ++ fr"WHERE id_hash = $idHash").query[AppSessionRow].option.map(_.map(fromRow))

      override def upsert(session: AppSession): ConnectionIO[Unit] =
        for
          account <- ids.requireReference(Entity.Accounts, session.accountId.value)
          member <- ids.retainedValue(Entity.Members, session.playerMemberId.map(_.value))
          _ <- sql"""
        INSERT INTO app_sessions
          (id_hash, account_id, member_id ${ids.legacyColumn("member_id")},
           csrf_secret_hash, created_at, last_seen_at, expires_at)
        VALUES
          (${session.idHash}, $account, $member ${ids.legacyValue(
              session.playerMemberId.map(_.value)
            )},
           ${session.csrfSecretHash},
           ${session.createdAt}, ${session.lastSeenAt}, ${session.expiresAt})
        ON CONFLICT (id_hash) DO UPDATE SET
          account_id   = EXCLUDED.account_id,
          member_id    = EXCLUDED.member_id
            ${ids.legacySet("member_id", fr"EXCLUDED.legacy_member_id")},
          csrf_secret_hash = EXCLUDED.csrf_secret_hash,
          last_seen_at = EXCLUDED.last_seen_at,
          expires_at   = EXCLUDED.expires_at
      """.update.run
        yield ()

      override def delete(idHash: String): ConnectionIO[Unit] =
        sql"DELETE FROM app_sessions WHERE id_hash = $idHash".update.run.void

      override def deleteByAccount(accountId: AccountId): ConnectionIO[Int] =
        sql"DELETE FROM app_sessions WHERE account_id = ${ids.lookup(Entity.Accounts, accountId.value)}".update.run

      override def renew(
          idHash: String,
          lastSeenAt: Instant,
          expiresAt: Instant,
      ): ConnectionIO[Unit] = sql"""
        UPDATE app_sessions
        SET last_seen_at = GREATEST(last_seen_at, $lastSeenAt),
            expires_at = GREATEST(expires_at, $expiresAt)
        WHERE id_hash = $idHash
      """.update.run.void

      override def deleteExpired(now: Instant): ConnectionIO[Int] =
        sql"DELETE FROM app_sessions WHERE expires_at < $now".update.run
end PostgresAppSessions

final class PostgresAppSessionsRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends AppSessionsRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: AppSessionsRepository[F] = AppSessionsRepository
    .fromAlg(PostgresAppSessions.alg, transactor.trans)

  export delegate.*
end PostgresAppSessionsRepository
