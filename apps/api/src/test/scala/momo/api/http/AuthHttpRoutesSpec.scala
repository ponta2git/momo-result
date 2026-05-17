package momo.api.http

import java.time.Instant

import cats.effect.std.SecureRandom
import cats.effect.{IO, Resource}
import org.http4s.implicits.*
import org.http4s.{Header, HttpApp as Http4sApp, Method, Request, Status}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{InMemoryAppSessionsRepository, InMemoryLoginAccountsRepository}
import momo.api.auth.{CsrfTokenService, LoginRateLimiter, OAuthStateCodec, SessionService}
import momo.api.config.{AppConfig, AppEnv, AuthConfig}
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.http.HttpAssertions.headerValue
import momo.api.testing.SuccessfulDiscordOAuthClient

final class AuthHttpRoutesSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-14T00:00:00Z")
  private val authConfig = AuthConfig.defaults(AppEnv.Test).copy(
    discordClientId = Some("client-id"),
    discordClientSecret = Some("client-secret"),
    discordRedirectUri = Some("https://example.com/api/auth/callback"),
    stateSigningKey = Some("state-signing-key"),
    callbackRedirectPath = "/fallback",
  )
  private def configFor(imageTmpDir: java.nio.file.Path) = AppConfig(
    appEnv = AppEnv.Test,
    httpHost = "127.0.0.1",
    httpPort = 0,
    imageTmpDir = imageTmpDir,
    devMemberIds = Nil,
    auth = authConfig,
  )
  private val account = LoginAccount(
    id = AccountId.unsafeFromString("account_ponta"),
    discordUserId = UserId.unsafeFromString("123456789012345678"),
    displayName = "ぽんた",
    playerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    loginEnabled = true,
    isAdmin = true,
    createdAt = now,
    updatedAt = now,
  )

  test("OAuth callback redirects to the signed safe next path after successful login") {
    authApp.use { app =>
      val loginRequest = Request[IO](
        Method.GET,
        uri"/api/auth/login".withQueryParam("silent", "1")
          .withQueryParam("next", "/matches/match-1/edit?tab=summary"),
      )
      for
        loginResponse <- app.run(loginRequest)
        stateCookie = loginResponse.cookies.find(_.name == authConfig.stateCookieName)
          .getOrElse(fail("missing OAuth state cookie"))
        callbackRequest = Request[IO](
          Method.GET,
          uri"/api/auth/callback".withQueryParam("code", "ok")
            .withQueryParam("state", stateCookie.content),
        ).putHeaders(Header.Raw(CIString("Cookie"), s"${stateCookie.name}=${stateCookie.content}"))
        callbackResponse <- app.run(callbackRequest)
      yield
        assertEquals(callbackResponse.status, Status.Found)
        assertEquals(
          headerValue(callbackResponse, CIString("Location")),
          "/matches/match-1/edit?tab=summary",
        )
        assert(callbackResponse.cookies.exists(_.name == authConfig.sessionCookieName))
    }
  }

  private def authApp: Resource[IO, Http4sApp[IO]] = tempDirectory("momo-result-auth-routes-test")
    .evalMap { imageTmpDir =>
      SecureRandom.javaSecuritySecureRandom[IO].flatMap { random =>
        given SecureRandom[IO] = random
        for
          sessionsRepo <- InMemoryAppSessionsRepository.create[IO]
          accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
          limiter <- LoginRateLimiter.create[IO](10, IO.pure(now))
          sessions = SessionService[IO](sessionsRepo, accounts, authConfig, IO.pure(now))
          stateCodec = OAuthStateCodec[IO](authConfig, IO.pure(now))
        yield AuthHttpRoutes.routes[IO](
          config = configFor(imageTmpDir),
          oauth = SuccessfulDiscordOAuthClient(account.discordUserId.value),
          stateCodec = stateCodec,
          sessions = sessions,
          csrf = CsrfTokenService(),
          accounts = accounts,
          rateLimiter = limiter,
        ).orNotFound
      }
    }
