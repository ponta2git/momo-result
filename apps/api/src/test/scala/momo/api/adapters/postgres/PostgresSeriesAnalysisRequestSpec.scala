package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.{Deferred, IO, Resource}
import doobie.implicits.*
import doobie.{ConnectionIO, Transactor}

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.GameTitle
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.integration.IntegrationSuite

final class PostgresSeriesAnalysisRequestSpec extends IntegrationSuite:
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val titleId = GameTitleId.unsafeFromString("title-request-concurrency")
  private val now = Instant.parse("2026-09-26T00:00:00Z")

  private def seedTitle(id: GameTitleId): IO[Unit] =
    sql"""
      UPDATE series_analysis_release_state
      SET algorithm_version = 'series-analysis-v12', artifact_schema_version = 9,
          validation_contract_id = 'series-analysis-artifact-v9-full-validation-v4'
      WHERE singleton_key = 'current'
    """.update.run.transact(transactor) *>
      new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(id, "要求整合性作品", "momotetsu_2", 1, now)).void

  test("concurrent title retries replay the committed operation without adding work"):
    for
      _ <- seedTitle(titleId)
      repository <-
        PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      results <- concurrentWithUncommittedFirst(
        PostgresSeriesAnalysisTitleRequestOps.requestTitle(
          titleId,
          accountId,
          "same-key",
          "operation-one",
          "request-one",
          "job-one",
        ),
        repository.requestTitleRecalculation(titleId, accountId, "same-key"),
      )
      counts <-
        sql"""
        SELECT (SELECT COUNT(*)::int FROM series_analysis_operation_requests),
               (SELECT COUNT(*)::int FROM series_analysis_job_requests),
               (SELECT COUNT(*)::int FROM series_analysis_jobs),
               (SELECT COUNT(*)::int FROM series_analysis_jobs WHERE status = 'queued' AND available_at <= now())
      """.query[(Int, Int, Int, Int)].unique.transact(transactor)
    yield
      assertEquals(results._1.map(_.requestId), Right("operation-one"))
      assertEquals(results._2.map(_.requestId), Right("operation-one"))
      assertEquals(results._2.map(_.target.flatMap(_.jobId)), Right(Some("job-one")))
      assertEquals(counts, (1, 1, 1, 1))

  test("concurrent all-title retries share one campaign and target snapshot"):
    for
      _ <- seedTitle(titleId)
      repository <-
        PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      results <- concurrentWithUncommittedFirst(
        PostgresSeriesAnalysisCampaignRequestOps.requestAll(
          accountId,
          "same-all-key",
          "operation-all",
          "campaign-all",
        ),
        repository.requestAllRecalculation(accountId, "same-all-key"),
      )
      counts <- sql"""
        SELECT (SELECT COUNT(*)::int FROM series_analysis_operation_requests),
               (SELECT COUNT(*)::int FROM series_analysis_campaigns),
               (SELECT COUNT(*)::int FROM series_analysis_campaign_targets)
      """.query[(Int, Int, Int)].unique.transact(transactor)
    yield
      assertEquals(results._1.map(_.requestId), Right("operation-all"))
      assertEquals(results._2, results._1)
      assertEquals(counts, (1, 1, 1))

  test("a retained operation key cannot accept a different title after HTTP replay expiry"):
    val otherId = GameTitleId.unsafeFromString("title-request-other")
    for
      _ <- seedTitle(titleId)
      _ <- seedTitle(otherId)
      repository <-
        PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      first <- repository.requestTitleRecalculation(titleId, accountId, "scope-key")
      mismatch <- repository.requestTitleRecalculation(otherId, accountId, "scope-key")
      replay <- repository.requestTitleRecalculation(titleId, accountId, "scope-key")
      titles <- sql"SELECT game_title_id FROM series_analysis_job_requests".query[GameTitleId]
        .to[List].transact(transactor)
    yield
      assert(first.isRight)
      assertEquals(mismatch.left.toOption.map(_.code), Some("IDEMPOTENCY_PAYLOAD_MISMATCH"))
      assertEquals(replay.map(_.requestId), first.map(_.requestId))
      assertEquals(titles, List(titleId))

  test("creation and queued mutation or manual coalescing explicitly inherit each desired tuple"):
    for
      _ <- seedTitle(titleId)
      initial <- sql"""
        SELECT input_revision, algorithm_version, artifact_schema_version,
          validation_contract_id, notification_baseline_state
        FROM series_analysis_title_states WHERE game_title_id = $titleId
      """.query[(Long, String, Int, Option[String], String)].unique.transact(transactor)
      _ <-
        sql"INSERT INTO series_radar_title_states(game_title_id, generation) VALUES ($titleId, 3)"
          .update.run.transact(transactor)
      _ <-
        PostgresSeriesAnalysisMutationOps.enqueueMatchMutation(List(titleId)).transact(transactor)
      created <- queuedVersion
      _ <- sql"UPDATE series_radar_title_states SET generation = 4 WHERE game_title_id = $titleId"
        .update.run.transact(transactor)
      _ <-
        PostgresSeriesAnalysisMutationOps.enqueueMatchMutation(List(titleId)).transact(transactor)
      coalesced <- queuedVersion
      _ <- sql"UPDATE series_radar_title_states SET generation = 5 WHERE game_title_id = $titleId"
        .update.run.transact(transactor)
      repository <-
        PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      manual <- repository.requestTitleRecalculation(titleId, accountId, "explicit-binding")
      requested <- queuedVersion
      before <- sql"SELECT ctid::text FROM series_analysis_jobs WHERE game_title_id = $titleId"
        .query[String].unique.transact(transactor)
      _ <- PostgresSeriesAnalysisJobTransitions.bindQueuedRadar(titleId).transact(transactor)
      after <- sql"SELECT ctid::text FROM series_analysis_jobs WHERE game_title_id = $titleId"
        .query[String].unique.transact(transactor)
    yield
      assertEquals(
        initial,
        (
          0L,
          "series-analysis-v12",
          9,
          Some("series-analysis-artifact-v9-full-validation-v4"),
          "initial"
        )
      )
      assertEquals(created._2, 1L)
      assertEquals(created._3, 3L)
      assertEquals(coalesced, (created._1, 2L, 4L))
      assertEquals(manual.map(_.target.flatMap(_.jobId)), Right(Some(created._1)))
      assertEquals(requested, (created._1, 2L, 5L))
      assertEquals(after, before, "repeating an already-bound assignment must not write the row")

  test("creation waits for release promotion and inherits its committed tuple"):
    val createdTitle = GameTitle(titleId, "昇格後の作品", "momotetsu_2", 1, now)
    for
      results <- concurrentWithUncommittedFirst(
        sql"""
          UPDATE series_analysis_release_state SET algorithm_version = 'promoted-analysis',
            artifact_schema_version = 9,
            validation_contract_id = 'series-analysis-artifact-v9-full-validation-v4'
          WHERE singleton_key = 'current'
        """.update.run,
        new PostgresGameTitlesRepository[IO](transactor).createWithNextDisplayOrder(createdTitle),
      )
      state <- sql"""
        SELECT algorithm_version, artifact_schema_version, validation_contract_id
        FROM series_analysis_title_states WHERE game_title_id = $titleId
      """.query[(String, Int, Option[String])].unique.transact(transactor)
    yield
      assert(results._2.isRight)
      assertEquals(
        state,
        (
          "promoted-analysis",
          9,
          Some("series-analysis-artifact-v9-full-validation-v4")
        )
      )

  private def queuedVersion: IO[(String, Long, Long)] = sql"""
    SELECT id, input_revision, radar_generation FROM series_analysis_jobs
    WHERE game_title_id = $titleId AND status = 'queued' AND work_kind = 'analysis'
  """.query[(String, Long, Long)].unique.transact(transactor)

  private def concurrentWithUncommittedFirst[A, B](
      first: ConnectionIO[A],
      second: IO[B],
  ): IO[(A, B)] =
    for
      ready <- Deferred[IO, (Int, A)]
      release <- Deferred[IO, Unit]
      result <- Resource.make(
        Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
          val transaction = Transactor.fromConnection[IO](connection, None)
          (for
            _ <- IO.blocking(connection.setAutoCommit(false))
            accepted <- transaction.rawTrans.apply(first)
            pid <- transaction.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
            _ <- ready.complete(pid -> accepted)
            _ <- release.get
            _ <- IO.blocking(connection.commit())
          yield accepted).guarantee(IO.blocking(connection.rollback()))
        }.start
      )(fiber => release.complete(()).void *> fiber.cancel).use { holder =>
        ready.get.flatMap { (pid, accepted) =>
          Resource.make(second.start)(_.cancel).use { waiter =>
            for
              _ <- awaitBackendBlockedBy(pid).guarantee(release.complete(()).void)
              _ <- holder.joinWithNever
              retried <- waiter.joinWithNever
            yield accepted -> retried
          }
        }
      }
    yield result
