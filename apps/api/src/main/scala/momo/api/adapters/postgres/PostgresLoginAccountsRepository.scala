package momo.api.adapters.postgres

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  AppSession,
  CreateLoginAccountData,
  LoginAccountAdministrationRepository,
  LoginAccountAdministrationUpdateResult,
  LoginAccountsAlg,
  LoginAccountsRepository,
  LoginSessionCreationRepository,
  UpdateLoginAccountData
}

private def isLoginAccountUniqueViolation(state: SqlState): Boolean = state.value ==
  sqlstate.class23.UNIQUE_VIOLATION.value

private def isLoginAccountForeignKeyViolation(state: SqlState): Boolean = state.value ==
  sqlstate.class23.FOREIGN_KEY_VIOLATION.value

private def raiseLoginAccountError[A](error: AppError): ConnectionIO[A] = MonadThrow[ConnectionIO]
  .raiseError[A](new AppException(error))

object PostgresLoginAccounts:
  private final case class LoginAccountRow(
      id: AccountId,
      discordUserId: UserId,
      displayName: String,
      playerMemberId: Option[momo.api.domain.ids.MemberId],
      loginEnabled: Boolean,
      role: AccountRole,
      createdAt: java.time.Instant,
      updatedAt: java.time.Instant,
  )

  private def columns(alias: String)(using ids: PostgresIdentities): Fragment =
    val profile = Fragment.const(s"$alias.discord_user_id, $alias.display_name")
    val state =
      Fragment.const(s"$alias.login_enabled, $alias.role, $alias.created_at, $alias.updated_at")
    fr"""${ids.wireId(alias)}, $profile,
           ${ids.wireReference(Entity.Members, Fragment.const(s"$alias.player_member_id"))},
           $state"""

  private def selectAll(using PostgresIdentities) =
    fr"SELECT ${columns("a")} FROM momo_login_accounts a"

  private def returningAll(using PostgresIdentities) =
    fr"RETURNING ${columns("momo_login_accounts")}"

  private def fromRow(row: LoginAccountRow): LoginAccount = LoginAccount(
    id = row.id,
    discordUserId = row.discordUserId,
    displayName = row.displayName,
    playerMemberId = row.playerMemberId,
    loginEnabled = row.loginEnabled,
    role = row.role,
    createdAt = row.createdAt,
    updatedAt = row.updatedAt,
  )

  def alg(using ids: PostgresIdentities): LoginAccountsAlg[ConnectionIO] =
    new LoginAccountsAlg[ConnectionIO]:
      override def list: ConnectionIO[List[LoginAccount]] = (selectAll ++ fr"""
        ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'operator' THEN 1 ELSE 2 END,
                 login_enabled DESC, created_at, ${ids.wireId("a")}
      """)
        .query[LoginAccountRow].to[List].map(_.map(fromRow))

      override def find(id: AccountId): ConnectionIO[Option[LoginAccount]] =
        (selectAll ++ fr"WHERE a.id = ${ids.lookup(Entity.Accounts, id.value)}")
          .query[LoginAccountRow].option.map(_.map(fromRow))

      override def findByDiscordUserId(userId: UserId): ConnectionIO[Option[LoginAccount]] =
        (selectAll ++ fr"WHERE discord_user_id = $userId").query[LoginAccountRow].option
          .map(_.map(fromRow))

      override def create(account: CreateLoginAccountData): ConnectionIO[LoginAccount] = (for
        identity <- ids.newId(account.id.value)
        member <- ids.requireReference(Entity.Members, account.playerMemberId.map(_.value))
        created <-
        (sql"""
        INSERT INTO momo_login_accounts
          (${ids.idColumns}, discord_user_id, display_name, player_member_id,
           login_enabled, role, created_at, updated_at)
        VALUES
          ($identity, ${account.discordUserId}, ${account.displayName},
           $member, ${account.loginEnabled}, ${account.role},
           ${account.createdAt}, ${account.updatedAt})
      """ ++ returningAll).query[LoginAccountRow].unique.map(fromRow)
      yield created).exceptSomeSqlState {
        case state if isLoginAccountUniqueViolation(state) =>
          raiseLoginAccountError(AppError.Conflict(
            s"login account already exists for discord user ${account.discordUserId.value}."
          ))
        case state if isLoginAccountForeignKeyViolation(state) =>
          raiseLoginAccountError(
            AppError.NotFound("member", account.playerMemberId.map(_.value).getOrElse("<empty>"))
          )
      }

  private[postgres] def updateUnchecked(
      id: AccountId,
      data: UpdateLoginAccountData,
  )(using ids: PostgresIdentities): ConnectionIO[Option[LoginAccount]] =
    ids.requireReference(Entity.Members, data.playerMemberId.flatten.map(_.value)).flatMap { member =>
      (sql"""
        UPDATE momo_login_accounts
        SET display_name = COALESCE(${data.displayName}, display_name),
            player_member_id =
              CASE WHEN ${data.playerMemberId.isDefined}
                   THEN $member
                   ELSE player_member_id
              END,
            login_enabled = COALESCE(${data.loginEnabled}, login_enabled),
            role = COALESCE(${data.role}, role),
            updated_at = ${data.updatedAt}
        WHERE id = ${ids.lookup(Entity.Accounts, id.value)}
          AND NOT (
            login_enabled = true
            AND role = 'admin'
            AND (
              COALESCE(${data.loginEnabled}, login_enabled) = false
              OR COALESCE(${data.role}, role) <> 'admin'
            )
            AND (
              SELECT COUNT(*)
              FROM momo_login_accounts
              WHERE login_enabled = true AND role = 'admin'
            ) <= 1
          )
    """ ++ returningAll).query[LoginAccountRow].option.map(_.map(fromRow))
    }

end PostgresLoginAccounts

object PostgresLoginAccountAdministration:
  // Acquire in a separate statement before account reads: waiting login and administration
  // commands must use a fresh READ COMMITTED snapshot after the preceding command commits.
  private val lockLifecycle =
    sql"SELECT pg_advisory_xact_lock(hashtext('momo:login_accounts:admin_guard'))".query[
      Unit
    ].unique

  def createIfAccountCurrent(
      session: AppSession,
      expectedAccountUpdatedAt: java.time.Instant,
  )(using identities: PostgresIdentities): ConnectionIO[Boolean] =
    lockLifecycle *> PostgresLoginAccounts.alg.find(session.accountId).flatMap {
      case Some(current)
          if current.loginEnabled && current.updatedAt.equals(expectedAccountUpdatedAt) =>
        PostgresAppSessions.alg.upsert(session).as(true)
      case _ => false.pure[ConnectionIO]
    }

  def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  )(using identities: PostgresIdentities): ConnectionIO[LoginAccountAdministrationUpdateResult] =
    for
      _ <- lockLifecycle
      existing <- PostgresLoginAccounts.alg.find(id)
      result <- existing match
        case None => LoginAccountAdministrationUpdateResult.NotFound.pure[ConnectionIO]
        case Some(account) => updateExisting(account, data)
    yield result

  private def updateExisting(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  )(using PostgresIdentities): ConnectionIO[LoginAccountAdministrationUpdateResult] =
    PostgresLoginAccounts
      .updateUnchecked(existing.id, data).flatMap {
        case Some(updated) =>
          val revokeSessions = existing.loginEnabled && !updated.loginEnabled
          val revoke =
            if revokeSessions then PostgresAppSessions.alg.deleteByAccount(existing.id).void
            else MonadThrow[ConnectionIO].unit
          revoke.as(LoginAccountAdministrationUpdateResult.Updated(updated))
        case None if wouldRemoveEnabledAdmin(existing, data) =>
          LoginAccountAdministrationUpdateResult.LastEnabledAdmin.pure[ConnectionIO]
        case None => LoginAccountAdministrationUpdateResult.NotFound.pure[ConnectionIO]
      }

  private def wouldRemoveEnabledAdmin(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  ): Boolean =
    val nextLoginEnabled = data.loginEnabled.getOrElse(existing.loginEnabled)
    val nextRole = data.role.getOrElse(existing.role)
    existing.loginEnabled && existing.role == AccountRole.Admin &&
    (!nextLoginEnabled || nextRole != AccountRole.Admin)
end PostgresLoginAccountAdministration

final class PostgresLoginAccountsRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends LoginAccountsRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: LoginAccountsRepository[F] = LoginAccountsRepository
    .fromAlg(PostgresLoginAccounts.alg, transactor.trans)

  export delegate.*
end PostgresLoginAccountsRepository

final class PostgresLoginAccountAdministrationRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends LoginAccountAdministrationRepository[F], LoginSessionCreationRepository[F]:
  private given PostgresIdentities = identities
  override def createIfAccountCurrent(
      session: AppSession,
      expectedAccountUpdatedAt: java.time.Instant,
  ): F[Boolean] = PostgresLoginAccountAdministration
    .createIfAccountCurrent(session, expectedAccountUpdatedAt).transact(transactor)

  override def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] =
    PostgresLoginAccountAdministration
      .updateAndRevokeSessionsWhenDisabled(id, data).transact(transactor)
end PostgresLoginAccountAdministrationRepository
