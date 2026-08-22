package momo.api.integration

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

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
        first.id,
        first.claimExpiresAt,
        now.plusSeconds(1),
        "java.io.IOException",
        now,
      )
      second <- claim(now.plusSeconds(2))
      _ <- repo.releaseForRetry(
        second.id,
        second.claimExpiresAt,
        now.plusSeconds(3),
        "java.io.IOException",
        now.plusSeconds(2),
      )
      third <- claim(now.plusSeconds(4))
      _ <- repo.releaseForRetry(
        third.id,
        third.claimExpiresAt,
        now.plusSeconds(5),
        "java.io.IOException",
        now.plusSeconds(4),
      )
      state <- sql"""
        SELECT q.status, q.attempt_count, j.status, j.safe_failure_code
        FROM series_analysis_queue_outbox q
        JOIN series_analysis_jobs j ON j.id = q.job_id
        WHERE q.id = 'analysis-outbox-retry'
      """.query[(String, Int, String, Option[String])].unique.transact(transactor)
    yield assertEquals(
      state,
      ("failed", 3, "failed", Some("dependency_retry_exhausted")),
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
      rearmedAtBoundary <- repo.reconcileQueued(deadline, deadline.minusSeconds(300), 10)
    yield
      assertEquals(protectedCount, 0)
      assertEquals(next, Some(deadline))
      assertEquals(rearmedAtBoundary, 1)

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
    List(0L, 2L, 4L).traverse_ { offset =>
      val attemptAt = at.plusSeconds(offset)
      for
        row <- claim(attemptAt)
        _ <- repo.releaseForRetry(
          row.id,
          row.claimExpiresAt,
          attemptAt.plusSeconds(1),
          "java.io.IOException",
          attemptAt,
        )
      yield ()
    }

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
