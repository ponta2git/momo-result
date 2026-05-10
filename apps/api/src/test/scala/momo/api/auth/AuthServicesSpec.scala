package momo.api.auth

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.InMemoryLoginAccountsRepository
import momo.api.config.{AppEnv, AuthConfig}
import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.repositories.{AppSession, AppSessionsRepository}

final class AuthServicesSpec extends MomoCatsEffectSuite:
  private val config = AuthConfig.defaults(AppEnv.Test).copy(
    stateSigningKey = Some("test-signing-key"),
    stateTtl = 5.minutes,
    sessionTtl = 10.minutes,
    rateLimitPerMinute = 2,
  )

  private val instant = Instant.parse("2026-01-01T00:00:00Z")
  private val account = LoginAccount(
    id = AccountId("account_ponta"),
    discordUserId = UserId("123456789012345678"),
    displayName = "ぽんた",
    playerMemberId = Some(MemberId("member_ponta")),
    loginEnabled = true,
    isAdmin = true,
    createdAt = instant,
    updatedAt = instant,
  )

  test("OAuthStateCodec accepts signed state before expiry and rejects tampering") {
    val now = IO.pure(Instant.parse("2026-01-01T00:00:00Z"))
    val codec = OAuthStateCodec[IO](config, now)
    for
      state <- codec.create(silent = true)
      valid <- codec.validate(state)
      tampered <- codec.validate(state.dropRight(1) + "x")
    yield
      assertEquals(valid, Some(codec.Payload(silent = true)))
      assertEquals(tampered, None)
  }

  test("OAuthStateCodec rejects expired state") {
    val createdAt = Instant.parse("2026-01-01T00:00:00Z")
    for
      state <- OAuthStateCodec[IO](config, IO.pure(createdAt)).create(silent = false)
      valid <- OAuthStateCodec[IO](config, IO.pure(createdAt.plusSeconds(301))).validate(state)
    yield assertEquals(valid, None)
  }

  test("CsrfTokenService verifies the hashed session csrf secret"):
    for csrfHash <- SessionTokenHash.sha256[IO]("secret") yield
      val session = AppSession(
        idHash = "session-hash",
        accountId = AccountId("account_ponta"),
        playerMemberId = Some(MemberId("member_ponta")),
        csrfSecretHash = csrfHash,
        createdAt = Instant.EPOCH,
        lastSeenAt = Instant.EPOCH,
        expiresAt = Instant.EPOCH.plusSeconds(60),
      )
      val csrf = CsrfTokenService()

      assert(csrf.verify(session, Some("secret")).isRight)
      assert(csrf.verify(session, Some("bad")).isLeft)

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
      assert(authenticated.isRight, s"expected authenticated session, got $authenticated")
      assertEquals(authenticated.toOption.map(_.csrfToken), Some(tokens.csrfToken))

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
      assert(result.isRight, s"expected authenticated session, got $result")
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
      assert(result.isRight, s"expected authenticated session, got $result")
      assertEquals(snapshot.renews, 1)
      assertEquals(stored.lastSeenAt, instant.plusSeconds(6.minutes.toSeconds))
      assertEquals(stored.expiresAt, instant.plusSeconds(16.minutes.toSeconds))

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

private final case class SessionRepoSnapshot(
    sessions: Map[String, AppSession],
    renews: Int,
    deletes: List[String],
)

private final class RecordingAppSessionsRepository(ref: Ref[IO, SessionRepoSnapshot])
    extends AppSessionsRepository[IO]:
  def snapshot: IO[SessionRepoSnapshot] = ref.get

  override def find(idHash: String): IO[Option[AppSession]] = ref.get.map(_.sessions.get(idHash))

  override def upsert(session: AppSession): IO[Unit] = ref
    .update(s => s.copy(sessions = s.sessions.updated(session.idHash, session)))

  override def delete(idHash: String): IO[Unit] = ref
    .update(s => s.copy(sessions = s.sessions - idHash, deletes = idHash :: s.deletes))

  override def deleteByAccount(accountId: AccountId): IO[Int] = ref.modify { s =>
    val retained = s.sessions.filter { case (_, session) => session.accountId != accountId }
    (s.copy(sessions = retained), s.sessions.size - retained.size)
  }

  override def renew(idHash: String, lastSeenAt: Instant, expiresAt: Instant): IO[Unit] = ref
    .update { s =>
      s.copy(
        sessions = s.sessions
          .updatedWith(idHash)(_.map(_.copy(lastSeenAt = lastSeenAt, expiresAt = expiresAt))),
        renews = s.renews + 1,
      )
    }

  override def deleteExpired(now: Instant): IO[Int] = ref.modify { s =>
    val retained = s.sessions.filter { case (_, session) => !session.expiresAt.isBefore(now) }
    (s.copy(sessions = retained), s.sessions.size - retained.size)
  }

private object RecordingAppSessionsRepository:
  def create: IO[RecordingAppSessionsRepository] = Ref
    .of[IO, SessionRepoSnapshot](SessionRepoSnapshot(Map.empty, 0, Nil))
    .map(RecordingAppSessionsRepository(_))
