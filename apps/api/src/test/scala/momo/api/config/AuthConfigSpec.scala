package momo.api.config

import cats.effect.IO
import cats.syntax.all.*
import munit.CatsEffectSuite

final class AuthConfigSpec extends CatsEffectSuite:
  test("cookie names reject separators, non-ASCII and session/state collisions at startup") {
    List("", "session;other", "session\r\nother", "session=other", "セッション").traverse_ { name =>
      AuthConfigLoader.load[IO](Map("SESSION_COOKIE_NAME" -> name), AppEnv.Dev).attempt.map {
        result => assert(result.left.exists(_.getMessage.contains("must be HTTP tokens")))
      }
    } *> AuthConfigLoader.load[IO](
      Map(
        "SESSION_COOKIE_NAME" -> "same",
        "OAUTH_STATE_COOKIE_NAME" -> "same",
      ),
      AppEnv.Test
    ).attempt.map(result => assert(result.left.exists(_.getMessage.contains("must be distinct"))))
  }

  test("production OAuth redirects require an authenticated HTTPS destination") {
    val env = Map(
      "DISCORD_CLIENT_ID" -> "test-client",
      "DISCORD_CLIENT_SECRET" -> "test-client-secret",
      "AUTH_STATE_SIGNING_KEY" -> "test-only-state-signing-key-32-bytes",
    )
    List(
      "http://example.com/callback",
      "https:/callback",
      "https://user:password@example.com/callback",
      "https://example.com/callback#fragment",
      "https://example.com:99999/callback",
    ).traverse_ { uri =>
      AuthConfigLoader.load[IO](env + ("DISCORD_REDIRECT_URI" -> uri), AppEnv.Prod).attempt.map {
        result =>
          assert(result.left.exists(_.getMessage.contains("DISCORD_REDIRECT_URI")))
          assert(result.left.forall(error => !error.getMessage.contains(uri)))
      }
    } *> AuthConfigLoader.load[IO](
      env + ("DISCORD_REDIRECT_URI" -> "https://example.com/callback"),
      AppEnv.Prod,
    ).map(config => assert(config.useSecureCookies))
  }

  test("production OAuth signing keys reject blank and short secrets without disclosing them") {
    val env = Map(
      "DISCORD_CLIENT_ID" -> "test-client",
      "DISCORD_CLIENT_SECRET" -> "test-client-secret",
      "DISCORD_REDIRECT_URI" -> "https://example.com/callback",
    )
    List(" " * 32, "\n", "short-test-secret").traverse_ { secret =>
      AuthConfigLoader.load[IO](
        env + ("AUTH_STATE_SIGNING_KEY" -> secret),
        AppEnv.Prod
      ).attempt.map { result =>
        assert(result.left.exists(_.getMessage.contains("AUTH_STATE_SIGNING_KEY")))
        assert(result.left.forall(error => !error.getMessage.contains(secret)))
      }
    }
  }
