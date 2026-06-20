package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{InMemoryLoginAccountsRepository, InMemoryMembersRepository}
import momo.api.domain.ids.{AccountId, UserId}
import momo.api.testing.AppErrorAssertions.assertAppError

final class AdminLoginAccountsSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-20T13:00:00Z")
  private val accountId = AccountId.unsafeFromString("account_duplicate_usecase")

  test("returns Conflict when the repository rejects a generated duplicate id"):
    for
      accounts <- InMemoryLoginAccountsRepository.create[IO](Nil)
      members <- InMemoryMembersRepository.create[IO]
      usecase = CreateLoginAccount[IO](accounts, members, IO.pure(now), IO.pure(accountId))
      first <- usecase.run(command(UserId.unsafeFromString("123456789012345678")))
      duplicate <- usecase.run(command(UserId.unsafeFromString("223456789012345678")))
    yield
      assertEquals(first.map(_.id), Right(accountId))
      assertAppError(duplicate, "CONFLICT", "login account already exists")

  private def command(discordUserId: UserId): CreateLoginAccountCommand =
    CreateLoginAccountCommand(
      discordUserId = discordUserId,
      displayName = "duplicate id account",
      playerMemberId = None,
      loginEnabled = true,
      isAdmin = false,
    )
