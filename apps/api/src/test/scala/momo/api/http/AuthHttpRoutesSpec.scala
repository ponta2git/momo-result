package momo.api.http

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.std.SecureRandom
import cats.effect.{IO, Ref, Resource}
import org.http4s.implicits.*
import org.http4s.{Header, HttpApp as Http4sApp, Method, Request, ResponseCookie, Status}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{InMemoryAppSessionsRepository, InMemoryLoginAccountsRepository}
import momo.api.auth.{
  CsrfTokenService, DiscordOAuthClient, DiscordUser, InMemoryOAuthProviderBackoff, LoginRateLimiter,
  OAuthStateCodec, SessionService,
}
import momo.api.config.{AppConfig, AppEnv, AuthConfig}
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.errors.AppError
import momo.api.http.HttpAssertions.{assertProblem, headerValue}
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
  private def configFor(imageTmpDir: java.nio.file.Path, authConfigValue: AuthConfig) = AppConfig(
    appEnv = AppEnv.Test,
    httpHost = "127.0.0.1",
    httpPort = 0,
    imageTmpDir = imageTmpDir,
    devMemberIds = Nil,
    auth = authConfigValue,
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

  test("OAuth callback state replay is rate limited before calling the provider again") {
    val replayLimitedConfig = authConfig.copy(callbackStateRateLimitPerMinute = 1)
    RecordingDiscordOAuthClient.create(Right(DiscordUser(account.discordUserId.value))).flatMap {
      oauth =>
        authAppWith(oauth, replayLimitedConfig).use { app =>
          for
            stateCookie <- loginStateCookie(app, replayLimitedConfig)
            firstResponse <- app.run(callbackRequest(stateCookie))
            secondResponse <- app.run(callbackRequest(stateCookie))
            _ <- assertProblem(
              secondResponse,
              Status.TooManyRequests,
              "TOO_MANY_REQUESTS",
              "Too many OAuth callback attempts",
            )
            fetchCalls <- oauth.fetchCalls
          yield
            assertEquals(firstResponse.status, Status.Found)
            assertEquals(fetchCalls, 1)
        }
    }
  }

  test("OAuth provider dependency failures open a short backoff before the next provider call") {
    val backoffConfig = authConfig.copy(providerFailureThreshold = 1, providerBackoff = 60.seconds)
    RecordingDiscordOAuthClient
      .create(Left(AppError.DependencyFailed("Discord OAuth provider request failed.")))
      .flatMap { oauth =>
        authAppWith(oauth, backoffConfig).use { app =>
          for
            firstCookie <- loginStateCookie(app, backoffConfig)
            firstResponse <- app.run(callbackRequest(firstCookie))
            _ <- assertProblem(
              firstResponse,
              Status.ServiceUnavailable,
              "DEPENDENCY_FAILED",
              "Discord OAuth provider request failed",
            )
            secondCookie <- loginStateCookie(app, backoffConfig)
            secondResponse <- app.run(callbackRequest(secondCookie))
            _ <- assertProblem(
              secondResponse,
              Status.ServiceUnavailable,
              "DEPENDENCY_FAILED",
              "temporarily unavailable",
            )
            fetchCalls <- oauth.fetchCalls
          yield assertEquals(fetchCalls, 1)
        }
      }
  }

  private def authApp: Resource[IO, Http4sApp[IO]] =
    authAppWith(SuccessfulDiscordOAuthClient(account.discordUserId.value), authConfig)

  private def authAppWith(
      oauth: DiscordOAuthClient[IO],
      authConfigValue: AuthConfig,
  ): Resource[IO, Http4sApp[IO]] = tempDirectory("momo-result-auth-routes-test")
    .evalMap { imageTmpDir =>
      SecureRandom.javaSecuritySecureRandom[IO].flatMap { random =>
        given SecureRandom[IO] = random
        for
          sessionsRepo <- InMemoryAppSessionsRepository.create[IO]
          accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
          limiter <- LoginRateLimiter.create[IO](10, IO.pure(now))
          callbackStateLimiter <- LoginRateLimiter
            .create[IO](authConfigValue.callbackStateRateLimitPerMinute, IO.pure(now))
          providerBackoff <- InMemoryOAuthProviderBackoff.create[IO](
            authConfigValue.providerFailureThreshold,
            authConfigValue.providerBackoff,
            IO.pure(now),
          )
          sessions = SessionService[IO](sessionsRepo, accounts, authConfigValue, IO.pure(now))
          stateCodec = OAuthStateCodec[IO](authConfigValue, IO.pure(now))
        yield AuthHttpRoutes.routes[IO](
          config = configFor(imageTmpDir, authConfigValue),
          oauth = oauth,
          stateCodec = stateCodec,
          sessions = sessions,
          csrf = CsrfTokenService(),
          accounts = accounts,
          rateLimiter = limiter,
          callbackStateRateLimiter = callbackStateLimiter,
          providerBackoff = providerBackoff,
        ).orNotFound
      }
    }

  private def loginStateCookie(
      app: Http4sApp[IO],
      authConfigValue: AuthConfig,
  ): IO[ResponseCookie] = app.run(Request[IO](Method.GET, uri"/api/auth/login")).map { response =>
    response.cookies.find(_.name == authConfigValue.stateCookieName)
      .getOrElse(fail("missing OAuth state cookie"))
  }

  private def callbackRequest(stateCookie: ResponseCookie): Request[IO] = Request[IO](
    Method.GET,
    uri"/api/auth/callback".withQueryParam("code", "ok")
      .withQueryParam("state", stateCookie.content),
  ).putHeaders(Header.Raw(CIString("Cookie"), s"${stateCookie.name}=${stateCookie.content}"))

  private final class RecordingDiscordOAuthClient private (
      result: Either[AppError, DiscordUser],
      fetchCallRef: Ref[IO, Int],
  ) extends DiscordOAuthClient[IO]:
    def fetchCalls: IO[Int] = fetchCallRef.get

    override def authorizationUrl(state: String, prompt: Option[String]): IO[String] =
      val _ = prompt
      IO.pure(s"https://discord.example/oauth?state=$state")

    override def fetchUser(code: String): IO[Either[AppError, DiscordUser]] =
      val _ = code
      fetchCallRef.update(_ + 1).map(_ => result)

  private object RecordingDiscordOAuthClient:
    def create(result: Either[AppError, DiscordUser]): IO[RecordingDiscordOAuthClient] = Ref
      .of[IO, Int](0).map(new RecordingDiscordOAuthClient(result, _))
