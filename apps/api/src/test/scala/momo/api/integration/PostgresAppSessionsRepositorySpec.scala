package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*

import momo.api.auth.SessionTokenHash
import momo.api.domain.ids.{AccountId, MemberId}
import momo.api.repositories.AppSession
import momo.api.repositories.postgres.PostgresAppSessionsRepository

final class PostgresAppSessionsRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private val accountId = AccountId("account_ponta")
  private val memberId = MemberId("member_ponta")

  private def repo = new PostgresAppSessionsRepository[IO](transactor)

  private def buildSession(
      rawSessionToken: String,
      rawCsrfToken: String,
      expiresAt: Instant,
  ): IO[AppSession] =
    (SessionTokenHash.sha256[IO](rawSessionToken), SessionTokenHash.sha256[IO](rawCsrfToken))
      .mapN { (idHash, csrfHash) =>
        AppSession(
          idHash = idHash,
          accountId = accountId,
          playerMemberId = Some(memberId),
          csrfSecretHash = csrfHash,
          createdAt = now,
          lastSeenAt = now,
          expiresAt = expiresAt,
        )
      }

  test("upsert and find round-trip hashed session columns without storing raw tokens"):
    val rawSessionToken = "raw-session-token"
    val rawCsrfToken = "raw-csrf-token"
    for
      session <- buildSession(rawSessionToken, rawCsrfToken, now.plusSeconds(3600))
      _ <- repo.upsert(session)
      found <- repo.find(session.idHash)
      rawTokenRows <- sql"""
        SELECT count(*)
        FROM app_sessions
        WHERE id_hash = $rawSessionToken OR csrf_secret_hash = $rawCsrfToken
      """.query[Int].unique.transact(transactor)
    yield
      assertEquals(found, Some(session))
      assertEquals(rawTokenRows, 0)

  test("renew updates only last_seen_at and expires_at"):
    for
      session <- buildSession("renew-session-token", "renew-csrf-token", now.plusSeconds(3600))
      _ <- repo.upsert(session)
      renewedAt = now.plusSeconds(600)
      renewedExpiresAt = now.plusSeconds(7200)
      _ <- repo.renew(session.idHash, renewedAt, renewedExpiresAt)
      found <- repo.find(session.idHash)
    yield
      val got = found.getOrElse(fail("session not found after renew"))
      assertEquals(got.accountId, session.accountId)
      assertEquals(got.playerMemberId, session.playerMemberId)
      assertEquals(got.csrfSecretHash, session.csrfSecretHash)
      assertEquals(got.createdAt, session.createdAt)
      assertEquals(got.lastSeenAt, renewedAt)
      assertEquals(got.expiresAt, renewedExpiresAt)

  test("delete, deleteByAccount, and deleteExpired remove sessions by hashed keys"):
    val program =
      for
        active <- buildSession("active-session-token", "active-csrf-token", now.plusSeconds(3600))
        expired <- buildSession(
          "expired-session-token",
          "expired-csrf-token",
          expiresAt = now.minusSeconds(1),
        )
        other <- buildSession("other-session-token", "other-csrf-token", now.plusSeconds(3600))
          .map(_.copy(accountId = AccountId("account_akane_mami")))
        _ <- repo.upsert(active)
        _ <- repo.upsert(expired)
        _ <- repo.upsert(other)
        expiredDeleted <- repo.deleteExpired(now)
        expiredFound <- repo.find(expired.idHash)
        _ <- repo.delete(active.idHash)
        activeFound <- repo.find(active.idHash)
        accountDeleted <- repo.deleteByAccount(other.accountId)
        otherFound <- repo.find(other.idHash)
      yield
        assertEquals(expiredDeleted, 1)
        assertEquals(expiredFound, None)
        assertEquals(activeFound, None)
        assertEquals(accountDeleted, 1)
        assertEquals(otherFound, None)
    program
end PostgresAppSessionsRepositorySpec
