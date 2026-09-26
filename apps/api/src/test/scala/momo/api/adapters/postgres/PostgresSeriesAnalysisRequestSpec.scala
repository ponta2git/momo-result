package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.{Deferred, IO, Resource}
import doobie.implicits.*
import doobie.{ConnectionIO, Transactor}

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.domain.{GameTitle, SeriesAnalysisRecalculationAccepted}
import momo.api.errors.AppError
import momo.api.integration.IntegrationSuite

final class PostgresSeriesAnalysisRequestSpec extends IntegrationSuite:
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val titleId = GameTitleId.unsafeFromString("title-request-concurrency")
  private val now = Instant.parse("2026-09-26T00:00:00Z")
  private type Accepted = Either[AppError, SeriesAnalysisRecalculationAccepted]

  private def seedTitle(id: GameTitleId): IO[Unit] =
    sql"""
      UPDATE series_analysis_release_state
      SET algorithm_version = 'series-analysis-v5', artifact_schema_version = 4,
          validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1'
      WHERE singleton_key = 'current'
    """.update.run.transact(transactor) *>
      new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(id, "要求整合性作品", "momotetsu2", 1, now)).void

  test("concurrent title retries replay the committed operation without adding work"):
    for
      _ <- seedTitle(titleId)
      repository <- PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      results <- concurrentWithUncommittedFirst(
        PostgresSeriesAnalysisTitleRequestOps.requestTitle(
          titleId, accountId, "same-key", "operation-one", "request-one", "job-one", "outbox-one",
        ),
        repository.requestTitleRecalculation(titleId, accountId, "same-key"),
      )
      counts <- sql"""
        SELECT (SELECT COUNT(*)::int FROM series_analysis_operation_requests),
               (SELECT COUNT(*)::int FROM series_analysis_job_requests),
               (SELECT COUNT(*)::int FROM series_analysis_jobs),
               (SELECT COUNT(*)::int FROM series_analysis_queue_outbox)
      """.query[(Int, Int, Int, Int)].unique.transact(transactor)
    yield
      assertEquals(results._1.map(_.requestId), Right("operation-one"))
      assertEquals(results._2.map(_.requestId), Right("operation-one"))
      assertEquals(results._2.map(_.target.flatMap(_.jobId)), Right(Some("job-one")))
      assertEquals(counts, (1, 1, 1, 1))

  test("concurrent all-title retries share one campaign and target snapshot"):
    for
      _ <- seedTitle(titleId)
      repository <- PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      results <- concurrentWithUncommittedFirst(
        PostgresSeriesAnalysisCampaignRequestOps.requestAll(
          accountId, "same-all-key", "operation-all", "campaign-all",
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
      repository <- PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
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

  private def concurrentWithUncommittedFirst(
      first: ConnectionIO[Accepted],
      second: IO[Accepted],
  ): IO[(Accepted, Accepted)] =
    for
      ready <- Deferred[IO, (Int, Accepted)]
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
