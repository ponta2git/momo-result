package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.auth.SessionTokenHash
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.repositories.postgres.{
  PostgresAppSessionsRepository, PostgresLoginAccountAdministrationRepository,
  PostgresLoginAccountsRepository, PostgresMeta,
}
import momo.api.repositories.{
  AppSession, CreateLoginAccountData, LoginAccountAdministrationUpdateResult, UpdateLoginAccountData,
}

import PostgresMeta.given

final class PostgresLoginAccountAdministrationRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private val primaryAdminId = AccountId.unsafeFromString("account_ponta")
  private val primaryMemberId = MemberId.unsafeFromString("member_ponta")
  private val backupAdminId = AccountId.unsafeFromString("account_atomic_backup_admin")
  private val backupDiscordUserId = UserId.unsafeFromString("323456789012345678")

  private def accounts = new PostgresLoginAccountsRepository[IO](transactor)
  private def administration = new PostgresLoginAccountAdministrationRepository[IO](transactor)
  private def sessions = new PostgresAppSessionsRepository[IO](transactor)

  test("disabling a login account revokes its sessions through the administration contract"):
    val program =
      for
        _ <- resetLoginAccountState
        _ <- accounts.create(backupAdminData)
        session <- buildSession("disable-session-token", "disable-csrf-token")
        _ <- sessions.upsert(session)
        result <- administration.updateAndRevokeSessionsWhenDisabled(primaryAdminId, disableLogin)
        foundSession <- sessions.find(session.idHash)
        foundAccount <- accounts.find(primaryAdminId)
      yield
        result match
          case LoginAccountAdministrationUpdateResult.Updated(account) =>
            assertEquals(account.id, primaryAdminId)
            assertEquals(account.loginEnabled, false)
          case other => fail(s"expected Updated, got $other")
        assertEquals(foundSession, None)
        assertEquals(foundAccount.map(_.loginEnabled), Some(false))

    program.guarantee(resetLoginAccountState)

  test("preserving the last enabled administrator leaves its session intact"):
    val program =
      for
        _ <- resetLoginAccountState
        session <- buildSession("last-admin-session-token", "last-admin-csrf-token")
        _ <- sessions.upsert(session)
        result <- administration.updateAndRevokeSessionsWhenDisabled(primaryAdminId, disableLogin)
        foundSession <- sessions.find(session.idHash)
        foundAccount <- accounts.find(primaryAdminId)
      yield
        assertEquals(result, LoginAccountAdministrationUpdateResult.LastEnabledAdmin)
        assertEquals(foundSession, Some(session))
        assertEquals(foundAccount.map(_.loginEnabled), Some(true))

    program.guarantee(resetLoginAccountState)

  private def backupAdminData: CreateLoginAccountData = CreateLoginAccountData(
    id = backupAdminId,
    discordUserId = backupDiscordUserId,
    displayName = "backup-admin",
    playerMemberId = None,
    loginEnabled = true,
    isAdmin = true,
    createdAt = now,
    updatedAt = now,
  )

  private def disableLogin: UpdateLoginAccountData = UpdateLoginAccountData(
    displayName = None,
    playerMemberId = None,
    loginEnabled = Some(false),
    isAdmin = None,
    updatedAt = now.plusSeconds(60),
  )

  private def buildSession(rawSessionToken: String, rawCsrfToken: String): IO[AppSession] =
    (SessionTokenHash.sha256[IO](rawSessionToken), SessionTokenHash.sha256[IO](rawCsrfToken))
      .mapN { (idHash, csrfHash) =>
        AppSession(
          idHash = idHash,
          accountId = primaryAdminId,
          playerMemberId = Some(primaryMemberId),
          csrfSecretHash = csrfHash,
          createdAt = now,
          lastSeenAt = now,
          expiresAt = now.plusSeconds(3600),
        )
      }

  private def resetLoginAccountState: IO[Unit] =
    val deleteSessions = sql"""
      DELETE FROM app_sessions
      WHERE account_id = $primaryAdminId OR account_id = $backupAdminId
    """.update.run
    val deleteBackup = sql"""
      DELETE FROM momo_login_accounts
      WHERE id = $backupAdminId
    """.update.run
    val restorePrimary = sql"""
      UPDATE momo_login_accounts
      SET login_enabled = true,
          is_admin = true,
          updated_at = $now
      WHERE id = $primaryAdminId
    """.update.run

    (deleteSessions >> deleteBackup >> restorePrimary).void.transact(transactor)
end PostgresLoginAccountAdministrationRepositorySpec
