package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.repositories.{AppSession, SessionAccount, SessionAccountLookup}

final class PostgresSessionAccountLookup[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends SessionAccountLookup[F]:
  import PostgresSessionAccountLookup.*

  override def find(idHash: String): F[Option[SessionAccount]] = sql"""
      SELECT
        s.id_hash,
        ${identities.wireId("a")},
        ${identities.retainedColumn("s", "member_id")},
        s.csrf_secret_hash,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        ${identities.wireId("a")},
        a.discord_user_id,
        a.display_name,
        ${identities.wireReference(Entity.Members, fr"a.player_member_id")},
        a.login_enabled,
        a.role,
        a.created_at,
        a.updated_at
      FROM app_sessions s
      JOIN momo_login_accounts a ON a.id = s.account_id
      WHERE s.id_hash = $idHash
    """.query[SessionAccountRow].option.map(_.map(fromRow)).transact(transactor)

object PostgresSessionAccountLookup:
  private final case class SessionAccountRow(
      sessionIdHash: String,
      sessionAccountId: AccountId,
      sessionMemberId: Option[MemberId],
      csrfSecretHash: String,
      sessionCreatedAt: Instant,
      lastSeenAt: Instant,
      expiresAt: Instant,
      accountId: AccountId,
      discordUserId: UserId,
      displayName: String,
      accountPlayerMemberId: Option[MemberId],
      loginEnabled: Boolean,
      role: AccountRole,
      accountCreatedAt: Instant,
      updatedAt: Instant,
  )

  private def fromRow(row: SessionAccountRow): SessionAccount = SessionAccount(
    session = AppSession(
      idHash = row.sessionIdHash,
      accountId = row.sessionAccountId,
      playerMemberId = row.sessionMemberId,
      csrfSecretHash = row.csrfSecretHash,
      createdAt = row.sessionCreatedAt,
      lastSeenAt = row.lastSeenAt,
      expiresAt = row.expiresAt,
    ),
    account = LoginAccount(
      id = row.accountId,
      discordUserId = row.discordUserId,
      displayName = row.displayName,
      playerMemberId = row.accountPlayerMemberId,
      loginEnabled = row.loginEnabled,
      role = row.role,
      createdAt = row.accountCreatedAt,
      updatedAt = row.updatedAt,
    ),
  )
