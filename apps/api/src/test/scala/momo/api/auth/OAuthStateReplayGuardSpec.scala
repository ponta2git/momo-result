package momo.api.auth

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite

final class OAuthStateReplayGuardSpec extends MomoCatsEffectSuite:
  private val issuedAt = Instant.parse("2026-01-01T00:00:59Z")

  test("concurrent consumption permits one callback and minute changes never reopen the state") {
    val expiresAt = issuedAt.plusSeconds(300)
    for
      now <- IO.ref(issuedAt)
      guard <- InMemoryOAuthStateReplayGuard.create[IO](now.get)
      accepted <- List.fill(12)(guard.consume("state-hash", expiresAt)).parSequence
      _ <- now.set(issuedAt.plusSeconds(61))
      replay <- guard.consume("state-hash", expiresAt)
      _ <- now.set(expiresAt)
      expired <- guard.consume("state-hash", expiresAt)
    yield
      assertEquals(accepted.count(identity), 1)
      assert(!replay)
      assert(!expired)
  }

  test("capacity rejects new states without evicting consumed states before their signed expiry") {
    val expiresAt = issuedAt.plusSeconds(300)
    for
      now <- IO.ref(issuedAt)
      guard <- InMemoryOAuthStateReplayGuard.create[IO](now.get, maxKeys = 1)
      first <- guard.consume("first", expiresAt)
      crowded <- guard.consume("second", expiresAt.plusSeconds(30))
      replay <- guard.consume("first", expiresAt)
      _ <- now.set(expiresAt)
      recovered <- guard.consume("second", expiresAt.plusSeconds(30))
    yield
      assert(first)
      assert(!crowded)
      assert(!replay)
      assert(recovered)
  }
