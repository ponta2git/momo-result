package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.errors.AppError
import momo.api.repositories.{
  CreateLoginAccountData,
  LoginAccountAdministrationUpdateResult,
  UpdateLoginAccountData
}

final class InMemoryLoginAccountsRepositorySpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-15T02:00:00Z")
  private val primaryId = AccountId.unsafeFromString("account-primary")
  private val primaryDiscordId = UserId.unsafeFromString("123456789012345678")

  test("create rejects duplicate account ids and discord user ids"):
    for
      accounts <- InMemoryLoginAccountsRepository.create[IO](Nil)
      _ <- accounts.create(createData(primaryId, primaryDiscordId))
      duplicateId <- accounts
        .create(createData(primaryId, UserId.unsafeFromString("223456789012345678")))
      duplicateDiscord <- accounts
        .create(createData(AccountId.unsafeFromString("account-other"), primaryDiscordId))
      listed <- accounts.list
    yield
      assertEquals(
        duplicateId,
        Left(AppError.Conflict(
          "login account already exists for discord user 223456789012345678."
        )),
      )
      assertEquals(
        duplicateDiscord,
        Left(AppError.Conflict(
          "login account already exists for discord user 123456789012345678."
        )),
      )
      assertEquals(listed.map(_.id), List(primaryId))

  List(
    ("disabling", Some(false), None),
    ("demotion to operator", None, Some(AccountRole.Operator)),
    ("demotion to user", None, Some(AccountRole.User)),
  ).foreach { (label, loginEnabled, role) =>
    test(s"administration preserves the last enabled administrator when $label"):
      val admin =
        loginAccount(primaryId, primaryDiscordId, loginEnabled = true, role = AccountRole.Admin)
      val operator = loginAccount(
        AccountId.unsafeFromString("account-operator"),
        UserId.unsafeFromString("223456789012345678"),
        loginEnabled = true,
        role = AccountRole.Operator,
      )
      val disabledAdmin = loginAccount(
        AccountId.unsafeFromString("account-disabled"),
        UserId.unsafeFromString("323456789012345678"),
        loginEnabled = false,
        role = AccountRole.Admin,
      )
      val change = UpdateLoginAccountData(
        displayName = Some("rejected change"),
        playerMemberId = None,
        loginEnabled = loginEnabled,
        role = role,
        updatedAt = now.plusSeconds(60),
      )
      for
        accounts <- InMemoryLoginAccountsRepository.create[IO](List(admin, operator, disabledAdmin))
        sessions <- InMemoryAppSessionsRepository.create[IO]
        administration = InMemoryLoginAccountAdministrationRepository(accounts, sessions)
        updated <- administration.updateAndRevokeSessionsWhenDisabled(primaryId, change)
        found <- accounts.find(primaryId)
      yield
        assertEquals(updated, LoginAccountAdministrationUpdateResult.LastEnabledAdmin)
        assertEquals(found, Some(admin))
  }

  test("administration allows disabling an administrator when another remains"):
    val first =
      loginAccount(primaryId, primaryDiscordId, loginEnabled = true, role = AccountRole.Admin)
    val second = loginAccount(
      AccountId.unsafeFromString("account-second"),
      UserId.unsafeFromString("223456789012345678"),
      loginEnabled = true,
      role = AccountRole.Admin,
    )
    val disable = UpdateLoginAccountData(
      displayName = None,
      playerMemberId = None,
      loginEnabled = Some(false),
      role = None,
      updatedAt = now.plusSeconds(60),
    )
    for
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(first, second))
      sessions <- InMemoryAppSessionsRepository.create[IO]
      administration = InMemoryLoginAccountAdministrationRepository(accounts, sessions)
      updated <- administration.updateAndRevokeSessionsWhenDisabled(primaryId, disable)
      found <- accounts.find(primaryId)
    yield
      assertEquals(
        updated,
        LoginAccountAdministrationUpdateResult.Updated(first.copy(
          loginEnabled = false,
          updatedAt = now.plusSeconds(60),
        )),
      )
      assertEquals(found.map(_.loginEnabled), Some(false))

  private def createData(id: AccountId, discordUserId: UserId): CreateLoginAccountData =
    CreateLoginAccountData(
      id = id,
      discordUserId = discordUserId,
      displayName = id.value,
      playerMemberId = None,
      loginEnabled = true,
      role = AccountRole.User,
      createdAt = now,
      updatedAt = now,
    )

  private def loginAccount(
      id: AccountId,
      discordUserId: UserId,
      loginEnabled: Boolean,
      role: AccountRole,
  ): LoginAccount = LoginAccount(
    id = id,
    discordUserId = discordUserId,
    displayName = id.value,
    playerMemberId = None,
    loginEnabled = loginEnabled,
    role = role,
    createdAt = now,
    updatedAt = now,
  )
