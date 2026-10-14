package momo.api.auth

import java.net.http.{HttpClient, HttpHeaders, HttpRequest, HttpResponse}
import java.net.{Authenticator, CookieHandler, ProxySelector, URI}
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Optional
import java.util.concurrent.{
  CompletableFuture,
  ConcurrentLinkedQueue,
  CountDownLatch,
  Executor,
  Flow,
  TimeUnit
}
import javax.net.ssl.{SSLContext, SSLParameters, SSLSession}

import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Failure

import cats.effect.{Deferred, IO}
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.discord.JavaDiscordOAuthClient
import momo.api.adapters.inmemory.{
  InMemoryAppSessionsRepository,
  InMemoryLoginAccountAdministrationRepository,
  InMemoryLoginAccountsRepository
}
import momo.api.config.{AppEnv, AuthConfig}
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.domain.{AccountRole, LoginAccount}
import momo.api.errors.AppError
import momo.api.repositories.{
  AppSession,
  AppSessionsRepository,
  LoginSessionCreationRepository,
  SessionAccountLookup,
  UpdateLoginAccountData
}
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
    role = AccountRole.Admin,
    createdAt = instant,
    updatedAt = instant,
  )

  test("OAuthStateCodec accepts signed state before expiry and rejects tampering") {
    val codec = stateCodec(IO.pure(instant))
    for
      state <- codec.create(silent = true, redirectPath = None)
      valid <- codec.validate(state)
      tampered <- codec.validate(state.dropRight(1) + "x")
    yield
      assertEquals(valid, Some(codec.Payload(true, None, instant.plusSeconds(300))))
      assertEquals(tampered, None)
  }

  test("OAuthStateCodec rejects expired state") {
    for
      state <- stateCodec(IO.pure(instant)).create(silent = false, redirectPath = None)
      valid <- stateCodec(IO.pure(instant.plusSeconds(301))).validate(state)
    yield assertEquals(valid, None)
  }

  test("OAuthStateCodec rejects alternate encodings of the same signed payload") {
    val codec = stateCodec(IO.pure(instant))
    for
      state <- codec.create(silent = false, redirectPath = None)
      separator = state.indexOf('.')
      payload = state.take(separator)
      padding = "=" * ((4 - payload.length % 4) % 4)
      _ = assert(padding.nonEmpty)
      _ = assertEquals(
        Base64Url.decode(payload + padding).map(_.toList),
        Base64Url.decode(payload).map(_.toList)
      )
      aliased <- codec.validate(payload + padding + state.drop(separator))
      valid <- codec.validate(state)
    yield
      assertEquals(aliased, None)
      assert(valid.nonEmpty)
  }

  test("OAuthStateCodec preserves only safe root-relative redirect paths") {
    val codec = stateCodec(IO.pure(instant))
    for
      state <- codec.create(silent = true, redirectPath = Some("/exports?format=tsv#latest"))
      valid <- codec.validate(state)
      externalState <- codec.create(silent = true, redirectPath = Some("https://example.com/"))
      external <- codec.validate(externalState)
    yield
      assertEquals(
        valid,
        Some(codec.Payload(true, Some("/exports?format=tsv#latest"), instant.plusSeconds(300))),
      )
      assertEquals(external, Some(codec.Payload(true, None, instant.plusSeconds(300))))
  }

  test("OAuthStateCodec bounds redirect UTF-8 bytes so issued state remains a usable cookie") {
    val codec = stateCodec(IO.pure(instant))
    val boundaryPath = "/" + ("あ" * 341)
    for
      state <- codec.create(silent = false, redirectPath = Some(boundaryPath))
      valid <- codec.validate(state)
      oversized <- codec.create(silent = false, redirectPath = Some(boundaryPath + "a"))
      fallback <- codec.validate(oversized)
      rejected <- codec.validate("a" * 10000)
    yield
      assertEquals(valid, Some(codec.Payload(false, Some(boundaryPath), instant.plusSeconds(300))))
      assert(state.length < 4096)
      assertEquals(fallback, Some(codec.Payload(false, None, instant.plusSeconds(300))))
      assertEquals(rejected, None)
  }

  test("CompleteOAuthLogin creates a session for an enabled allow-listed Discord account") {
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      backoff <- InMemoryOAuthProviderBackoff.create[IO](1, 60.seconds, IO.pure(instant))
      sessions = sessionService(repo, accounts, IO.pure(instant))
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
      sessions = sessionService(repo, accounts, IO.pure(instant))
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
      sessions = sessionService(repo, accounts, IO.pure(instant))
      service = CompleteOAuthLogin[IO](oauth, sessions, accounts, backoff)
      first <- service.run("first")
      second <- service.run("second")
      fetchCalls <- oauth.fetchCalls
    yield
      assertProviderFailure(first, "Discord OAuth provider request failed")
      assertProviderFailure(second, "temporarily unavailable")
      assertEquals(fetchCalls, 1)
  }

  test("CompleteOAuthCallback validates signatures before consuming state") {
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      backoff <- InMemoryOAuthProviderBackoff.create[IO](1, 60.seconds, IO.pure(instant))
      reservations <- IO.ref(0)
      guard = new OAuthStateReplayGuard[IO]:
        def consume(stateHash: String, expiresAt: Instant): IO[Boolean] =
          val _ = (stateHash, expiresAt)
          reservations.update(_ + 1).as(true)
      sessions = sessionService(repo, accounts, IO.pure(instant))
      codec = stateCodec(IO.pure(instant))
      service = CompleteOAuthCallback[IO](
        codec,
        CompleteOAuthLogin[IO](
          SuccessfulDiscordOAuthClient(account.discordUserId.value),
          sessions,
          accounts,
          backoff
        ),
        guard,
        "/",
      )
      invalid <- service.run(OAuthCallbackInput(None, Some("forged"), Some("forged"), None))
      countAfterInvalid <- reservations.get
      state <- codec.create(silent = false, redirectPath = None)
      valid <- service.run(OAuthCallbackInput(None, Some(state), Some(state), None))
      countAfterValid <- reservations.get
    yield
      List(invalid, valid).foreach {
        case OAuthCallbackDecision.Rejected(_, _) => ()
        case other => fail(s"expected rejected OAuth callback, got $other")
      }
      assertEquals(countAfterInvalid, 0)
      assertEquals(countAfterValid, 1)
  }

  test("CompleteOAuthCallback fails closed when shared state consumption is unavailable") {
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      backoff <- InMemoryOAuthProviderBackoff.create[IO](1, 60.seconds, IO.pure(instant))
      oauth <- RecordingDiscordOAuthClient.create(Right(DiscordUser(account.discordUserId.value)))
      guard = new OAuthStateReplayGuard[IO]:
        def consume(stateHash: String, expiresAt: Instant): IO[Boolean] =
          val _ = (stateHash, expiresAt)
          IO.raiseError(new IllegalStateException("state store unavailable"))
      sessions = sessionService(repo, accounts, IO.pure(instant))
      codec = stateCodec(IO.pure(instant))
      service = CompleteOAuthCallback[IO](
        codec,
        CompleteOAuthLogin[IO](oauth, sessions, accounts, backoff),
        guard,
        "/",
      )
      state <- codec.create(silent = false, redirectPath = None)
      result <-
        service.run(OAuthCallbackInput(Some("code"), Some(state), Some(state), None)).attempt
      providerCalls <- oauth.fetchCalls
    yield
      assert(result.isLeft)
      assertEquals(providerCalls, 0)
  }

  test("JavaDiscordOAuthClient maps token exchange transport failures to dependency errors") {
    val client = JavaDiscordOAuthClient[IO](
      JavaDiscordOAuthClient.Config(
        "client-id",
        "client-secret",
        "https://example.com/api/auth/callback",
        "identify",
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
      JavaDiscordOAuthClient.Config(
        "client-id",
        "client-secret",
        "https://example.com/api/auth/callback",
        "identify",
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
      JavaDiscordOAuthClient.Config(
        "client-id",
        "client-secret",
        "https://example.com/api/auth/callback",
        "identify",
      ),
      StaticHttpClient(400, "{}"),
    )

    client.fetchUser("code").map {
      case Left(error: AppError.Forbidden) =>
        assertEquals(error.detail, "Discord OAuth token exchange failed.")
      case other => fail(s"expected forbidden failure, got $other")
    }
  }

  test("JavaDiscordOAuthClient bounds provider bodies before decoding or user lookup") {
    val requests = new ConcurrentLinkedQueue[HttpRequest]()
    val response = s"""{"access_token":"${"a" * JavaDiscordOAuthClient.MaxResponseBytes.toInt}"}"""
    val client = JavaDiscordOAuthClient[IO](
      JavaDiscordOAuthClient.Config(
        "client-id",
        "client-secret",
        "https://example.com/callback",
        "identify"
      ),
      StaticHttpClient { request =>
        val _ = requests.add(request)
        (200, response)
      },
    )
    client.fetchUser("code").map { result =>
      assert(result.left.exists {
        case _: AppError.DependencyFailed => true
        case _ => false
      })
      assertEquals(requests.size(), 1)
    }
  }

  private def userLookupResponses: List[(String, Int, String, Either[AppError, DiscordUser])] =
    List(
      (
        "valid user",
        200,
        """{"id":"123456789012345678"}""",
        Right(DiscordUser(account.discordUserId.value))
      ),
      ("forbidden user", 401, "{}", Left(AppError.Forbidden("Discord user lookup failed."))),
      (
        "rate limited provider",
        429,
        "{}",
        Left(AppError.DependencyFailed("Discord OAuth provider request failed."))
      ),
      (
        "invalid user response",
        200,
        "{}",
        Left(AppError.DependencyFailed("Discord user response is invalid."))
      ),
    )

  userLookupResponses.foreach { case (label, status, body, expected) =>
    test(s"JavaDiscordOAuthClient exchanges a token then handles $label") {
      val requests = ConcurrentLinkedQueue[HttpRequest]()
      val http = StaticHttpClient { request =>
        val _ = requests.add(request)
        if request.uri().getPath == "/api/oauth2/token" then
          (200, """{"access_token":"test-access-token"}""")
        else (status, body)
      }
      val client = JavaDiscordOAuthClient[IO](
        JavaDiscordOAuthClient.Config(
          "client-id",
          "client-secret",
          "https://example.com/api/auth/callback",
          "identify",
        ),
        http,
      )
      client.fetchUser("code").map { result =>
        assertEquals(result, expected)
        val sent = requests.iterator().asScala.toList
        assertEquals(
          sent.map(request => request.method() -> request.uri().toString),
          List(
            "POST" -> "https://discord.com/api/oauth2/token",
            "GET" -> "https://discord.com/api/users/@me",
          ),
        )
        assertEquals(
          sent.map(_.headers().firstValue("Authorization").orElse("")),
          List("", "Bearer test-access-token"),
        )
      }
    }
  }

  test("JavaDiscordOAuthClient interrupts a blocking provider request when canceled") {
    val entered = CountDownLatch(1)
    val interrupted = CountDownLatch(1)
    val client = JavaDiscordOAuthClient[IO](
      JavaDiscordOAuthClient.Config(
        "client-id",
        "client-secret",
        "https://example.com/api/auth/callback",
        "identify",
      ),
      InterruptibleHttpClient(entered, interrupted),
    )

    for
      fiber <- client.fetchUser("code").start
      requestEntered <- IO.blocking(entered.await(1L, TimeUnit.SECONDS))
      _ = assert(requestEntered, "provider request did not enter HttpClient.send")
      _ <- fiber.cancel
      interruptionObserved <- IO.blocking(interrupted.await(1L, TimeUnit.SECONDS))
    yield assert(interruptionObserved, "cancel did not interrupt HttpClient.send")
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
      service = sessionService(repo, accounts, IO.pure(instant))
      created <- createdSession(service, account)
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
      service = sessionService(repo, accounts, IO.pure(instant))
      result <- service.authenticate(Some("legacy-session-id"))
    yield assertEquals(result, Left(momo.api.errors.AppError.Unauthorized()))

  test("SessionService rejects malformed cookie credentials before accessing persistence"):
    for
      repo <- RecordingAppSessionsRepository.create
      lookups <- IO.ref(0)
      lookup = new SessionAccountLookup[IO]:
        def find(idHash: String) =
          val _ = idHash
          lookups.update(_ + 1).as(None)
      creation = new LoginSessionCreationRepository[IO]:
        def createIfAccountCurrent(session: AppSession, expectedAccountUpdatedAt: Instant) =
          val _ = (session, expectedAccountUpdatedAt)
          IO.raiseError[Boolean](new IllegalStateException("session creation was not expected"))
      service = SessionService[IO](repo, config.sessionTtl, IO.pure(instant), lookup, creation)
      results <- List(
        "v1.a.b",
        s"v1.${"a" * 43}.${"!" * 43}",
        s"v1.${"a" * 10000}.${"b" * 43}",
      ).traverse(cookie => service.authenticate(Some(cookie)))
      lookupCount <- lookups.get
    yield
      results.foreach(result =>
        assertEquals(result.left.toOption.map(_.code), Some("UNAUTHORIZED"))
      )
      assertEquals(lookupCount, 0)

  test("SessionService skips renewal while more than half the session TTL remains"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      nowRef <- IO.ref(instant)
      service = sessionService(repo, accounts, nowRef.get)
      created <- createdSession(service, account)
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
      service = sessionService(repo, accounts, nowRef.get)
      created <- createdSession(service, account)
      _ <- nowRef.set(instant.plusSeconds(6.minutes.toSeconds))
      result <- service.authenticate(Some(created.cookieValue))
      snapshot <- repo.snapshot
      stored = snapshot.sessions.values.headOption.getOrElse(fail("session not stored"))
    yield
      assertEquals(result.map(_.account.accountId), Right(account.id))
      assertEquals(snapshot.renews, 1)
      assertEquals(stored.lastSeenAt, instant.plusSeconds(6.minutes.toSeconds))
      assertEquals(stored.expiresAt, instant.plusSeconds(16.minutes.toSeconds))

  test("SessionService rejects expired sessions and leaves cleanup to expiry pruning"):
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      nowRef <- IO.ref(instant)
      service = sessionService(repo, accounts, nowRef.get)
      created <- createdSession(service, account)
      before <- repo.snapshot
      stored = before.sessions.values.headOption.getOrElse(fail("session not stored"))
      _ <- nowRef.set(instant.plusSeconds(config.sessionTtl.toSeconds + 1L))
      result <- service.authenticate(Some(created.cookieValue))
      after <- repo.snapshot
      pruned <- repo.deleteExpired(instant.plusSeconds(config.sessionTtl.toSeconds + 1L))
      remaining <- repo.find(stored.idHash)
    yield
      assertEquals(result, Left(AppError.Unauthorized("Session has expired.")))
      assertEquals(after.sessions.get(stored.idHash), Some(stored))
      assertEquals(after.deletes, Nil)
      assertEquals(pruned, 1)
      assertEquals(remaining, None)

  test("SessionService expiry rejection cannot revoke a concurrently renewed session"):
    val renewingAt = instant.plusSeconds(config.sessionTtl.toSeconds - 1L)
    val expiredAt = instant.plusSeconds(config.sessionTtl.toSeconds + 1L)
    for
      repo <- InMemoryAppSessionsRepository.create[IO]
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      created <- createdSession(sessionService(repo, accounts, IO.pure(instant)), account)
      renewingLookupStarted <- Deferred[IO, Unit]
      releaseRenewingLookup <- Deferred[IO, Unit]
      expiredSnapshotRead <- Deferred[IO, Unit]
      releaseExpiredSnapshot <- Deferred[IO, Unit]
      lookup = SessionAccountLookup.fromRepositories(repo, accounts)
      renewingLookup = new SessionAccountLookup[IO]:
        def find(idHash: String) =
          renewingLookupStarted.complete(()) *> releaseRenewingLookup.get *> lookup.find(idHash)
      expiredLookup = new SessionAccountLookup[IO]:
        def find(idHash: String) = lookup.find(idHash).flatTap(_ =>
          expiredSnapshotRead.complete(()) *> releaseExpiredSnapshot.get
        )
      creation = InMemoryLoginAccountAdministrationRepository(accounts, repo)
      renewing = SessionService[IO](
        repo,
        config.sessionTtl,
        IO.pure(renewingAt),
        renewingLookup,
        creation,
      )
      expiring = SessionService[IO](
        repo,
        config.sessionTtl,
        IO.pure(expiredAt),
        expiredLookup,
        creation,
      )
      results <- renewing.authenticate(Some(created.cookieValue)).background.use { renewed =>
        renewingLookupStarted.get *>
          expiring.authenticate(Some(created.cookieValue)).background.use { expired =>
            for
              _ <- expiredSnapshotRead.get
              _ <- releaseRenewingLookup.complete(())
              renewedResult <- renewed.flatMap(_.embedNever)
              _ <- releaseExpiredSnapshot.complete(())
              expiredResult <- expired.flatMap(_.embedNever)
              freshResult <- sessionService(repo, accounts, IO.pure(expiredAt))
                .authenticate(Some(created.cookieValue))
            yield (renewedResult, expiredResult, freshResult)
          }
      }
    yield
      assertEquals(
        results._1.map(_.session.expiresAt),
        Right(renewingAt.plusSeconds(config.sessionTtl.toSeconds)),
      )
      assertEquals(results._2, Left(AppError.Unauthorized("Session has expired.")))
      assertEquals(results._3.map(_.account.accountId), Right(account.id))

  test("SessionService delayed renewal cannot shorten a newer session lifetime"):
    val earlierAt = instant.plusSeconds(6.minutes.toSeconds)
    val laterAt = earlierAt.plusSeconds(2)
    val afterEarlierExpiry = earlierAt.plusSeconds(config.sessionTtl.toSeconds + 1L)
    for
      repo <- InMemoryAppSessionsRepository.create[IO]
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      created <- createdSession(sessionService(repo, accounts, IO.pure(instant)), account)
      earlierSnapshotRead <- Deferred[IO, Unit]
      releaseEarlierSnapshot <- Deferred[IO, Unit]
      lookup = SessionAccountLookup.fromRepositories(repo, accounts)
      earlierLookup = new SessionAccountLookup[IO]:
        def find(idHash: String) = lookup.find(idHash).flatTap(_ =>
          earlierSnapshotRead.complete(()) *> releaseEarlierSnapshot.get
        )
      earlier = SessionService[IO](
        repo,
        config.sessionTtl,
        IO.pure(earlierAt),
        earlierLookup,
        InMemoryLoginAccountAdministrationRepository(accounts, repo),
      )
      results <- earlier.authenticate(Some(created.cookieValue)).background.use { completion =>
        for
          _ <- earlierSnapshotRead.get
          laterResult <- sessionService(repo, accounts, IO.pure(laterAt))
            .authenticate(Some(created.cookieValue))
          _ <- releaseEarlierSnapshot.complete(())
          earlierResult <- completion.flatMap(_.embedNever)
          freshResult <- sessionService(repo, accounts, IO.pure(afterEarlierExpiry))
            .authenticate(Some(created.cookieValue))
        yield (earlierResult, laterResult, freshResult)
      }
    yield
      assertEquals(results._1.map(_.account.accountId), Right(account.id))
      assertEquals(results._2.map(_.account.accountId), Right(account.id))
      assertEquals(results._3.map(_.account.accountId), Right(account.id))

  test("SessionService deletes sessions for disabled accounts during authentication"):
    val disabled = account.copy(loginEnabled = false)
    for
      repo <- RecordingAppSessionsRepository.create
      enabledAccounts <- InMemoryLoginAccountsRepository.create[IO](List(account))
      created <- createdSession(sessionService(repo, enabledAccounts, IO.pure(instant)), account)
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(disabled))
      service = sessionService(repo, accounts, IO.pure(instant))
      before <- repo.snapshot
      stored = before.sessions.values.headOption.getOrElse(fail("session not stored"))
      result <- service.authenticate(Some(created.cookieValue))
      after <- repo.snapshot
    yield
      assertEquals(result, Left(AppError.Forbidden("This account is not allowed to log in.")))
      assertEquals(after.sessions.get(stored.idHash), None)
      assertEquals(after.deletes, List(stored.idHash))

  test(
    "SessionService rejects login snapshots invalidated by disabling and re-enabling the account"
  ) {
    val backup = account.copy(
      id = AccountId.unsafeFromString("account_backup"),
      discordUserId = UserId.unsafeFromString("223456789012345678"),
    )
    for
      repo <- RecordingAppSessionsRepository.create
      accounts <- InMemoryLoginAccountsRepository.create[IO](List(account, backup))
      lifecycle = InMemoryLoginAccountAdministrationRepository(accounts, repo)
      service = sessionService(repo, accounts, IO.pure(instant))
      old <- createdSession(service, account)
      _ <- lifecycle.updateAndRevokeSessionsWhenDisabled(
        account.id,
        UpdateLoginAccountData(None, None, Some(false), None, instant.plusSeconds(1))
      )
      disabled <- service.create(account)
      _ <- lifecycle.updateAndRevokeSessionsWhenDisabled(
        account.id,
        UpdateLoginAccountData(None, None, Some(true), None, instant.plusSeconds(2))
      )
      stale <- service.create(account)
      revoked <- service.authenticate(Some(old.cookieValue))
      current <- accounts.find(account.id).map(_.getOrElse(fail("account missing")))
      fresh <- createdSession(service, current)
      authenticated <- service.authenticate(Some(fresh.cookieValue))
      stored <- repo.snapshot
    yield
      assertEquals(disabled.left.toOption.map(_.code), Some("FORBIDDEN"))
      assertEquals(stale.left.toOption.map(_.code), Some("FORBIDDEN"))
      assertEquals(revoked.left.toOption.map(_.code), Some("UNAUTHORIZED"))
      assertEquals(authenticated.map(_.account.accountId), Right(account.id))
      assertEquals(stored.sessions.size, 1)
  }

  private def stateCodec(now: IO[Instant]): OAuthStateCodec[IO] = OAuthStateCodec[IO](
    config.stateSigningKey.getOrElse("test-signing-key"),
    config.stateTtl,
    now,
  )

  private def sessionService(
      sessions: AppSessionsRepository[IO],
      accounts: InMemoryLoginAccountsRepository[IO],
      now: IO[Instant],
  ): SessionService[IO] = SessionService[IO](
    sessions,
    config.sessionTtl,
    now,
    SessionAccountLookup.fromRepositories(sessions, accounts),
    InMemoryLoginAccountAdministrationRepository(accounts, sessions)
  )

  private def createdSession(
      service: SessionService[IO],
      account: LoginAccount
  ): IO[CreatedSession] =
    service.create(account).map(_.fold(error => fail(s"session rejected: ${error.code}"), identity))

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

  test("LoginRateLimiter bounds unique keys without evicting an existing account's quota") {
    for
      nowRef <- IO.ref(instant)
      limiter <- LoginRateLimiter.create[IO](2, nowRef.get, maxKeys = 2)
      first <- limiter.allow("first")
      second <- limiter.allow("second")
      overflow <- limiter.allow("third")
      existing <- limiter.allow("first")
      exhausted <- limiter.allow("first")
      count <- limiter.bucketCount
      _ <- nowRef.set(instant.plusSeconds(60))
      nextWindow <- limiter.allow("third")
      nextCount <- limiter.bucketCount
    yield
      assert(first && second && existing && nextWindow)
      assert(!overflow && !exhausted)
      assertEquals(count, 2)
      assertEquals(nextCount, 1)
  }

  test("LoginRateLimiter does not reopen exhausted quotas when the wall clock moves backwards") {
    for
      nowRef <- IO.ref(instant)
      limiter <- LoginRateLimiter.create[IO](1, nowRef.get)
      first <- limiter.allow("client")
      _ <- nowRef.set(instant.minusSeconds(60))
      backwards <- limiter.allow("client")
      _ <- nowRef.set(instant.plusSeconds(60))
      later <- limiter.allow("client")
    yield
      assert(first && later)
      assert(!backwards)
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
      _ <- nowRef.set(Instant.parse("2026-01-01T00:00:30Z"))
      reopenedWhileBlocked <- backoff.recordFailure(AppError.DependencyFailed("provider failed"))
      _ <- backoff.recordSuccess
      blockedAfterConcurrentSuccess <- backoff.isBlocked
      _ <- nowRef.set(Instant.parse("2026-01-01T00:01:01Z"))
      blockedAfterCooldown <- backoff.isBlocked
    yield
      assert(!initiallyBlocked)
      assert(!firstOpened)
      assert(!blockedAfterFirst)
      assert(secondOpened)
      assert(blockedAfterSecond)
      assert(!reopenedWhileBlocked)
      assert(blockedAfterConcurrentSuccess)
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

  private final case class StaticHttpClient(respond: HttpRequest => (Int, String))
      extends HttpClient:
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
      val (status, responseBody) = respond(request)
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

  private object StaticHttpClient:
    def apply(status: Int, responseBody: String): StaticHttpClient =
      new StaticHttpClient(_ => (status, responseBody))

  private final case class InterruptibleHttpClient(
      entered: CountDownLatch,
      interrupted: CountDownLatch,
  ) extends HttpClient:
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
      val _ = (request, responseBodyHandler)
      entered.countDown()
      try
        CountDownLatch(1).await()
        Failure[HttpResponse[T]](new AssertionError("unreachable")).get
      catch
        case error: InterruptedException =>
          interrupted.countDown()
          Failure[HttpResponse[T]](error).get
    override def sendAsync[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
    ): CompletableFuture[HttpResponse[T]] = CompletableFuture.failedFuture(
      new UnsupportedOperationException("sendAsync is not used by this test")
    )
    override def sendAsync[T](
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler[T],
        pushPromiseHandler: HttpResponse.PushPromiseHandler[T],
    ): CompletableFuture[HttpResponse[T]] = CompletableFuture.failedFuture(
      new UnsupportedOperationException("sendAsync is not used by this test")
    )

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
