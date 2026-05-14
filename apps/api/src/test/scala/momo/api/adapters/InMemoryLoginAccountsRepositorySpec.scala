package momo.api.adapters

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{CreateLoginAccountData, UpdateLoginAccountData}

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
        .attempt
      duplicateDiscord <- accounts
        .create(createData(AccountId.unsafeFromString("account-other"), primaryDiscordId))
        .attempt
      listed <- accounts.list
    yield
      assertAppError(
        duplicateId,
        AppError.Conflict("login account already exists for discord user 223456789012345678."),
      )
      assertAppError(
        duplicateDiscord,
        AppError.Conflict("login account already exists for discord user 123456789012345678."),
      )
      assertEquals(listed.map(_.id), List(primaryId))

  test("update atomically preserves the last enabled administrator"):
    val admin = loginAccount(primaryId, primaryDiscordId, loginEnabled = true, isAdmin = true)
    val disable = UpdateLoginAccountData(
      displayName = None,
      playerMemberId = None,
      loginEnabled = Some(false),
      isAdmin = None,
      updatedAt = now.plusSeconds(60),
    )
    for
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(admin))
      updated <- accounts.update(primaryId, disable)
      found <- accounts.find(primaryId)
    yield
      assertEquals(updated, None)
      assertEquals(found.map(_.loginEnabled), Some(true))
      assertEquals(found.map(_.isAdmin), Some(true))

  test("update allows disabling an administrator when another enabled administrator remains"):
    val first = loginAccount(primaryId, primaryDiscordId, loginEnabled = true, isAdmin = true)
    val second = loginAccount(
      AccountId.unsafeFromString("account-second"),
      UserId.unsafeFromString("223456789012345678"),
      loginEnabled = true,
      isAdmin = true,
    )
    val disable = UpdateLoginAccountData(
      displayName = None,
      playerMemberId = None,
      loginEnabled = Some(false),
      isAdmin = None,
      updatedAt = now.plusSeconds(60),
    )
    for
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(first, second))
      updated <- accounts.update(primaryId, disable)
      found <- accounts.find(primaryId)
    yield
      assertEquals(updated.map(_.loginEnabled), Some(false))
      assertEquals(found.map(_.loginEnabled), Some(false))

  private def createData(id: AccountId, discordUserId: UserId): CreateLoginAccountData =
    CreateLoginAccountData(
      id = id,
      discordUserId = discordUserId,
      displayName = id.value,
      playerMemberId = None,
      loginEnabled = true,
      isAdmin = false,
      createdAt = now,
      updatedAt = now,
    )

  private def loginAccount(
      id: AccountId,
      discordUserId: UserId,
      loginEnabled: Boolean,
      isAdmin: Boolean,
  ): LoginAccount = LoginAccount(
    id = id,
    discordUserId = discordUserId,
    displayName = id.value,
    playerMemberId = None,
    loginEnabled = loginEnabled,
    isAdmin = isAdmin,
    createdAt = now,
    updatedAt = now,
  )

  private def assertAppError[A](result: Either[Throwable, A], expected: AppError): Unit =
    result match
      case Left(error: AppException) => assertEquals(error.error, expected)
      case other => fail(s"expected AppException($expected), got $other")
