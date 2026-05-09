package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  CreateLoginAccountData, LoginAccountsAlg, LoginAccountsRepository, UpdateLoginAccountData,
}

object PostgresLoginAccounts:
  val alg: LoginAccountsAlg[ConnectionIO] = new LoginAccountsAlg[ConnectionIO]:
    override def list: ConnectionIO[List[LoginAccount]] = sql"""
        SELECT id, discord_user_id, display_name, player_member_id,
               login_enabled, is_admin, created_at, updated_at
        FROM momo_login_accounts
        ORDER BY is_admin DESC, login_enabled DESC, created_at, id
      """.query[LoginAccount].to[List]

    override def find(id: AccountId): ConnectionIO[Option[LoginAccount]] = sql"""
        SELECT id, discord_user_id, display_name, player_member_id,
               login_enabled, is_admin, created_at, updated_at
        FROM momo_login_accounts
        WHERE id = $id
      """.query[LoginAccount].option

    override def findByDiscordUserId(userId: UserId): ConnectionIO[Option[LoginAccount]] = sql"""
        SELECT id, discord_user_id, display_name, player_member_id,
               login_enabled, is_admin, created_at, updated_at
        FROM momo_login_accounts
        WHERE discord_user_id = $userId
      """.query[LoginAccount].option

    override def create(account: CreateLoginAccountData): ConnectionIO[LoginAccount] = sql"""
        INSERT INTO momo_login_accounts
          (id, discord_user_id, display_name, player_member_id,
           login_enabled, is_admin, created_at, updated_at)
        VALUES
          (${account.id}, ${account.discordUserId}, ${account.displayName},
           ${account.playerMemberId}, ${account.loginEnabled}, ${account.isAdmin},
           ${account.createdAt}, ${account.updatedAt})
        RETURNING id, discord_user_id, display_name, player_member_id,
                  login_enabled, is_admin, created_at, updated_at
      """.query[LoginAccount].unique

    override def update(
        id: AccountId,
        data: UpdateLoginAccountData,
    ): ConnectionIO[Option[LoginAccount]] = sql"""
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
        WHERE id = $id
        RETURNING id, discord_user_id, display_name, player_member_id,
                  login_enabled, is_admin, created_at, updated_at
      """.query[LoginAccount].option

    override def enabledAdminCount: ConnectionIO[Int] = sql"""
        SELECT COUNT(*) FROM momo_login_accounts
        WHERE login_enabled = true AND is_admin = true
      """.query[Int].unique
end PostgresLoginAccounts

final class PostgresLoginAccountsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends LoginAccountsRepository[F]:
  private val delegate: LoginAccountsRepository[F] = LoginAccountsRepository
    .fromConnectionIO(PostgresLoginAccounts.alg, Database.transactK(transactor))

  export delegate.*
end PostgresLoginAccountsRepository
