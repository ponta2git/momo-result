package momo.api.integration

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresOAuthStateReplayGuard
import momo.api.auth.SessionTokenHash

final class PostgresOAuthStateReplayGuardSpec extends IntegrationSuite:
  private def guard = new PostgresOAuthStateReplayGuard[IO](transactor)
  private def databaseNow = sql"SELECT clock_timestamp()".query[Instant].unique.transact(transactor)

  test("parallel callbacks consume once and a recreated guard preserves the committed hash") {
    for
      now <- databaseNow
      hash <- SessionTokenHash.sha256[IO]("raw-oauth-state")
      results <- List.fill(12)(guard.consume(hash, now.plusSeconds(300))).parSequence
      replay <- guard.consume(hash, now.plusSeconds(300))
      stored <- sql"SELECT state_hash FROM oauth_state_consumptions".query[String]
        .to[List].transact(transactor)
    yield
      assertEquals(results.count(identity), 1)
      assert(!replay)
      assertEquals(stored, List(hash))
  }

  test("cleanup preserves live consumptions and expired states cannot be consumed again") {
    for
      now <- databaseNow
      accepted <- guard.consume("live", now.plusSeconds(300))
      _ <- sql"INSERT INTO oauth_state_consumptions VALUES ('expired', ${now.minusSeconds(1)})"
        .update.run.transact(transactor)
      deleted <- guard.deleteExpired
      replay <- guard.consume("live", now.plusSeconds(300))
      expired <- guard.consume("expired", now.minusSeconds(1))
      boundary <- guard.consume("boundary", now)
      rows <- sql"SELECT state_hash FROM oauth_state_consumptions".query[String]
        .to[List].transact(transactor)
    yield
      assert(accepted)
      assertEquals(deleted, 1)
      assert(!replay)
      assert(!expired)
      assert(!boundary)
      assertEquals(rows, List("live"))
  }

  for committed <- List(false, true) do
    test(s"a commit error fails closed even when commit already succeeded: $committed") {
      val failure = new RuntimeException("simulated commit failure")
      val commit = if committed then doobie.free.connection.commit else ().pure[ConnectionIO]
      val failing = Transactor.after.set(
        transactor,
        commit *> failure.raiseError[ConnectionIO, Unit]
      )
      for
        now <- databaseNow
        result <- new PostgresOAuthStateReplayGuard[IO](failing)
          .consume("commit-failure", now.plusSeconds(300)).attempt
        retried <- guard.consume("commit-failure", now.plusSeconds(300))
      yield
        assertEquals(result, Left(failure))
        assertEquals(retried, !committed)
    }

  test("a callback waiting on deletion rejects state that expires before the insert resumes") {
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection())).use { connection =>
      val direct = Transactor.fromConnection[IO](connection, None)
      for
        now <- databaseNow
        expiresAt = now.plusSeconds(2)
        _ <- guard.consume("cleanup-race", expiresAt)
        _ <- IO.blocking(connection.setAutoCommit(false))
        _ <- direct.rawTrans.apply(sql"DELETE FROM oauth_state_consumptions WHERE state_hash = 'cleanup-race'".update.run)
        blocker <- direct.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
        result <- guard.consume("cleanup-race", expiresAt).background.use { callback =>
          (for
            _ <- awaitBackendBlockedBy(blocker)
            _ <- awaitExpiry(expiresAt)
            _ <- IO.blocking(connection.commit())
            accepted <- callback.flatMap(_.embedNever)
          yield accepted).guarantee(IO.blocking(connection.rollback()))
        }
      yield assert(!result)
    }
  }

  private def awaitExpiry(expiresAt: Instant): IO[Unit] =
    def poll: IO[Unit] = databaseNow.flatMap { current =>
      if !current.isBefore(expiresAt) then IO.unit else IO.sleep(10.millis) *> IO.defer(poll)
    }
    poll.timeout(5.seconds)
