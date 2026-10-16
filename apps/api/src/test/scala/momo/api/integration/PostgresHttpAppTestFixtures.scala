package momo.api.integration

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.{PostgresLoginAccountsRepository, PostgresMeta}
import momo.api.bootstrap.ApiApp
import momo.api.config.AppConfig
import momo.api.domain.LoginAccount
import momo.api.http.HttpAppTestFixtures

import PostgresMeta.given

/** Real runtime fixture for HTTP contracts that depend on saved state or atomic writes. */
abstract class PostgresHttpAppTestFixtures extends IntegrationSuite with HttpAppTestFixtures:
  override protected def runtimeResource(config: AppConfig)
      : Resource[IO, ApiApp.WiredRuntime[IO]] =
    val accounts = new PostgresLoginAccountsRepository[IO](transactor)
    Resource.make(accounts.list)(restoreAccounts).flatMap { _ =>
      ApiApp.wiredWithHandles[IO](config.copy(database = Some(dbFixture().databaseConfig)))
    }

  private def restoreAccounts(original: List[LoginAccount]): IO[Unit] =
    val accounts = new PostgresLoginAccountsRepository[IO](transactor)
    dbFixture().cleanup() *> accounts.list.flatMap { current =>
      val originalIds = original.map(_.id).toSet
      val remove = current.filterNot(account => originalIds.contains(account.id)).traverse_ { account =>
        sql"DELETE FROM momo_login_accounts WHERE id = ${account.id}".update.run.void
      }
      val restore = original.traverse_ { account =>
        sql"""
          UPDATE momo_login_accounts
          SET discord_user_id = ${account.discordUserId}, display_name = ${account.displayName},
              player_member_id = ${account.playerMemberId}, login_enabled = ${account.loginEnabled},
              role = ${account.role}, created_at = ${account.createdAt}, updated_at = ${account.updatedAt}
          WHERE id = ${account.id}
        """.update.run.void
      }
      (remove *> restore).transact(transactor)
    }
