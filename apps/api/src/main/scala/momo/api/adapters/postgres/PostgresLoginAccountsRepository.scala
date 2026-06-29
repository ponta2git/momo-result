package momo.api.adapters.postgres

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.db.Database
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.errors.{AppError, AppException}
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.repositories.{
  CreateLoginAccountData,
  LoginAccountAdministrationRepository,
  LoginAccountAdministrationUpdateResult,
  LoginAccountsAlg,
  LoginAccountsRepository,
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
      isAdmin: Boolean,
      createdAt: java.time.Instant,
      updatedAt: java.time.Instant,
  )

  private val selectAll = fr"""
    SELECT id, discord_user_id, display_name, player_member_id,
           login_enabled, is_admin, created_at, updated_at
    FROM momo_login_accounts
  """

  private val returningAll = fr"""
    RETURNING id, discord_user_id, display_name, player_member_id,
              login_enabled, is_admin, created_at, updated_at
  """

  private def fromRow(row: LoginAccountRow): LoginAccount = LoginAccount(
    id = row.id,
    discordUserId = row.discordUserId,
    displayName = row.displayName,
    playerMemberId = row.playerMemberId,
    loginEnabled = row.loginEnabled,
    isAdmin = row.isAdmin,
    createdAt = row.createdAt,
    updatedAt = row.updatedAt,
  )

  val alg: LoginAccountsAlg[ConnectionIO] = new LoginAccountsAlg[ConnectionIO]:
    override def list: ConnectionIO[List[LoginAccount]] =
      (selectAll ++ fr"ORDER BY is_admin DESC, login_enabled DESC, created_at, id")
        .query[LoginAccountRow].to[List].map(_.map(fromRow))

    override def find(id: AccountId): ConnectionIO[Option[LoginAccount]] =
      (selectAll ++ fr"WHERE id = $id").query[LoginAccountRow].option.map(_.map(fromRow))

    override def findByDiscordUserId(userId: UserId): ConnectionIO[Option[LoginAccount]] =
      (selectAll ++ fr"WHERE discord_user_id = $userId").query[LoginAccountRow].option
        .map(_.map(fromRow))

    override def create(account: CreateLoginAccountData): ConnectionIO[LoginAccount] = (sql"""
        INSERT INTO momo_login_accounts
          (id, discord_user_id, display_name, player_member_id,
           login_enabled, is_admin, created_at, updated_at)
        VALUES
          (${account.id}, ${account.discordUserId}, ${account.displayName},
           ${account.playerMemberId}, ${account.loginEnabled}, ${account.isAdmin},
           ${account.createdAt}, ${account.updatedAt})
      """ ++ returningAll).query[LoginAccountRow].unique.map(fromRow).exceptSomeSqlState {
      case state if isLoginAccountUniqueViolation(state) =>
        raiseLoginAccountError(AppError.Conflict(
          s"login account already exists for discord user ${account.discordUserId.value}."
        ))
      case state if isLoginAccountForeignKeyViolation(state) =>
        raiseLoginAccountError(
          AppError.NotFound("member", account.playerMemberId.map(_.value).getOrElse("<empty>"))
        )
    }

    override def update(
        id: AccountId,
        data: UpdateLoginAccountData,
    ): ConnectionIO[Option[LoginAccount]] =
      (sql"""
        WITH admin_guard AS (
          SELECT pg_advisory_xact_lock(hashtext('momo:login_accounts:admin_guard'))
        )
        UPDATE momo_login_accounts
        SET display_name = COALESCE(${data.displayName}, display_name),
            player_member_id =
              CASE WHEN ${data.playerMemberId.isDefined}
                   THEN ${data.playerMemberId.flatten}
                   ELSE player_member_id
              END,
            login_enabled = COALESCE(${data.loginEnabled}, login_enabled),
            is_admin = COALESCE(${data.isAdmin}, is_admin),
            updated_at = ${data.updatedAt}
        FROM admin_guard
        WHERE id = $id
          AND NOT (
            login_enabled = true
            AND is_admin = true
            AND (
              COALESCE(${data.loginEnabled}, login_enabled) = false
              OR COALESCE(${data.isAdmin}, is_admin) = false
            )
            AND (
              SELECT COUNT(*)
              FROM momo_login_accounts
              WHERE login_enabled = true AND is_admin = true
            ) <= 1
          )
      """ ++ returningAll).query[LoginAccountRow].option.map(_.map(fromRow))

    override def enabledAdminCount: ConnectionIO[Int] = sql"""
        SELECT COUNT(*) FROM momo_login_accounts
        WHERE login_enabled = true AND is_admin = true
      """.query[Int].unique
end PostgresLoginAccounts

object PostgresLoginAccountAdministration:
  def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): ConnectionIO[LoginAccountAdministrationUpdateResult] =
    for
      existing <- PostgresLoginAccounts.alg.find(id)
      result <- existing match
        case None => LoginAccountAdministrationUpdateResult.NotFound.pure[ConnectionIO]
        case Some(account) => updateExisting(account, data)
    yield result

  private def updateExisting(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  ): ConnectionIO[LoginAccountAdministrationUpdateResult] = PostgresLoginAccounts.alg
    .update(existing.id, data).flatMap {
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
    val nextIsAdmin = data.isAdmin.getOrElse(existing.isAdmin)
    existing.loginEnabled && existing.isAdmin && (!nextLoginEnabled || !nextIsAdmin)
end PostgresLoginAccountAdministration

final class PostgresLoginAccountsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends LoginAccountsRepository[F]:
  private val delegate: LoginAccountsRepository[F] = LoginAccountsRepository
    .fromAlg(PostgresLoginAccounts.alg, Database.transactK(transactor))

  export delegate.*
end PostgresLoginAccountsRepository

final class PostgresLoginAccountAdministrationRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends LoginAccountAdministrationRepository[F]:
  private val transactK = Database.transactK(transactor)

  override def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] =
    transactK(PostgresLoginAccountAdministration.updateAndRevokeSessionsWhenDisabled(id, data))
end PostgresLoginAccountAdministrationRepository
