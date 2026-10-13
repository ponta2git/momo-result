package momo.api.integration

import java.time.Instant

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.{ConnectionIO, Transactor}

import momo.api.adapters.postgres.{
  PostgresAppSessionsRepository,
  PostgresLoginAccountAdministration,
  PostgresLoginAccountAdministrationRepository,
  PostgresLoginAccountsRepository,
  PostgresMeta
}
import momo.api.auth.SessionTokenHash
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.repositories.{
  AppSession,
  CreateLoginAccountData,
  LoginAccountAdministrationUpdateResult,
  UpdateLoginAccountData
}

import PostgresMeta.given

final class PostgresLoginAccountAdministrationRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private val primaryAdminId = AccountId.unsafeFromString("account_ponta")
  private val primaryMemberId = MemberId.unsafeFromString("member_ponta")
  private val backupAdminId = AccountId.unsafeFromString("account_atomic_backup_admin")
  private val operatorId = AccountId.unsafeFromString("account_atomic_operator")
  private val userId = AccountId.unsafeFromString("account_atomic_user")
  private val backupDiscordUserId = UserId.unsafeFromString("323456789012345678")
  private val adminRemovals = List(
    "disabling login" -> disableLogin,
    "demoting to operator" -> changeRole(AccountRole.Operator),
    "demoting to user" -> changeRole(AccountRole.User),
  )

  private def accounts = new PostgresLoginAccountsRepository[IO](transactor)
  private def administration = new PostgresLoginAccountAdministrationRepository[IO](transactor)
  private def sessions = new PostgresAppSessionsRepository[IO](transactor)

  test("all three account roles round-trip without changing player identity"):
    val data = List(
      backupAdminData.copy(
        id = userId,
        discordUserId = UserId.unsafeFromString("523456789012345678"),
        playerMemberId = Some(primaryMemberId),
        role = AccountRole.User,
      ),
      operatorData,
      backupAdminData,
    )
    val program =
      for
        _ <- resetLoginAccountState
        created <- data.traverse(createAccount)
        byId <- data.traverse(account => accounts.find(account.id))
        byDiscordId <- data.traverse(account => accounts.findByDiscordUserId(account.discordUserId))
        listed <- accounts.list
      yield
        assertEquals(
          created.map(account => (account.id, account.role, account.playerMemberId)),
          data.map(account => (account.id, account.role, account.playerMemberId)),
        )
        assertEquals(byId, created.map(Some(_)))
        assertEquals(byDiscordId, created.map(Some(_)))
        assertEquals(
          listed.filter(account => data.exists(_.id == account.id)).map(_.id),
          List(backupAdminId, operatorId, userId),
        )
    program.guarantee(resetLoginAccountState)

  test("an unknown stored role fails checked decoding instead of receiving a default role"):
    sql"SELECT 'unrecognized'::text".query[AccountRole].unique.transact(transactor).attempt.map {
      result => assert(result.isLeft)
    }

  adminRemovals.foreach { case (label, change) =>
    test(s"$label succeeds when another administrator remains and only disabling revokes sessions"):
      val program =
        for
          _ <- resetLoginAccountState
          _ <- createAccount(backupAdminData)
          before <- accounts.find(primaryAdminId)
          session <- buildSession(s"allowed-$label-session", s"allowed-$label-csrf")
          _ <- sessions.upsert(session)
          result <- administration.updateAndRevokeSessionsWhenDisabled(primaryAdminId, change)
          foundSession <- sessions.find(session.idHash)
          foundAccount <- accounts.find(primaryAdminId)
        yield
          val expected = before.map(account =>
            account.copy(
              role = change.role.getOrElse(account.role),
              loginEnabled = change.loginEnabled.getOrElse(account.loginEnabled),
              updatedAt = change.updatedAt,
            )
          ).getOrElse(fail("primary administrator is missing"))
          assertEquals(result, LoginAccountAdministrationUpdateResult.Updated(expected))
          assertEquals(foundAccount, Some(expected))
          assertEquals(foundSession, Option.when(expected.loginEnabled)(session))
      program.guarantee(resetLoginAccountState)

    test(s"$label preserves the last enabled administrator and its session"):
      val program =
        for
          _ <- resetLoginAccountState
          _ <- createAccount(backupAdminData.copy(loginEnabled = false))
          _ <- createAccount(operatorData)
          before <- accounts.find(primaryAdminId)
          session <- buildSession(s"last-admin-$label-session", s"last-admin-$label-csrf")
          _ <- sessions.upsert(session)
          result <- administration.updateAndRevokeSessionsWhenDisabled(
            primaryAdminId,
            change.copy(displayName = Some("must not be saved")),
          )
          foundSession <- sessions.find(session.idHash)
          foundAccount <- accounts.find(primaryAdminId)
        yield
          assertEquals(result, LoginAccountAdministrationUpdateResult.LastEnabledAdmin)
          assertEquals(foundSession, Some(session))
          assertEquals(foundAccount, before)
      program.guarantee(resetLoginAccountState)
  }

  List(
    ("two disabling commands", disableLogin, disableLogin),
    ("two demotions", changeRole(AccountRole.Operator), changeRole(AccountRole.User)),
    ("disabling followed by demotion", disableLogin, changeRole(AccountRole.Operator)),
    ("demotion followed by disabling", changeRole(AccountRole.User), disableLogin),
  ).foreach { case (label, precedingChange, waitingChange) =>
    test(s"concurrent $label preserve the administrator left by the preceding commit"):
      val program =
        for
          _ <- resetLoginAccountState
          _ <- createAccount(backupAdminData)
          before <- accounts.find(primaryAdminId)
          session <- buildSession("concurrent-admin-session", "concurrent-admin-csrf")
          _ <- sessions.upsert(session)
          results <- updateWhileAnotherAdminChangeCommits(precedingChange, waitingChange)
          found <- accounts.find(primaryAdminId)
          keptSession <- sessions.find(session.idHash)
          enabledAdmins <- sql"""
            SELECT id FROM momo_login_accounts
            WHERE login_enabled = true AND role = 'admin'
          """.query[AccountId].to[List].transact(transactor)
        yield
          results._1 match
            case LoginAccountAdministrationUpdateResult.Updated(account) =>
              assertEquals(account.id, backupAdminId)
              assertEquals(account.role, precedingChange.role.getOrElse(AccountRole.Admin))
              assertEquals(account.loginEnabled, precedingChange.loginEnabled.getOrElse(true))
            case other => fail(s"expected the preceding update to succeed, got $other")
          assertEquals(results._2, LoginAccountAdministrationUpdateResult.LastEnabledAdmin)
          assertEquals(found, before)
          assertEquals(keptSession, Some(session))
          assertEquals(enabledAdmins, List(primaryAdminId))
      program.guarantee(resetLoginAccountState)
  }

  test(
    "a login waiting for account disabling cannot leave a session that revives after re-enabling"
  ):
    val program =
      for
        _ <- resetLoginAccountState
        _ <- createAccount(backupAdminData)
        before <- accounts.find(primaryAdminId).map(_.getOrElse(fail("administrator missing")))
        session <- buildSession("delayed-login-session", "delayed-login-csrf")
        results <- commitBefore(
          PostgresLoginAccountAdministration.updateAndRevokeSessionsWhenDisabled(
            primaryAdminId,
            disableLogin
          ),
          administration.createIfAccountCurrent(session, before.updatedAt),
        )
        afterDisabling <- sessions.find(session.idHash)
        _ <- administration.updateAndRevokeSessionsWhenDisabled(
          primaryAdminId,
          disableLogin.copy(loginEnabled = Some(true), updatedAt = now.plusSeconds(120))
        )
        stale <- administration.createIfAccountCurrent(session, before.updatedAt)
        afterReEnabling <- sessions.find(session.idHash)
        current <- accounts.find(primaryAdminId).map(_.getOrElse(fail("administrator missing")))
        fresh <- administration.createIfAccountCurrent(session, current.updatedAt)
        saved <- sessions.find(session.idHash)
      yield
        assert(!results._2)
        assertEquals(afterDisabling, None)
        assert(!stale)
        assertEquals(afterReEnabling, None)
        assert(fresh)
        assertEquals(saved, Some(session))
    program.guarantee(resetLoginAccountState)

  test(
    "account disabling waits for a preceding session creation and revokes that committed session"
  ):
    val program =
      for
        _ <- resetLoginAccountState
        _ <- createAccount(backupAdminData)
        before <- accounts.find(primaryAdminId).map(_.getOrElse(fail("administrator missing")))
        session <- buildSession("preceding-login-session", "preceding-login-csrf")
        results <- commitBefore(
          PostgresLoginAccountAdministration.createIfAccountCurrent(session, before.updatedAt),
          administration.updateAndRevokeSessionsWhenDisabled(primaryAdminId, disableLogin),
        )
        remaining <- sessions.find(session.idHash)
        current <- accounts.find(primaryAdminId)
      yield
        assert(results._1)
        assertEquals(current.map(_.loginEnabled), Some(false))
        assertEquals(remaining, None)
    program.guarantee(resetLoginAccountState)

  private def updateWhileAnotherAdminChangeCommits(
      precedingChange: UpdateLoginAccountData,
      waitingChange: UpdateLoginAccountData,
  ): IO[(LoginAccountAdministrationUpdateResult, LoginAccountAdministrationUpdateResult)] =
    commitBefore(
      PostgresLoginAccountAdministration.updateAndRevokeSessionsWhenDisabled(
        backupAdminId,
        precedingChange
      ),
      administration.updateAndRevokeSessionsWhenDisabled(primaryAdminId, waitingChange),
    )

  private def commitBefore[A, B](preceding: ConnectionIO[A], waiting: IO[B]): IO[(A, B)] =
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
      val xa = Transactor.fromConnection[IO](connection, None)
      (for
        _ <- IO.blocking(connection.setAutoCommit(false))
        first <- xa.rawTrans.apply(preceding)
        blocker <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
        second <- waiting.background.use { completion =>
          awaitBackendBlockedBy(blocker) *> IO.blocking(connection.commit()) *>
            completion.flatMap(_.embedNever)
        }
      yield (first, second)).onError(_ => IO.blocking(connection.rollback()))
    }

  private def createAccount(data: CreateLoginAccountData): IO[LoginAccount] = accounts.create(data)
    .map(_.fold(error => fail(s"could not create account fixture: $error"), identity))

  private def backupAdminData: CreateLoginAccountData = CreateLoginAccountData(
    id = backupAdminId,
    discordUserId = backupDiscordUserId,
    displayName = "backup-admin",
    playerMemberId = None,
    loginEnabled = true,
    role = AccountRole.Admin,
    createdAt = now,
    updatedAt = now,
  )

  private def operatorData: CreateLoginAccountData = backupAdminData.copy(
    id = operatorId,
    discordUserId = UserId.unsafeFromString("423456789012345678"),
    displayName = "operator",
    role = AccountRole.Operator,
  )

  private def disableLogin: UpdateLoginAccountData = UpdateLoginAccountData(
    displayName = None,
    playerMemberId = None,
    loginEnabled = Some(false),
    role = None,
    updatedAt = now.plusSeconds(60),
  )

  private def changeRole(role: AccountRole): UpdateLoginAccountData = disableLogin.copy(
    loginEnabled = None,
    role = Some(role),
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
      WHERE account_id IN ($primaryAdminId, $backupAdminId, $operatorId, $userId)
    """.update.run
    val deleteFixtures = sql"""
      DELETE FROM momo_login_accounts
      WHERE id IN ($backupAdminId, $operatorId, $userId)
    """.update.run
    val restorePrimary = sql"""
      UPDATE momo_login_accounts
      SET login_enabled = true,
          role = 'admin',
          updated_at = $now
      WHERE id = $primaryAdminId
    """.update.run

    (deleteSessions >> deleteFixtures >> restorePrimary).void.transact(transactor)
end PostgresLoginAccountAdministrationRepositorySpec
