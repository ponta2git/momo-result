package momo.api.integration

import java.time.Instant

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.Transactor
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.*
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.usecases.testing.MatchFixtures

final class PostgresGameTitleDeletionConcurrencySpec extends IntegrationSuite:
  private val now = Instant.parse("2026-10-16T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title-z-destination")
  private val eventId = HeldEventId.unsafeFromString("event-delete-contention")
  private val mapId = MapMasterId.unsafeFromString("map-destination")
  private val seasonId = SeasonMasterId.unsafeFromString("season-destination")

  private def seed: IO[Unit] = MatchFixtures.seedWorldPrereqs(
    new PostgresHeldEventsRepository[IO](transactor),
    new PostgresGameTitlesRepository[IO](transactor),
    new PostgresMapMastersRepository[IO](transactor),
    new PostgresSeasonMastersRepository[IO](transactor),
    eventId,
    titleId,
    mapId,
    seasonId,
    now,
  ) *> sql"""
    INSERT INTO series_analysis_job_requests (
      id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
      status, trigger, accepted_at
    ) VALUES (
      'request-delete-contention', $titleId, 0, 'series-analysis-v10', 8,
      'pending', 'manual', $now
    )
  """.update.run.transact(transactor).void

  private def record: MatchRecord = MatchFixtures.matchRecord(
    MatchId.unsafeFromString("match-delete-contention"),
    eventId,
    1,
    titleId,
    seasonId,
    mapId,
    now,
    now,
    MatchFixtures.DbMemberValues,
    None,
    None,
    None,
  ).copy(createdByAccountId = AccountId.unsafeFromString("account_ponta"))

  /** The writer reaches the real enqueue path while retaining its parent FK lock. */
  private def contendWithDeletion[A](
      write: IO[Either[AppError, A]]
  ): IO[(Either[AppError, Unit], Either[AppError, A])] =
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
      val xa = Transactor.fromConnection[IO](connection, None)
      val rollback = IO.blocking(connection.rollback())
      for
        _ <- IO.blocking(connection.setAutoCommit(false))
        _ <- xa.rawTrans.apply(sql"""
          SELECT game_title_id FROM series_analysis_title_states
          WHERE game_title_id = $titleId FOR UPDATE
        """.query[GameTitleId].unique)
        pid <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
        results <- write.background.use { completed =>
          for
            deletion <-
            (awaitBackendBlockedBy(pid) *>
              new PostgresGameTitlesRepository[IO](xa).delete(titleId)).guarantee(rollback)
            mutation <- completed.flatMap(_.embedNever)
          yield deletion -> mutation
        }
      yield results
    }

  private def assertRetained: IO[Unit] =
    sql"""
      SELECT
        (SELECT COUNT(*)::int FROM game_titles WHERE id = $titleId),
        (SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = $titleId),
        (SELECT status FROM series_analysis_job_requests WHERE id = 'request-delete-contention'),
        (SELECT game_title_id FROM matches WHERE id = 'match-delete-contention')
    """.query[(Int, Long, String, GameTitleId)].unique.transact(transactor)
      .map(state => assertEquals(state, (1, 1L, "pending", titleId)))

  test("title deletion rolls back with conflict while confirmation waits for analysis state"):
    for
      _ <- seed
      result <- contendWithDeletion(
        new PostgresMatchConfirmationRepository[IO](transactor).confirm(record, None, now)
      )
      _ <- assertRetained
    yield
      assert(result._1 match
        case Left(AppError.Conflict(_)) => true
        case _ => false)
      assert(result._2.isRight)

  test("title deletion rolls back with conflict while a title-changing update waits for state"):
    val sourceTitle = GameTitleId.unsafeFromString("title-a-source")
    val sourceMap = MapMasterId.unsafeFromString("map-source")
    val sourceSeason = SeasonMasterId.unsafeFromString("season-source")
    val original = record.copy(
      gameTitleId = sourceTitle,
      mapMasterId = sourceMap,
      seasonMasterId = sourceSeason,
    )
    for
      _ <- seed
      _ <- new PostgresGameTitlesRepository[IO](transactor).createWithNextDisplayOrder(
        GameTitle(sourceTitle, "Source", "world", 2, now)
      )
      _ <- new PostgresMapMastersRepository[IO](transactor).createWithNextDisplayOrder(
        MapMaster(sourceMap, sourceTitle, "Source map", 1, now)
      )
      _ <- new PostgresSeasonMastersRepository[IO](transactor).createWithNextDisplayOrder(
        SeasonMaster(sourceSeason, sourceTitle, "Source season", 1, now)
      )
      confirmed <- new PostgresMatchConfirmationRepository[IO](transactor)
        .confirm(original, None, now)
      _ <- IO(assert(confirmed.isRight))
      result <- contendWithDeletion(
        new PostgresMatchesRepository[IO](transactor)
          .update(record.id, MatchFixtures.update(record), now.plusSeconds(1))
      )
      _ <- assertRetained
    yield
      assert(result._1 match
        case Left(AppError.Conflict(_)) => true
        case _ => false)
      assert(result._2.isRight)

  test("referenced-title deletion releases state for an ordinary match update"):
    for
      _ <- seed
      confirmed <- new PostgresMatchConfirmationRepository[IO](transactor)
        .confirm(record, None, now)
      _ <- IO(assert(confirmed.isRight))
      result <- contendWithDeletion(
        new PostgresMatchesRepository[IO](transactor)
          .update(record.id, MatchFixtures.update(record), now.plusSeconds(1))
      )
      revision <-
        sql"SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = $titleId"
          .query[Long].unique.transact(transactor)
    yield
      assert(result._1 match
        case Left(AppError.Conflict(_)) => true
        case _ => false)
      assert(result._2.isRight)
      assertEquals(revision, 2L)

  test("referenced-title deletion releases state for a match deletion"):
    for
      _ <- seed
      confirmed <- new PostgresMatchConfirmationRepository[IO](transactor)
        .confirm(record, None, now)
      _ <- IO(assert(confirmed.isRight))
      result <- contendWithDeletion(
        new PostgresMatchesRepository[IO](transactor).delete(record.id).map(_.asRight[AppError])
      )
      remaining <- sql"SELECT COUNT(*)::int FROM matches WHERE id = ${record.id}"
        .query[Int].unique.transact(transactor)
    yield
      assert(result._1 match
        case Left(AppError.Conflict(_)) => true
        case _ => false)
      assertEquals(result._2, Right(true))
      assertEquals(remaining, 0)

  test("deletion waits for title state without blocking a job writer's parent FK check"):
    for
      _ <- new PostgresGameTitlesRepository[IO](transactor).createWithNextDisplayOrder(
        GameTitle(titleId, "Worker title", "world", 1, now)
      )
      deleted <-
        Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
          val xa = Transactor.fromConnection[IO](connection, None)
          for
            _ <- IO.blocking(connection.setAutoCommit(false))
            _ <- xa.rawTrans.apply(sql"""
            SELECT game_title_id FROM series_analysis_title_states
            WHERE game_title_id = $titleId FOR UPDATE
          """.query[GameTitleId].unique)
            pid <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
            result <-
              new PostgresGameTitlesRepository[IO](transactor).delete(titleId).background.use {
                completed =>
                  (for
                    _ <- awaitBackendBlockedBy(pid)
                    _ <- xa.rawTrans.apply(sql"""
                  INSERT INTO series_analysis_jobs (
                    id, game_title_id, input_revision, algorithm_version,
                    artifact_schema_version, status, trigger, requested_at
                  ) VALUES (
                    'job-before-delete', $titleId, 0, 'series-analysis-v10',
                    6, 'queued', 'match_mutation', $now
                  )
                """.update.run)
                    _ <- IO.blocking(connection.commit())
                    value <- completed.flatMap(_.embedNever)
                  yield value).guarantee(IO.blocking(connection.rollback()))
              }
          yield result
        }
      counts <- sql"""
        SELECT
          (SELECT COUNT(*)::int FROM game_titles WHERE id = $titleId),
          (SELECT COUNT(*)::int FROM series_analysis_jobs WHERE game_title_id = $titleId)
      """.query[(Int, Int)].unique.transact(transactor)
    yield
      assertEquals(deleted, Right(()))
      assertEquals(counts, (0, 0))
