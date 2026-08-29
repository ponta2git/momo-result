package momo.api.integration

import java.sql.Connection
import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.ConnectionIO
import doobie.free.KleisliInterpreter
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.log.LogHandler

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{
  PostgresGameTitlesRepository,
  PostgresSeriesAnalysisQueueOutboxRepository,
  PostgresSeriesAnalysisRepository
}
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.GameTitle
import momo.api.domain.ids.{AccountId, GameTitleId}

final class PostgresSeriesAnalysisQueueOutboxRepositorySpec extends IntegrationSuite:
  // Keep the fixture clock ahead of the database DEFAULT now() used by new outbox rows.
  private val now = Instant.parse("2099-08-09T12:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title-analysis-outbox")
  private def repo = PostgresSeriesAnalysisQueueOutboxRepository[IO](transactor)

  test("claims, retries finitely, and records an undeliverable queued job as failed"):
    for
      _ <- seedJob("analysis-job-retry", Some("analysis-outbox-retry"))
      first <- claim(now)
      _ <- repo.releaseForRetry(
        first,
        now.plusSeconds(2),
        now.minusSeconds(300),
        now,
      )
      second <- claim(now.plusSeconds(2))
      _ <- repo.releaseForRetry(
        second,
        now.plusSeconds(6),
        now.minusSeconds(298),
        now.plusSeconds(2),
      )
      third <- claim(now.plusSeconds(6))
      _ <- repo.releaseForRetry(
        third,
        now.plusSeconds(14),
        now.minusSeconds(294),
        now.plusSeconds(6),
      )
      state <- sql"""
        SELECT q.status, q.attempt_count, q.last_error, j.status, j.safe_failure_code
        FROM series_analysis_queue_outbox q
        JOIN series_analysis_jobs j ON j.id = q.job_id
        WHERE q.id = 'analysis-outbox-retry'
      """.query[(String, Int, Option[String], String, Option[String])].unique.transact(transactor)
    yield assertEquals(
      state,
      ("failed", 3, Some("redis_operation"), "failed", Some("dependency_retry_exhausted")),
    )

  test("marks only the current claim delivered with its Redis message id"):
    for
      _ <- seedJob("analysis-job-delivery", Some("analysis-outbox-delivery"))
      row <- claim(now)
      stale <- repo.markDelivered(
        row.id,
        row.claimExpiresAt.minusSeconds(1),
        "1-0",
        now,
      )
      delivered <- repo.markDelivered(row.id, row.claimExpiresAt, "1-0", now)
      state <- sql"""
        SELECT status, redis_message_id, delivered_at
        FROM series_analysis_queue_outbox
        WHERE id = 'analysis-outbox-delivery'
      """.query[(String, Option[String], Option[Instant])].unique.transact(transactor)
    yield
      assertEquals(stale, false)
      assertEquals(delivered, true)
      assertEquals(state, ("delivered", Some("1-0"), Some(now)))

  test("future job availability defers reconciliation, claim, and the durable wake deadline"):
    val availableAt = now.plusSeconds(3600)
    for
      _ <- seedJob("analysis-job-future", None)
      _ <- sql"""
        UPDATE series_analysis_jobs
        SET available_at = $availableAt
        WHERE id = 'analysis-job-future'
      """.update.run.transact(transactor)
      reconciled <- repo.reconcileQueued(now, now.minusSeconds(300), 10)
      _ <- sql"""
        INSERT INTO series_analysis_queue_outbox (
          id, job_id, dedupe_key, next_attempt_at, created_at, updated_at
        ) VALUES (
          'analysis-outbox-future', 'analysis-job-future',
          'dedupe:analysis-outbox-future', ${now.minusSeconds(60)}, $now, $now
        )
      """.update.run.transact(transactor)
      claimed <- repo.claimDue(10, now, now.plusSeconds(30))
      next <- repo.nextWakeAt(now, 300.seconds)
    yield
      assertEquals(reconciled, 0)
      assertEquals(claimed, Nil)
      assertEquals(next, Some(availableAt))

  test("an active job lease does not block transport claim recovery"):
    for
      _ <- seedJob("analysis-job-leased", Some("analysis-outbox-leased"))
      _ <- sql"""
        UPDATE series_analysis_jobs
        SET status = 'running',
            started_at = $now,
            lease_owner = 'worker-lease-owner',
            lease_attempt_id = 'attempt-lease-owner',
            lease_fencing_token = 1,
            lease_expires_at = ${now.plusSeconds(30)}
        WHERE id = 'analysis-job-leased'
      """.update.run.transact(transactor)
      claimed <- repo.claimDue(10, now, now.plusSeconds(30))
      next <- repo.nextWakeAt(now, 300.seconds)
    yield
      assertEquals(claimed.map(_.jobId), List("analysis-job-leased"))
      assertEquals(next, Some(now.plusSeconds(30)))

  test("retry scheduling never precedes the job availability deadline"):
    val availableAt = now.plusSeconds(3600)
    for
      _ <- seedJob("analysis-job-availability-retry", Some("analysis-outbox-availability-retry"))
      row <- claim(now)
      _ <- sql"""
        UPDATE series_analysis_jobs
        SET available_at = $availableAt
        WHERE id = 'analysis-job-availability-retry'
      """.update.run.transact(transactor)
      released <- repo.releaseForRetry(
        row,
        now.plusSeconds(2),
        now.minusSeconds(300),
        now,
      )
      state <- sql"""
        SELECT status, attempt_count, next_attempt_at, last_error
        FROM series_analysis_queue_outbox
        WHERE id = 'analysis-outbox-availability-retry'
      """.query[(String, Int, Instant, Option[String])].unique.transact(transactor)
    yield
      assertEquals(released, true)
      assertEquals(state, ("pending", 1, availableAt, Some("redis_operation")))

  test("a locked due delivery is skipped without hiding its durable wake deadline"):
    for
      _ <- seedJob("analysis-job-contention", Some("analysis-outbox-contention"))
      result <- rawConnection.use(connection =>
        manualTransaction(connection) {
          for
            _ <- runOn(
              connection,
              sql"""
              SELECT id
              FROM series_analysis_queue_outbox
              WHERE id = 'analysis-outbox-contention'
              FOR UPDATE
            """.query[String].unique,
            )
            claimed <- repo.claimDue(10, now, now.plusSeconds(30))
            next <- repo.nextWakeAt(now, 300.seconds)
          yield (claimed, next)
        }
      )
    yield
      assertEquals(result._1, Nil)
      assertEquals(result._2, Some(now))

  test("reconciles a queued job that has no recent durable delivery"):
    for
      _ <- seedJob("analysis-job-reconcile", None)
      inserted <- repo.reconcileQueued(now, now.minusSeconds(300), 10)
      replay <- repo.reconcileQueued(now, now.minusSeconds(300), 10)
      rows <- sql"""
        SELECT job_id, status FROM series_analysis_queue_outbox
        WHERE job_id = 'analysis-job-reconcile'
      """.query[(String, String)].to[List].transact(transactor)
    yield
      assertEquals(inserted, 1)
      assertEquals(replay, 0)
      assertEquals(rows, List(("analysis-job-reconcile", "pending")))

  test("newest delivered identity protects semantic redelivery until its exact deadline"):
    val oldDeliveredAt = now.minusSeconds(400)
    val newestDeliveredAt = now.minusSeconds(100)
    val deadline = newestDeliveredAt.plusSeconds(300)
    for
      _ <- seedJob("analysis-job-semantic-deadline", None)
      _ <- sql"""
        INSERT INTO series_analysis_queue_outbox (
          id, job_id, dedupe_key, status, delivered_at, redis_message_id,
          next_attempt_at, created_at, updated_at
        ) VALUES
          ('analysis-outbox-semantic-old', 'analysis-job-semantic-deadline',
           'dedupe:analysis-semantic-old', 'delivered', $oldDeliveredAt, '1-0',
           $oldDeliveredAt, $oldDeliveredAt, $oldDeliveredAt),
          ('analysis-outbox-semantic-new', 'analysis-job-semantic-deadline',
           'dedupe:analysis-semantic-new', 'delivered', $newestDeliveredAt, '2-0',
           $newestDeliveredAt, $newestDeliveredAt, $newestDeliveredAt)
      """.update.run.transact(transactor)
      protectedCount <- repo.reconcileQueued(now, now.minusSeconds(300), 10)
      next <- repo.nextWakeAt(now, 300.seconds)
      protectedAtBoundary <- repo.reconcileQueued(deadline, deadline.minusSeconds(300), 10)
      afterBoundary = deadline.plusMillis(1)
      rearmedAfterBoundary <- repo.reconcileQueued(
        afterBoundary,
        afterBoundary.minusSeconds(300),
        10,
      )
    yield
      assertEquals(protectedCount, 0)
      assertEquals(next, Some(deadline))
      assertEquals(protectedAtBoundary, 0)
      assertEquals(rearmedAfterBoundary, 1)

  test("nextWakeAt prefers an in-flight claim expiry over later retry work"):
    for
      _ <- seedJob("analysis-job-next-wake", Some("analysis-outbox-next-wake"))
      _ <- sql"""
        UPDATE series_analysis_queue_outbox
        SET status = 'in_flight',
            claim_expires_at = ${now.plusSeconds(30)},
            next_attempt_at = ${now.plusSeconds(90)}
        WHERE id = 'analysis-outbox-next-wake'
      """.update.run.transact(transactor)
      next <- repo.nextWakeAt(now, 300.seconds)
    yield assertEquals(next, Some(now.plusSeconds(30)))

  test("does not fail a queued job while another durable delivery can still succeed"):
    for
      _ <- seedJob("analysis-job-multiple-deliveries", Some("analysis-outbox-a"))
      _ <- sql"""
        INSERT INTO series_analysis_queue_outbox (
          id, job_id, dedupe_key, next_attempt_at, created_at, updated_at
        ) VALUES (
          'analysis-outbox-b', 'analysis-job-multiple-deliveries',
          'dedupe:analysis-outbox-b', ${now.plusSeconds(1000)}, $now, $now
        )
      """.update.run.transact(transactor)
      _ <- exhaustCurrentDelivery(now)
      afterFailure <- sql"""
        SELECT j.status, q.status
        FROM series_analysis_jobs j
        JOIN series_analysis_queue_outbox q ON q.id = 'analysis-outbox-b'
        WHERE j.id = 'analysis-job-multiple-deliveries'
      """.query[(String, String)].unique.transact(transactor)
      remaining <- claim(now.plusSeconds(1001))
      delivered <- repo.markDelivered(
        remaining.id,
        remaining.claimExpiresAt,
        "2-0",
        now.plusSeconds(1001),
      )
    yield
      assertEquals(afterFailure, ("queued", "pending"))
      assertEquals(delivered, true)

  test("a recent delivered row protects the queued job after the current delivery is exhausted"):
    val deliveredAt = now.minusSeconds(100)
    val redeliverBefore = now.minusSeconds(300)
    for
      claim <- prepareTerminalClaim(
        "analysis-job-recent-delivery",
        "analysis-outbox-recent-current",
        "analysis-outbox-recent-history",
        deliveredAt,
      )
      released <- repo.releaseForRetry(claim, now.plusSeconds(8), redeliverBefore, now)
      state <- sql"""
        SELECT j.status, q.status
        FROM series_analysis_jobs j
        JOIN series_analysis_queue_outbox q
          ON q.id = 'analysis-outbox-recent-current'
        WHERE j.id = 'analysis-job-recent-delivery'
      """.query[(String, String)].unique.transact(transactor)
      reconciled <- repo.reconcileQueued(now, redeliverBefore, 10)
      next <- repo.nextWakeAt(now, 300.seconds)
    yield
      assertEquals(released, true)
      assertEquals(state, ("queued", "failed"))
      assertEquals(reconciled, 0)
      assertEquals(next, Some(deliveredAt.plusSeconds(300)))

  test("terminal retry waits at slot before title, job, and outbox locks"):
    val jobId = "analysis-job-historical-delivery"
    val currentOutboxId = "analysis-outbox-historical-current"
    val historicalOutboxId = "analysis-outbox-historical-history"
    val redeliverBefore = now.minusSeconds(300)
    for
      claim <- prepareTerminalClaim(
        jobId,
        currentOutboxId,
        historicalOutboxId,
        now.minusSeconds(360),
      )
      released <- rawConnection.use { connection =>
        manualTransaction(connection) {
          for
            blockerPid <- runOn(connection, sql"SELECT pg_backend_pid()".query[Int].unique)
            _ <- runOn(
              connection,
              sql"""
                SELECT slot_key
                FROM worker_execution_slots
                WHERE slot_key = 'shared-heavy-work'
                FOR UPDATE
              """.query[String].unique,
            )
            releaseFiber <- repo.releaseForRetry(
              claim,
              now.plusSeconds(8),
              redeliverBefore,
              now,
            ).start
            verifyPrefix =
              for
                _ <- awaitBackendBlockedBy(blockerPid)
                _ <- runOn(
                  connection,
                  sql"""
                  SELECT game_title_id
                  FROM series_analysis_title_states
                  WHERE game_title_id = $titleId
                  FOR UPDATE NOWAIT
                """.query[GameTitleId].unique,
                )
                _ <- runOn(
                  connection,
                  sql"""
                  SELECT id
                  FROM series_analysis_jobs
                  WHERE id = $jobId
                  FOR UPDATE NOWAIT
                """.query[String].unique,
                )
                _ <- runOn(
                  connection,
                  sql"""
                  SELECT id
                  FROM series_analysis_queue_outbox
                  WHERE id = $currentOutboxId
                  FOR UPDATE NOWAIT
                """.query[String].unique,
                )
              yield ()
            _ <- verifyPrefix.onError(_ => releaseFiber.cancel)
          yield releaseFiber
        }.flatMap(_.joinWithNever)
      }
      state <- sql"""
        SELECT j.status, current.status, historical.status
        FROM series_analysis_jobs j
        JOIN series_analysis_queue_outbox current ON current.id = $currentOutboxId
        JOIN series_analysis_queue_outbox historical ON historical.id = $historicalOutboxId
        WHERE j.id = $jobId
      """.query[(String, String, String)].unique.transact(transactor)
      reconciled <- repo.reconcileQueued(now, redeliverBefore, 10)
    yield
      assertEquals(released, true)
      assertEquals(state, ("failed", "failed", "delivered"))
      assertEquals(reconciled, 0)

  test("terminal outbox failure closes campaign and operation projections"):
    val accountId = AccountId.unsafeFromString("account_ponta")
    for
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(titleId, "分析配送作品", "momotetsu2", 1, now))
      analysis <- PostgresSeriesAnalysisRepository.create[IO](
        transactor,
        SeriesAnalysisReadConfig.defaults,
      )
      _ <- analysis.requestAllRecalculation(accountId, "outbox-terminal-campaign")
      _ <- repo.expandPendingCampaignTargets(now, 10)
      _ <- exhaustCurrentDelivery(now.plusSeconds(7L * 24L * 60L * 60L))
      state <- sql"""
        SELECT
          (SELECT status FROM series_analysis_jobs),
          (SELECT status FROM series_analysis_job_requests),
          (SELECT status FROM series_analysis_campaign_targets),
          (SELECT status FROM series_analysis_campaigns),
          (SELECT failed_count FROM series_analysis_campaigns),
          (SELECT status FROM series_analysis_operation_requests)
      """.query[(String, String, String, String, Int, String)].unique.transact(transactor)
    yield assertEquals(
      state,
      ("failed", "fulfilled", "failed", "terminal", 1, "terminal"),
    )

  test("prunes only terminal analysis history older than 45 days"):
    val cutoff = now.minusSeconds(45L * 24L * 60L * 60L)
    for
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(titleId, "分析配送作品", "momotetsu2", 1, now))
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, status, trigger, requested_at, available_at, finished_at
        ) VALUES
          ('analysis-job-old-terminal', $titleId, 0, 'series-analysis-v1', 1,
           'failed', 'manual', ${cutoff.minusSeconds(60)}, ${cutoff.minusSeconds(
          60
        )}, ${cutoff.minusSeconds(1)}),
          ('analysis-job-fresh-terminal', $titleId, 0, 'series-analysis-v1', 1,
           'failed', 'manual', $cutoff, $cutoff, ${cutoff.plusSeconds(1)}),
          ('analysis-job-active', $titleId, 0, 'series-analysis-v1', 1,
           'queued', 'manual', ${cutoff.minusSeconds(60)}, ${cutoff.minusSeconds(60)}, NULL)
      """.update.run.transact(transactor)
      counts <- repo.cleanupHistory(cutoff, now.minusSeconds(24L * 60L * 60L), 100)
      remaining <- sql"""
        SELECT id FROM series_analysis_jobs ORDER BY id
      """.query[String].to[List].transact(transactor)
    yield
      assertEquals(counts, momo.api.repositories.SeriesAnalysisCleanupCounts(0, 0, 1, 0, 0))
      assertEquals(
        remaining,
        List("analysis-job-active", "analysis-job-fresh-terminal"),
      )

  private def claim(at: Instant) = repo.claimDue(1, at, at.plusSeconds(30)).map(_.head)

  private def exhaustCurrentDelivery(at: Instant): IO[Unit] =
    List((0L, 2L), (2L, 4L), (6L, 8L)).traverse_ { case (offset, retryDelay) =>
      val attemptAt = at.plusSeconds(offset)
      for
        row <- claim(attemptAt)
        _ <- repo.releaseForRetry(
          row,
          attemptAt.plusSeconds(retryDelay),
          attemptAt.minusSeconds(300),
          attemptAt,
        )
      yield ()
    }

  private def prepareTerminalClaim(
      jobId: String,
      currentOutboxId: String,
      historicalOutboxId: String,
      deliveredAt: Instant,
  ): IO[momo.api.repositories.SeriesAnalysisQueueOutboxRecord] =
    for
      _ <- seedJob(jobId, None)
      _ <- sql"""
        INSERT INTO series_analysis_queue_outbox (
          id, job_id, dedupe_key, status, attempt_count, next_attempt_at,
          delivered_at, redis_message_id, created_at, updated_at
        ) VALUES
          (
            $currentOutboxId, $jobId, ${s"dedupe:$currentOutboxId"}, 'pending', 2,
            ${now.minusSeconds(1)}, NULL, NULL, $now, $now
          ),
          (
            $historicalOutboxId, $jobId, ${s"dedupe:$historicalOutboxId"}, 'delivered', 0,
            $deliveredAt, $deliveredAt, 'historical-message', $deliveredAt, $deliveredAt
          )
      """.update.run.transact(transactor)
      claim <- claim(now)
    yield claim

  private def rawConnection: Resource[IO, Connection] = Resource.fromAutoCloseable(
    IO.blocking(dbFixture().transactor.kernel.getConnection)
  )

  private def runOn[A](connection: Connection, program: ConnectionIO[A]): IO[A] = program
    .foldMap(KleisliInterpreter[IO](LogHandler.noop).ConnectionInterpreter).run(connection)

  private def manualTransaction[A](connection: Connection)(action: IO[A]): IO[A] =
    (IO.blocking(connection.setAutoCommit(false)) >> action.attempt.flatMap {
      case Right(value) => IO.blocking(connection.commit()).as(value)
      case Left(error) => IO.blocking(connection.rollback()).attempt >> IO.raiseError(error)
    }).guarantee(IO.blocking(connection.setAutoCommit(true)))

  private def seedJob(jobId: String, outboxId: Option[String]): IO[Unit] =
    for
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(titleId, "分析配送作品", "momotetsu2", 1, now))
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, status, trigger, requested_at, available_at
        ) VALUES (
          $jobId, $titleId, 0, 'series-analysis-v1', 1,
          'queued', 'manual', $now, $now
        )
      """.update.run.transact(transactor)
      _ <- outboxId.traverse_(id => sql"""
        INSERT INTO series_analysis_queue_outbox (
          id, job_id, dedupe_key, next_attempt_at, created_at, updated_at
        ) VALUES ($id, $jobId, ${s"dedupe:$id"}, $now, $now, $now)
      """.update.run.transact(transactor).void)
    yield ()
end PostgresSeriesAnalysisQueueOutboxRepositorySpec
