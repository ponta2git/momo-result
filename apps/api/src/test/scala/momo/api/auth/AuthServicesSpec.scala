package momo.api.auth

import cats.effect.IO
import java.time.Instant
import momo.api.config.{AppEnv, AuthConfig}
import momo.api.repositories.AppSession
import momo.api.MomoCatsEffectSuite
import scala.concurrent.duration.*

final class AuthServicesSpec extends MomoCatsEffectSuite:
  private val config = AuthConfig.defaults(AppEnv.Test)
    .copy(stateSigningKey = Some("test-signing-key"), stateTtl = 5.minutes, rateLimitPerMinute = 2)

  test("OAuthStateCodec accepts signed state before expiry and rejects tampering") {
    val now = IO.pure(Instant.parse("2026-01-01T00:00:00Z"))
    val codec = OAuthStateCodec[IO](config, now)
    for
      state <- codec.create
      valid <- codec.validate(state)
      tampered <- codec.validate(state.dropRight(1) + "x")
    yield
      assert(valid)
      assert(!tampered)
  }

  test("OAuthStateCodec rejects expired state") {
    val createdAt = Instant.parse("2026-01-01T00:00:00Z")
    for
      state <- OAuthStateCodec[IO](config, IO.pure(createdAt)).create
      valid <- OAuthStateCodec[IO](config, IO.pure(createdAt.plusSeconds(301))).validate(state)
    yield assert(!valid)
  }

  test("CsrfTokenService verifies the session csrf secret") {
    val session = AppSession(
      id = "session",
      memberId = "member_ponta",
      csrfSecret = "secret",
      createdAt = Instant.EPOCH,
      lastSeenAt = Instant.EPOCH,
      expiresAt = Instant.EPOCH.plusSeconds(60),
    )
    val csrf = CsrfTokenService()

    assertEquals(csrf.issue(session), "secret")
    assert(csrf.verify(session, Some("secret")).isRight)
    assert(csrf.verify(session, Some("bad")).isLeft)
  }

  test("LoginRateLimiter rejects attempts over the configured minute bucket") {
    for
      limiter <- LoginRateLimiter.create[IO](2, IO.pure(Instant.parse("2026-01-01T00:00:00Z")))
      first <- limiter.allow("ip")
      second <- limiter.allow("ip")
      third <- limiter.allow("ip")
    yield
      assert(first)
      assert(second)
      assert(!third)
  }
