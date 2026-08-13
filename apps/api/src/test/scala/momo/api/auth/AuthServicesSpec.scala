package momo.api.auth

import java.net.http.{HttpClient, HttpHeaders, HttpRequest, HttpResponse}
import java.net.{Authenticator, CookieHandler, ProxySelector, URI}
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Optional
import java.util.concurrent.{CompletableFuture, Executor, Flow}
import javax.net.ssl.{SSLContext, SSLParameters, SSLSession}

import scala.concurrent.duration.*

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.InMemoryLoginAccountsRepository
import momo.api.config.{AppEnv, AuthConfig}
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.errors.AppError
import momo.api.repositories.AppSession
import momo.api.testing.{
  RecordingAppSessionsRepository,
  RecordingDiscordOAuthClient,
  SuccessfulDiscordOAuthClient
}

final class AuthServicesSpec extends MomoCatsEffectSuite:
  private val config = AuthConfig.defaults(AppEnv.Test).copy(
    stateSigningKey = Some("test-signing-key"),
    stateTtl = 5.minutes,
    sessionTtl = 10.minutes,
    rateLimitPerMinute = 2,
  )

  private val instant = Instant.parse("2026-01-01T00:00:00Z")
  private val account = LoginAccount(
    id = AccountId.unsafeFromString("account_ponta"),
    discordUserId = UserId.unsafeFromString("123456789012345678"),
    displayName = "ぽんた",
    playerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    loginEnabled = true,
    isAdmin = true,
    createdAt = instant,
    updatedAt = instant,
  )

  test("OAuthStateCodec accepts signed state before expiry and rejects tampering") {
    val now = IO.pure(Instant.parse("2026-01-01T00:00:00Z"))
    val codec = OAuthStateCodec[IO](config, now)
    for
      state <- codec.create(silent = true, redirectPath = None)
      valid <- codec.validate(state)
      tampered <- codec.validate(state.dropRight(1) + "x")
    yield
      assertEquals(valid, Some(codec.Payload(silent = true, redirectPath = None)))
      assertEquals(tampered, None)
  }

  test("OAuthStateCodec rejects expired state") {
    val createdAt = Instant.parse("2026-01-01T00:00:00Z")
    for
      state <- OAuthStateCodec[IO](config, IO.pure(createdAt))
        .create(silent = false, redirectPath = None)
      valid <- OAuthStateCodec[IO](config, IO.pure(createdAt.plusSeconds(301))).validate(state)
    yield assertEquals(valid, None)
  }

  test("OAuthStateCodec preserves only safe root-relative redirect paths") {
    val now = IO.pure(Instant.parse("2026-01-01T00:00:00Z"))
    val codec = OAuthStateCodec[IO](config, now)
    for
      state <- codec.create(silent = true, redirectPath = Some("/exports?format=tsv#latest"))
      valid <- codec.validate(state)
      externalState <- codec.create(silent = true, redirectPath = Some("https://example.com/"))
      external <- codec.validate(externalState)
    yield
      assertEquals(
        valid,
        Some(codec.Payload(silent = true, redirectPath = Some("/exports?format=tsv#latest"))),
      )
      assertEquals(external, Some(codec.Payload(silent = true, redirectPath = None)))
  }

  test("CompleteOAuthLogin creates a session for an enabled allow-listed Discord account") {
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      backoff <- InMemoryOAuthProviderBackoff.create[IO](1, 60.seconds, IO.pure(instant))
      sessions = SessionService[IO](repo, accounts, config, IO.pure(instant))
      service = CompleteOAuthLogin[IO](
        SuccessfulDiscordOAuthClient(account.discordUserId.value),
        sessions,
        accounts,
        backoff,
      )
      result <- service.run("code")
      completion <- result match
        case Right(value) => IO.pure(value)
        case Left(failure) =>
          IO.raiseError(new AssertionError(s"expected completed login, got ${failure.reason}"))
      authenticated <- sessions.authenticate(Some(completion.session.cookieValue))
    yield
      assertEquals(completion.accountId, account.id)
      assertEquals(authenticated.map(_.account.accountId), Right(account.id))
  }

  test("CompleteOAuthLogin rejects Discord users without enabled login accounts") {
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](Nil)
      backoff <- InMemoryOAuthProviderBackoff.create[IO](1, 60.seconds, IO.pure(instant))
      sessions = SessionService[IO](repo, accounts, config, IO.pure(instant))
      service = CompleteOAuthLogin[IO](
        SuccessfulDiscordOAuthClient("223456789012345678"),
        sessions,
        accounts,
        backoff,
      )
      result <- service.run("code")
    yield result match
      case Left(failure) if failure.reason == OAuthLoginFailure.DiscordUserNotAllowed.reason => ()
      case other => fail(s"expected DiscordUserNotAllowed, got $other")
  }

  test("CompleteOAuthLogin opens provider backoff after dependency failures") {
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      oauth <- RecordingDiscordOAuthClient
        .create(Left(AppError.DependencyFailed("Discord OAuth provider request failed.")))
      backoff <- InMemoryOAuthProviderBackoff.create[IO](1, 60.seconds, IO.pure(instant))
      sessions = SessionService[IO](repo, accounts, config, IO.pure(instant))
      service = CompleteOAuthLogin[IO](oauth, sessions, accounts, backoff)
      first <- service.run("first")
      second <- service.run("second")
      fetchCalls <- oauth.fetchCalls
    yield
      assertProviderFailure(first, "Discord OAuth provider request failed")
      assertProviderFailure(second, "temporarily unavailable")
      assertEquals(fetchCalls, 1)
  }

  test("JavaDiscordOAuthClient maps token exchange transport failures to dependency errors") {
    val client = JavaDiscordOAuthClient[IO](
      config.copy(
        discordClientId = Some("client-id"),
        discordClientSecret = Some("client-secret"),
        discordRedirectUri = Some("https://example.com/api/auth/callback"),
      ),
      ThrowingHttpClient(RuntimeException("discord unavailable")),
    )

    client.fetchUser("code").map {
      case Left(error: AppError.DependencyFailed) =>
        assertEquals(error.detail, "Discord OAuth provider request failed.")
      case other => fail(s"expected dependency failure, got $other")
    }
  }

  test("JavaDiscordOAuthClient maps provider 429 token exchange responses to dependency errors") {
    val client = JavaDiscordOAuthClient[IO](
      config.copy(
        discordClientId = Some("client-id"),
        discordClientSecret = Some("client-secret"),
        discordRedirectUri = Some("https://example.com/api/auth/callback"),
      ),
      StaticHttpClient(429, "{}"),
    )

    client.fetchUser("code").map {
      case Left(error: AppError.DependencyFailed) =>
        assertEquals(error.detail, "Discord OAuth provider request failed.")
      case other => fail(s"expected dependency failure, got $other")
    }
  }

  test("JavaDiscordOAuthClient maps provider 400 token exchange responses to forbidden errors") {
    val client = JavaDiscordOAuthClient[IO](
      config.copy(
        discordClientId = Some("client-id"),
        discordClientSecret = Some("client-secret"),
        discordRedirectUri = Some("https://example.com/api/auth/callback"),
      ),
      StaticHttpClient(400, "{}"),
    )

    client.fetchUser("code").map {
      case Left(error: AppError.Forbidden) =>
        assertEquals(error.detail, "Discord OAuth token exchange failed.")
      case other => fail(s"expected forbidden failure, got $other")
    }
  }

  test("CsrfTokenService verifies the hashed session csrf secret"):
    for csrfHash <- SessionTokenHash.sha256[IO]("secret") yield
      val session = AppSession(
        idHash = "session-hash",
        accountId = AccountId.unsafeFromString("account_ponta"),
        playerMemberId = Some(MemberId.unsafeFromString("member_ponta")),
        csrfSecretHash = csrfHash,
        createdAt = Instant.EPOCH,
        lastSeenAt = Instant.EPOCH,
        expiresAt = Instant.EPOCH.plusSeconds(60),
      )
      val csrf = CsrfTokenService()

      assertEquals(csrf.verify(session, Some("secret")), Right(()))
      assertEquals(
        csrf.verify(session, Some("bad")),
        Left(momo.api.errors.AppError.Forbidden("A valid CSRF token is required.")),
      )

  test("SessionService stores only token hashes and authenticates the v1 cookie"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      service = SessionService[IO](repo, accounts, config, IO.pure(instant))
      created <- service.create(account)
      tokens = SessionCookieCodec.decode(created.cookieValue).getOrElse(fail("cookie decode"))
      snapshot <- repo.snapshot
      stored = snapshot.sessions.values.headOption.getOrElse(fail("session not stored"))
      authenticated <- service.authenticate(Some(created.cookieValue))
    yield
      assertNotEquals(stored.idHash, tokens.sessionToken)
      assertNotEquals(stored.csrfSecretHash, tokens.csrfToken)
      assertEquals(snapshot.sessions.keySet, Set(stored.idHash))
      assertEquals(
        authenticated.map(auth => (auth.account.accountId, auth.csrfToken)),
        Right(account.id -> tokens.csrfToken),
      )

  test("SessionService rejects legacy raw session cookies"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      service = SessionService[IO](repo, accounts, config, IO.pure(instant))
      result <- service.authenticate(Some("legacy-session-id"))
    yield assertEquals(result, Left(momo.api.errors.AppError.Unauthorized()))

  test("SessionService skips renewal while more than half the session TTL remains"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      nowRef <- IO.ref(instant)
      service = SessionService[IO](repo, accounts, config, nowRef.get)
      created <- service.create(account)
      _ <- nowRef.set(instant.plusSeconds(4.minutes.toSeconds))
      result <- service.authenticate(Some(created.cookieValue))
      snapshot <- repo.snapshot
    yield
      assertEquals(result.map(_.account.accountId), Right(account.id))
      assertEquals(snapshot.renews, 0)

  test("SessionService renews only after less than half the session TTL remains"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      nowRef <- IO.ref(instant)
      service = SessionService[IO](repo, accounts, config, nowRef.get)
      created <- service.create(account)
      _ <- nowRef.set(instant.plusSeconds(6.minutes.toSeconds))
      result <- service.authenticate(Some(created.cookieValue))
      snapshot <- repo.snapshot
      stored = snapshot.sessions.values.headOption.getOrElse(fail("session not stored"))
    yield
      assertEquals(result.map(_.account.accountId), Right(account.id))
      assertEquals(snapshot.renews, 1)
      assertEquals(stored.lastSeenAt, instant.plusSeconds(6.minutes.toSeconds))
      assertEquals(stored.expiresAt, instant.plusSeconds(16.minutes.toSeconds))

  test("SessionService deletes expired sessions during authentication"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      nowRef <- IO.ref(instant)
      service = SessionService[IO](repo, accounts, config, nowRef.get)
      created <- service.create(account)
      before <- repo.snapshot
      stored = before.sessions.values.headOption.getOrElse(fail("session not stored"))
      _ <- nowRef.set(instant.plusSeconds(config.sessionTtl.toSeconds + 1L))
      result <- service.authenticate(Some(created.cookieValue))
      after <- repo.snapshot
    yield
      assertEquals(result, Left(AppError.Unauthorized("Session has expired.")))
      assertEquals(after.sessions.get(stored.idHash), None)
      assertEquals(after.deletes, List(stored.idHash))

  test("SessionService deletes sessions for disabled accounts during authentication"):
    val disabled = account.copy(loginEnabled = false)
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(disabled))
      service = SessionService[IO](repo, accounts, config, IO.pure(instant))
      created <- service.create(disabled)
      before <- repo.snapshot
      stored = before.sessions.values.headOption.getOrElse(fail("session not stored"))
      result <- service.authenticate(Some(created.cookieValue))
      after <- repo.snapshot
    yield
      assertEquals(result, Left(AppError.Forbidden("This account is not allowed to log in.")))
      assertEquals(after.sessions.get(stored.idHash), None)
      assertEquals(after.deletes, List(stored.idHash))

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

  test("LoginRateLimiter evicts stale minute buckets") {
    for
      nowRef <- IO.ref(Instant.parse("2026-01-01T00:00:00Z"))
      limiter <- LoginRateLimiter.create[IO](2, nowRef.get)
      _ <- limiter.allow("ip-1")
      _ <- limiter.allow("ip-2")
      countBefore <- limiter.bucketCount
      _ <- nowRef.set(Instant.parse("2026-01-01T00:02:00Z"))
      _ <- limiter.allow("ip-3")
      countAfter <- limiter.bucketCount
    yield
      assertEquals(countBefore, 2)
      assertEquals(countAfter, 1)
  }

  test("InMemoryOAuthProviderBackoff opens after dependency failures and resets after cooldown") {
    for
      nowRef <- IO.ref(Instant.parse("2026-01-01T00:00:00Z"))
      backoff <- InMemoryOAuthProviderBackoff.create[IO](2, 60.seconds, nowRef.get)
      initiallyBlocked <- backoff.isBlocked
      firstOpened <- backoff.recordFailure(AppError.DependencyFailed("provider failed"))
      blockedAfterFirst <- backoff.isBlocked
      secondOpened <- backoff.recordFailure(AppError.DependencyFailed("provider failed"))
      blockedAfterSecond <- backoff.isBlocked
      _ <- nowRef.set(Instant.parse("2026-01-01T00:01:01Z"))
      blockedAfterCooldown <- backoff.isBlocked
    yield
      assert(!initiallyBlocked)
      assert(!firstOpened)
      assert(!blockedAfterFirst)
      assert(secondOpened)
      assert(blockedAfterSecond)
      assert(!blockedAfterCooldown)
  }

  private def assertProviderFailure(
      result: Either[OAuthLoginFailure, OAuthLoginCompletion],
      detail: String,
  ): Unit = result match
    case Left(OAuthLoginFailure.ProviderError(error: AppError.DependencyFailed)) =>
      assert(error.detail.contains(detail))
    case other => fail(s"expected provider dependency failure, got $other")

  private final case class ThrowingHttpClient(error: RuntimeException) extends HttpClient:
    override def cookieHandler(): Optional[CookieHandler] = Optional.empty()
    override def connectTimeout(): Optional[java.time.Duration] = Optional.empty()
    override def followRedirects(): HttpClient.Redirect = HttpClient.Redirect.NEVER
    override def proxy(): Optional[ProxySelector] = Optional.empty()
    override def sslContext(): SSLContext = SSLContext.getDefault
    override def sslParameters(): SSLParameters = SSLParameters()
    override def authenticator(): Optional[Authenticator] = Optional.empty()
    override def version(): HttpClient.Version = HttpClient.Version.HTTP_1_1
    override def executor(): Optional[Executor] = Optional.empty()
    override def send[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
    ): HttpResponse[T] = Optional.empty[HttpResponse[T]].orElseThrow(() => error)
    override def sendAsync[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
    ): CompletableFuture[HttpResponse[T]] = CompletableFuture.failedFuture(error)
    override def sendAsync[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
        pushPromiseHandler: HttpResponse.PushPromiseHandler[T],
    ): CompletableFuture[HttpResponse[T]] = CompletableFuture.failedFuture(error)

  private final case class StaticHttpClient(status: Int, responseBody: String) extends HttpClient:
    override def cookieHandler(): Optional[CookieHandler] = Optional.empty()
    override def connectTimeout(): Optional[java.time.Duration] = Optional.empty()
    override def followRedirects(): HttpClient.Redirect = HttpClient.Redirect.NEVER
    override def proxy(): Optional[ProxySelector] = Optional.empty()
    override def sslContext(): SSLContext = SSLContext.getDefault
    override def sslParameters(): SSLParameters = SSLParameters()
    override def authenticator(): Optional[Authenticator] = Optional.empty()
    override def version(): HttpClient.Version = HttpClient.Version.HTTP_1_1
    override def executor(): Optional[Executor] = Optional.empty()
    override def send[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
    ): HttpResponse[T] =
      val responseInfo = StaticResponseInfo(status)
      val subscriber = responseBodyHandler(responseInfo)
      subscriber.onSubscribe(
        new Flow.Subscription:
          override def request(n: Long): Unit =
            val _ = n
            ()
          override def cancel(): Unit = ()
      )
      subscriber
        .onNext(java.util.List.of(ByteBuffer.wrap(responseBody.getBytes(StandardCharsets.UTF_8))))
      subscriber.onComplete()
      StaticHttpResponse(status, subscriber.getBody.toCompletableFuture.get(), request)
    override def sendAsync[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
    ): CompletableFuture[HttpResponse[T]] = CompletableFuture
      .completedFuture(send(request, responseBodyHandler))
    override def sendAsync[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
        pushPromiseHandler: HttpResponse.PushPromiseHandler[T],
    ): CompletableFuture[HttpResponse[T]] =
      val _ = pushPromiseHandler
      CompletableFuture.completedFuture(send(request, responseBodyHandler))

  private final case class StaticResponseInfo(status: Int) extends HttpResponse.ResponseInfo:
    override def statusCode(): Int = status
    override def headers(): HttpHeaders = HttpHeaders
      .of(java.util.Collections.emptyMap[String, java.util.List[String]](), (_, _) => true)
    override def version(): HttpClient.Version = HttpClient.Version.HTTP_1_1

  private final case class StaticHttpResponse[T](
      status: Int,
      responseBody: T,
      httpRequest: HttpRequest,
  ) extends HttpResponse[T]:
    override def statusCode(): Int = status
    override def request(): HttpRequest = httpRequest
    override def previousResponse(): Optional[HttpResponse[T]] = Optional.empty()
    override def headers(): HttpHeaders = HttpHeaders
      .of(java.util.Collections.emptyMap[String, java.util.List[String]](), (_, _) => true)
    override def body(): T = responseBody
    override def sslSession(): Optional[SSLSession] = Optional.empty()
    override def uri(): URI = httpRequest.uri()
    override def version(): HttpClient.Version = HttpClient.Version.HTTP_1_1
