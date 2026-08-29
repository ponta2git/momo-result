package momo.api.integration

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json}

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{
  PostgresGameTitlesRepository,
  PostgresSeriesAnalysisQueueOutboxRepository,
  PostgresSeriesAnalysisRepository
}
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.domain.{
  GameTitle,
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisScope
}
import momo.api.errors.AppError
import momo.api.testing.JsonSchemaAssertions

final class PostgresSeriesAnalysisRepositorySpec extends IntegrationSuite with JsonSchemaAssertions:
  private val now = Instant.parse("2026-08-09T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title-analysis-contract")
  private val accountId = AccountId.unsafeFromString("account_ponta")

  private def seedTitle: IO[Unit] = new PostgresGameTitlesRepository[IO](transactor)
    .createWithNextDisplayOrder(GameTitle(titleId, "分析契約作品", "momotetsu2", 1, now)).void

  private def repository: IO[PostgresSeriesAnalysisRepository[IO]] =
    PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)

  test("new title has an unavailable status without invoking synchronous analysis"):
    for
      _ <- seedTitle
      repo <- repository
      result <- repo.status(titleId)
    yield result match
      case Right(status) =>
        assertEquals(status.desired.inputRevision, 0L)
        assertEquals(status.artifactFreshness, "unavailable")
        assertEquals(status.currentArtifact, None)
        assertEquals(status.calculation, None)
      case Left(error) => fail(s"expected status, got $error")

  test("admin overview fails closed when a persisted failure code is not in the wire vocabulary"):
    for
      _ <- seedTitle
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, status, trigger, requested_at, available_at,
          finished_at, result_disposition, safe_failure_code
        ) VALUES (
          'job-unknown-failure-code', $titleId, 0, 'series-analysis-v1',
          1, 'failed', 'manual', $now, $now,
          $now, 'none', 'unknown_failure_code'
        )
      """.update.run.transact(transactor)
      repo <- repository
      result <- repo.adminOverview(Some(titleId))
    yield assertEquals(result, Left(AppError.AnalysisStateUnavailable()))

  test("manual title request creates durable operation, job request, job and outbox"):
    for
      _ <- seedTitle
      repo <- repository
      accepted <- repo.requestTitleRecalculation(titleId, accountId, "hash-title-request")
      counts <- sql"""
        SELECT
          (SELECT COUNT(*)::int FROM series_analysis_operation_requests),
          (SELECT COUNT(*)::int FROM series_analysis_job_requests),
          (SELECT COUNT(*)::int FROM series_analysis_jobs WHERE status = 'queued'),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox WHERE status = 'pending')
      """.query[(Int, Int, Int, Int)].unique.transact(transactor)
      control <- sql"""
        SELECT operation.id,
               request.status,
               request.assigned_job_id,
               job.id,
               job.status,
               job.trigger,
               outbox.job_id,
               outbox.status
        FROM series_analysis_operation_requests operation
        JOIN series_analysis_job_requests request
          ON request.operation_request_id = operation.id
        JOIN series_analysis_jobs job ON job.id = request.assigned_job_id
        JOIN series_analysis_queue_outbox outbox ON outbox.job_id = job.id
      """.query[(String, String, Option[String], String, String, String, String, String)].unique
        .transact(transactor)
      status <- repo.status(titleId)
    yield
      accepted match
        case Right(value) =>
          assertEquals(value.targetCount, 1)
          value.target match
            case Some(target) =>
              assertEquals(target.gameTitleId, titleId)
              assertEquals(target.requestDisposition, "created_job")
              assertEquals(
                control,
                (
                  value.requestId,
                  "pending",
                  target.jobId,
                  target.jobId.getOrElse(fail("created job id is missing")),
                  "queued",
                  "manual",
                  target.jobId.getOrElse(fail("created job id is missing")),
                  "pending",
                ),
              )
            case None => fail("accepted title recalculation has no target")
        case Left(error) => fail(s"expected accepted request, got $error")
      assertEquals(counts, (1, 1, 1, 1))
      status match
        case Right(value) =>
          assertEquals(value.gameTitleId, titleId)
          assertEquals(value.calculation.map(_.status), Some("queued"))
          assertEquals(value.calculation.map(_.trigger), Some("manual"))
        case Left(error) => fail(s"expected queued status, got $error")

  test("all-title request snapshots zero-match titles and is idempotent in the control store"):
    val secondId = GameTitleId.unsafeFromString("title-analysis-contract-2")
    for
      _ <- seedTitle
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(secondId, "分析契約作品2", "momotetsu2", 2, now))
      repo <- repository
      first <- repo.requestAllRecalculation(accountId, "hash-all-request")
      replay <- repo.requestAllRecalculation(accountId, "hash-all-request")
      snapshotCounts <- sql"""
        SELECT
          (SELECT COUNT(*)::int FROM series_analysis_operation_requests),
          (SELECT COUNT(*)::int FROM series_analysis_campaigns),
          (SELECT COUNT(*)::int FROM series_analysis_campaign_targets),
          (SELECT COUNT(*)::int FROM series_analysis_jobs),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox)
      """.query[(Int, Int, Int, Int, Int)].unique.transact(transactor)
      snapshots <- sql"""
        SELECT game_title_id, input_revision, algorithm_version,
               artifact_schema_version, status, job_request_id
        FROM series_analysis_campaign_targets
        ORDER BY game_title_id
      """.query[(String, Long, String, Int, String, Option[String])].to[List]
        .transact(transactor)
      outbox = PostgresSeriesAnalysisQueueOutboxRepository[IO](transactor)
      expanded <- (
        outbox.expandPendingCampaignTargets(now, 10),
        outbox.expandPendingCampaignTargets(now, 10),
      ).parTupled
      expansionReplay <- outbox.expandPendingCampaignTargets(now, 10)
      expandedCounts <- sql"""
        SELECT
          (SELECT COUNT(*)::int FROM series_analysis_job_requests),
          (SELECT COUNT(*)::int FROM series_analysis_jobs),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox),
          (SELECT expanded_count FROM series_analysis_campaigns),
          (SELECT status FROM series_analysis_campaigns)
      """.query[(Int, Int, Int, Int, String)].unique.transact(transactor)
    yield
      assertEquals(replay, first)
      first match
        case Right(value) =>
          assertEquals(value.targetCount, 2)
          assertEquals(value.target, None)
          value.campaign match
            case Some(campaign) => assertEquals(campaign.status, "expanding")
            case None => fail("accepted all-title recalculation has no campaign")
        case Left(error) => fail(s"expected accepted all-title request, got $error")
      assertEquals(snapshotCounts, (1, 1, 2, 0, 0))
      assertEquals(
        snapshots,
        List(titleId.value, secondId.value).sorted.map(id =>
          (id, 0L, "series-analysis-v1", 1, "pending", None)
        ),
      )
      assertEquals(expanded._1 + expanded._2, 2)
      assertEquals(expansionReplay, 0)
      assertEquals(expandedCounts, (2, 2, 2, 2, "running"))

  test("deleting a title closes its expanded campaign work without retaining an active job"):
    val artifactPayload = "{}".getBytes(StandardCharsets.UTF_8)
    for
      _ <- seedTitle
      _ <- insertPublishedArtifact("artifact-analysis-delete", artifactPayload, 0, 1)
      _ <- pointToArtifacts("artifact-analysis-delete", None)
      analysis <- repository
      _ <- analysis.requestAllRecalculation(accountId, "hash-delete-campaign")
      outbox = PostgresSeriesAnalysisQueueOutboxRepository[IO](transactor)
      _ <- outbox.expandPendingCampaignTargets(now, 10)
      _ <- new PostgresGameTitlesRepository[IO](transactor).delete(titleId)
      state <- sql"""
        SELECT
          (SELECT status FROM series_analysis_campaign_targets),
          (SELECT status FROM series_analysis_job_requests),
          (SELECT assigned_job_id FROM series_analysis_job_requests),
          (SELECT status FROM series_analysis_campaigns),
          (SELECT terminal_count FROM series_analysis_campaigns),
          (SELECT skipped_count FROM series_analysis_campaigns),
          (SELECT status FROM series_analysis_operation_requests),
          (SELECT COUNT(*)::int FROM series_analysis_jobs),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox),
          (SELECT COUNT(*)::int FROM series_analysis_artifacts)
      """.query[(String, String, Option[String], String, Int, Int, String, Int, Int, Int)].unique
        .transact(transactor)
    yield assertEquals(
      state,
      ("skipped_title_deleted", "fulfilled", None, "terminal", 1, 1, "terminal", 0, 0, 0),
    )

  test("campaign expansion joins only running attempts that started after acceptance"):
    val olderTitleId = GameTitleId.unsafeFromString("title-analysis-running-before")
    val newerTitleId = GameTitleId.unsafeFromString("title-analysis-running-after")
    val titles = new PostgresGameTitlesRepository[IO](transactor)
    for
      _ <- titles.createWithNextDisplayOrder(
        GameTitle(olderTitleId, "受理前実行", "momotetsu2", 1, now)
      )
      _ <- titles.createWithNextDisplayOrder(
        GameTitle(newerTitleId, "受理後実行", "momotetsu2", 2, now)
      )
      analysis <- repository
      _ <- analysis.requestAllRecalculation(accountId, "hash-running-race")
      acceptedAt <- sql"SELECT accepted_at FROM series_analysis_campaigns".query[Instant].unique
        .transact(transactor)
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, status, trigger, requested_at, available_at,
          started_at, lease_owner, lease_attempt_id, lease_fencing_token, lease_expires_at
        ) VALUES
          (
            'job-running-before', $olderTitleId, 0, 'series-analysis-v1', 1,
            'running', 'match_mutation', ${acceptedAt.minusSeconds(1)},
            ${acceptedAt.minusSeconds(1)}, ${acceptedAt.minusSeconds(1)},
            'worker-before', 'attempt-before', 1, ${acceptedAt.plusSeconds(60)}
          ),
          (
            'job-running-after', $newerTitleId, 0, 'series-analysis-v1', 1,
            'running', 'match_mutation', ${acceptedAt.plusSeconds(1)},
            ${acceptedAt.plusSeconds(1)}, ${acceptedAt.plusSeconds(1)},
            'worker-after', 'attempt-after', 1, ${acceptedAt.plusSeconds(60)}
          )
      """.update.run.transact(transactor)
      outbox = PostgresSeriesAnalysisQueueOutboxRepository[IO](transactor)
      expanded <- outbox.expandPendingCampaignTargets(acceptedAt.plusSeconds(2), 10)
      rows <- sql"""
        SELECT t.game_title_id, r.status, r.assigned_job_id, r.assigned_attempt_id,
               t.status, s.pending_forced_run_count
        FROM series_analysis_campaign_targets t
        JOIN series_analysis_job_requests r ON r.id = t.job_request_id
        JOIN series_analysis_title_states s ON s.game_title_id = t.game_title_id
        ORDER BY t.game_title_id
      """.query[(String, String, Option[String], Option[String], String, Int)].to[List]
        .transact(transactor)
      outboxCount <- sql"SELECT COUNT(*)::int FROM series_analysis_queue_outbox".query[Int]
        .unique.transact(transactor)
    yield
      assertEquals(expanded, 2)
      assertEquals(
        rows,
        List(
          (
            newerTitleId.value,
            "assigned",
            Some("job-running-after"),
            Some("attempt-after"),
            "running",
            0,
          ),
          (olderTitleId.value, "pending", None, None, "expanded", 1),
        ).sortBy(_._1),
      )
      assertEquals(outboxCount, 0)

  test("aggregate reader accepts only current or previous bounded checksummed chunk"):
    val payload = Files.readAllBytes(
      repositoryFile("docs/schemas/fixtures/series-analysis/aggregate-payload-v3.json")
    )
    val payloadDepth = parser.parse(new String(payload, StandardCharsets.UTF_8))
      .fold(error => fail(s"invalid shared aggregate fixture: $error"), jsonDepth)
    for
      _ <- seedTitle
      _ <- insertPublishedArtifact("artifact-analysis-previous", payload, 0, payloadDepth)
      _ <- insertPublishedArtifact("artifact-analysis-current", payload, 0, payloadDepth)
      _ <- pointToArtifacts("artifact-analysis-current", Some("artifact-analysis-previous"))
      repo <- repository
      current <- repo.chunk(SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Aggregate,
        titleId,
        "artifact-analysis-current",
        SeriesAnalysisScope.Overall,
      ))
      previous <- repo.chunk(SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Aggregate,
        titleId,
        "artifact-analysis-previous",
        SeriesAnalysisScope.Overall,
      ))
      expired <- repo.chunk(SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Aggregate,
        titleId,
        "artifact-not-readable",
        SeriesAnalysisScope.Overall,
      ))
    yield
      assertHydratedAggregate(current, "artifact-analysis-current")
      assertHydratedAggregate(previous, "artifact-analysis-previous")
      assertEquals(
        expired,
        Left(AppError.AnalysisArtifactExpired()),
      )

  private def insertPublishedArtifact(
      artifactId: String,
      payload: Array[Byte],
      itemCount: Int,
      nestingDepth: Int,
  ): IO[Unit] =
    val length = payload.length
    val checksum = sha256(payload)
    (sql"""
      INSERT INTO series_analysis_artifacts (
        id, game_title_id, input_revision, algorithm_version,
        artifact_schema_version, source_input_checksum, root_checksum,
        status, aggregate_chunk_count, review_chunk_count,
        drilldown_chunk_count, match_context_chunk_count,
        encoded_bytes, decoded_bytes, published_at
      ) VALUES (
        $artifactId, $titleId, 0, 'series-analysis-v3',
        2,
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'published', 1, 0, 0, 0, $length, $length, now()
      )
    """.update.run.void *> sql"""
      INSERT INTO series_analysis_scope_aggregate_artifacts (
        artifact_id, scope_key, scope_kind, payload,
        encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum
      ) VALUES (
        $artifactId, 'overall', 'overall', $payload,
        $length, $length, $itemCount, $nestingDepth, $checksum
      )
    """.update.run.void).transact(transactor)

  private def pointToArtifacts(currentId: String, previousId: Option[String]): IO[Unit] = sql"""
      UPDATE series_analysis_title_states
      SET algorithm_version = 'series-analysis-v3',
          artifact_schema_version = 2,
          current_artifact_id = $currentId,
          previous_artifact_id = $previousId,
          pending_work = false
      WHERE game_title_id = $titleId
    """.update.run.void.transact(transactor)

  private def assertHydratedAggregate(
      result: Either[AppError, momo.api.domain.SeriesAnalysisChunk],
      artifactId: String,
  ): Unit = result match
    case Right(chunk) =>
      val payload = parser.parse(new String(chunk.payload, StandardCharsets.UTF_8))
        .fold(error => fail(s"expected JSON analysis payload, got $error"), identity)
      val cursor = payload.hcursor
      assertEquals(cursor.get[Int]("schemaVersion"), Right(3))
      assertEquals(cursor.downField("artifact").get[String]("artifactId"), Right(artifactId))
      assertEquals(cursor.downField("scope").get[String]("displayName"), Right("総合"))
    case Left(error) => fail(s"expected hydrated aggregate $artifactId, got $error")

  private def jsonDepth(value: Json): Int = value.arrayOrObject(
    1,
    values => 1 + values.map(jsonDepth).maxOption.getOrElse(0),
    fields => 1 + fields.values.map(jsonDepth).maxOption.getOrElse(0),
  )

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"
end PostgresSeriesAnalysisRepositorySpec
