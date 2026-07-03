package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.repositories.{AppSession, SessionAccount, SessionAccountLookup}

final class PostgresSessionAccountLookup[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SessionAccountLookup[F]:
  import PostgresSessionAccountLookup.*

  override def find(idHash: String): F[Option[SessionAccount]] = sql"""
      SELECT
        s.id_hash,
        s.account_id,
        s.member_id,
        s.csrf_secret_hash,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        a.id,
        a.discord_user_id,
        a.display_name,
        a.player_member_id,
        a.login_enabled,
        a.is_admin,
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
      isAdmin: Boolean,
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
      isAdmin = row.isAdmin,
      createdAt = row.accountCreatedAt,
      updatedAt = row.updatedAt,
    ),
  )
