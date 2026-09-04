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
  PostgresSeriesAnalysisRepository,
  SeriesAnalysisArtifactSupport
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

  private def seedTitle: IO[Unit] =
    val activateRelease = sql"""
      UPDATE series_analysis_release_state
      SET algorithm_version = 'series-analysis-v3',
          artifact_schema_version = ${SeriesAnalysisArtifactSupport.ArtifactSchemaVersion},
          validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId},
          updated_at = clock_timestamp()
      WHERE singleton_key = 'current'
    """.update.run.void.transact(transactor)
    activateRelease *> new PostgresGameTitlesRepository[IO](transactor)
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

  test("admin overview returns the latest ten jobs across titles in stable order"):
    val otherTitleId = GameTitleId.unsafeFromString("title-analysis-contract-other")
    val jobs = List.tabulate(12) { index =>
      val jobId = f"job-admin-recent-$index%02d"
      val jobTitleId = if index % 2 == 0 then titleId else otherTitleId
      val createdAt = now.plusSeconds((index / 2).toLong)
      (jobId, jobTitleId, createdAt)
    }
    for
      _ <- seedTitle
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(
          GameTitle(otherTitleId, "別の分析契約作品", "momotetsu2", 2, now)
        )
        .void
      _ <- jobs.traverse_ { case (jobId, jobTitleId, createdAt) =>
        sql"""
          INSERT INTO series_analysis_jobs (
            id, game_title_id, input_revision, algorithm_version,
            artifact_schema_version, status, trigger, requested_at, available_at,
            finished_at, result_disposition, created_at
          ) VALUES (
            $jobId, $jobTitleId, 0, 'series-analysis-v3',
            2, 'succeeded', 'match_mutation', $createdAt, $createdAt,
            ${createdAt.plusSeconds(1)}, 'published', $createdAt
          )
        """.update.run.transact(transactor).void
      }
      repo <- repository
      result <- repo.adminOverview(Some(titleId))
    yield result match
      case Right(overview) =>
        assertEquals(overview.recentJobs.map(_.jobId), jobs.reverse.take(10).map(_._1))
        assertEquals(
          overview.recentJobs.map(_.gameTitleId).distinct.toSet,
          Set(titleId, otherTitleId)
        )
      case Left(error) => fail(s"expected admin overview, got $error")

  test("validation-contract promotion stays exact in storage and stable on the public wire"):
    val jobId = "job-validation-contract-update"
    for
      _ <- seedTitle
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET algorithm_version = 'series-analysis-v3',
            artifact_schema_version = 2,
            validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId},
            pending_work = true
        WHERE game_title_id = $titleId
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
          validation_contract_id, status, trigger, requested_at, available_at
        ) VALUES (
          $jobId, $titleId, 0, 'series-analysis-v3', 2,
          ${SeriesAnalysisArtifactSupport.ValidationContractId}, 'queued',
          'validation_contract_update', $now, $now
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO series_analysis_job_requests (
          id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
          validation_contract_id, trigger, status, assigned_job_id, accepted_at
        ) VALUES (
          'request-validation-contract-update', $titleId, 0, 'series-analysis-v3', 2,
          ${SeriesAnalysisArtifactSupport.ValidationContractId}, 'validation_contract_update',
          'pending', $jobId, $now
        )
      """.update.run.transact(transactor)
      stored <- sql"""
        SELECT trigger, validation_contract_id
        FROM series_analysis_jobs WHERE id = $jobId
        UNION ALL
        SELECT trigger, validation_contract_id
        FROM series_analysis_job_requests WHERE assigned_job_id = $jobId
        ORDER BY trigger
      """.query[(String, Option[String])].to[List].transact(transactor)
      repo <- repository
      status <- repo.status(titleId)
      overview <- repo.adminOverview(Some(titleId))
    yield
      assertEquals(
        stored,
        List.fill(2)(
          ("validation_contract_update", Some(SeriesAnalysisArtifactSupport.ValidationContractId))
        ),
      )
      status match
        case Right(value) =>
          assertEquals(value.calculation.map(_.status), Some("queued"))
          assertEquals(value.calculation.map(_.trigger), Some("artifact_schema_update"))
        case Left(error) => fail(s"expected promotion status, got $error")
      overview match
        case Right(value) =>
          assertEquals(
            value.selectedTitle.flatMap(_.status.calculation).map(_.trigger),
            Some("artifact_schema_update"),
          )
          val recent = value.recentJobs.headOption.getOrElse(fail("promotion job is missing"))
          assertEquals(recent.trigger, "artifact_schema_update")
          assertEquals(recent.coalescedTriggers, List("artifact_schema_update"))
          assertEquals(recent.requestedBy, "system")
        case Left(error) => fail(s"expected promotion admin overview, got $error")

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
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET algorithm_version = 'series-analysis-v3',
            artifact_schema_version = 2,
            validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
        WHERE game_title_id = $titleId
      """.update.run.transact(transactor)
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
               request.validation_contract_id,
               job.validation_contract_id,
               outbox.job_id,
               outbox.status
        FROM series_analysis_operation_requests operation
        JOIN series_analysis_job_requests request
          ON request.operation_request_id = operation.id
        JOIN series_analysis_jobs job ON job.id = request.assigned_job_id
        JOIN series_analysis_queue_outbox outbox ON outbox.job_id = job.id
      """.query[
        (
            String,
            String,
            Option[String],
            String,
            String,
            String,
            Option[String],
            Option[String],
            String,
            String
        )
      ].unique
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
                  Some(SeriesAnalysisArtifactSupport.ValidationContractId),
                  Some(SeriesAnalysisArtifactSupport.ValidationContractId),
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

  test("manual title request advances an existing queued job to the exact desired contract"):
    val queuedJobId = "job-manual-contract-coalescing"
    for
      _ <- seedTitle
      _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id, status, trigger
        ) VALUES (
          $queuedJobId, $titleId, 0, 'series-analysis-v3', 2, NULL, 'queued', 'match_mutation'
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET algorithm_version = 'series-analysis-v3',
            artifact_schema_version = 2,
            validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
        WHERE game_title_id = $titleId
      """.update.run.transact(transactor)
      repo <- repository
      accepted <- repo.requestTitleRecalculation(titleId, accountId, "hash-coalesced-contract")
      stored <- sql"""
        SELECT job.validation_contract_id, request.validation_contract_id,
               request.assigned_job_id,
               (SELECT COUNT(*)::int FROM series_analysis_queue_outbox outbox
                WHERE outbox.job_id = job.id)
        FROM series_analysis_jobs job
        JOIN series_analysis_job_requests request ON request.assigned_job_id = job.id
        WHERE job.id = $queuedJobId
      """.query[(Option[String], Option[String], Option[String], Int)].unique.transact(transactor)
    yield
      accepted match
        case Right(value) =>
          assertEquals(value.target.flatMap(_.jobId), Some(queuedJobId))
          assertEquals(
            value.target.map(_.requestDisposition),
            Some("coalesced_into_queued_job"),
          )
        case Left(error) => fail(s"expected coalesced title request, got $error")
      assertEquals(
        stored,
        (
          Some(SeriesAnalysisArtifactSupport.ValidationContractId),
          Some(SeriesAnalysisArtifactSupport.ValidationContractId),
          Some(queuedJobId),
          1,
        ),
      )

  test("all-title request snapshots zero-match titles and is idempotent in the control store"):
    val secondId = GameTitleId.unsafeFromString("title-analysis-contract-2")
    for
      _ <- seedTitle
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(secondId, "分析契約作品2", "momotetsu2", 2, now))
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET algorithm_version = 'series-analysis-v3',
            artifact_schema_version = 2,
            validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
        WHERE game_title_id IN ($titleId, $secondId)
      """.update.run.transact(transactor)
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
               artifact_schema_version, validation_contract_id, status, job_request_id
        FROM series_analysis_campaign_targets
        ORDER BY game_title_id
      """.query[(String, Long, String, Int, Option[String], String, Option[String])].to[List]
        .transact(transactor)
      campaignContract <- sql"""
        SELECT validation_contract_id FROM series_analysis_campaigns
      """.query[Option[String]].unique.transact(transactor)
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
      assertEquals(campaignContract, Some(SeriesAnalysisArtifactSupport.ValidationContractId))
      assertEquals(
        snapshots,
        List(titleId.value, secondId.value).sorted.map(id =>
          (
            id,
            0L,
            "series-analysis-v3",
            2,
            Some(SeriesAnalysisArtifactSupport.ValidationContractId),
            "pending",
            None,
          )
        ),
      )

  test("all-title campaign keeps heterogeneous target contracts out of its summary"):
    val secondId = GameTitleId.unsafeFromString("title-analysis-contract-legacy")
    for
      _ <- seedTitle
      _ <- new PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(secondId, "分析契約作品旧版", "momotetsu2", 2, now))
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET algorithm_version = 'series-analysis-v3', artifact_schema_version = 2,
            validation_contract_id = CASE WHEN game_title_id = $titleId
              THEN ${SeriesAnalysisArtifactSupport.ValidationContractId} ELSE NULL END
        WHERE game_title_id IN ($titleId, $secondId)
      """.update.run.transact(transactor)
      repo <- repository
      accepted <- repo.requestAllRecalculation(accountId, "hash-heterogeneous-contracts")
      campaignContract <- sql"""
        SELECT validation_contract_id FROM series_analysis_campaigns
      """.query[Option[String]].unique.transact(transactor)
      targets <- sql"""
        SELECT game_title_id, validation_contract_id
        FROM series_analysis_campaign_targets ORDER BY game_title_id
      """.query[(String, Option[String])].to[List].transact(transactor)
    yield
      assert(accepted.isRight)
      assertEquals(campaignContract, None)
      assertEquals(
        targets,
        List(
          (secondId.value, None),
          (titleId.value, Some(SeriesAnalysisArtifactSupport.ValidationContractId)),
        ).sortBy(_._1),
      )

  test("deleting a title closes its pending campaign target"):
    val artifactPayload = "{}".getBytes(StandardCharsets.UTF_8)
    for
      _ <- seedTitle
      _ <- insertPublishedArtifact(
        "artifact-analysis-delete",
        artifactPayload,
        0,
        1,
        Some(SeriesAnalysisArtifactSupport.ValidationContractId),
      )
      _ <- pointToArtifacts("artifact-analysis-delete", None)
      analysis <- repository
      _ <- analysis.requestAllRecalculation(accountId, "hash-delete-campaign")
      _ <- new PostgresGameTitlesRepository[IO](transactor).delete(titleId)
      state <- sql"""
        SELECT
          (SELECT status FROM series_analysis_campaign_targets),
          (SELECT status FROM series_analysis_campaigns),
          (SELECT terminal_count FROM series_analysis_campaigns),
          (SELECT skipped_count FROM series_analysis_campaigns),
          (SELECT status FROM series_analysis_operation_requests),
          (SELECT COUNT(*)::int FROM series_analysis_job_requests),
          (SELECT COUNT(*)::int FROM series_analysis_jobs),
          (SELECT COUNT(*)::int FROM series_analysis_queue_outbox),
          (SELECT COUNT(*)::int FROM series_analysis_artifacts)
      """.query[(String, String, Int, Int, String, Int, Int, Int, Int)].unique
        .transact(transactor)
    yield assertEquals(
      state,
      ("skipped_title_deleted", "terminal", 1, 1, "terminal", 0, 0, 0, 0),
    )

  test("aggregate reader accepts only current or previous bounded checksummed chunk"):
    val payload = Files.readAllBytes(
      repositoryFile("docs/schemas/fixtures/series-analysis/aggregate-payload-v3.json")
    )
    val payloadDepth = parser.parse(new String(payload, StandardCharsets.UTF_8))
      .fold(error => fail(s"invalid shared aggregate fixture: $error"), jsonDepth)
    for
      _ <- seedTitle
      _ <- insertPublishedArtifact(
        "artifact-analysis-previous",
        payload,
        0,
        payloadDepth,
        Some(SeriesAnalysisArtifactSupport.ValidationContractId),
      )
      _ <- insertPublishedArtifact(
        "artifact-analysis-current",
        payload,
        0,
        payloadDepth,
        Some(SeriesAnalysisArtifactSupport.ValidationContractId),
      )
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

  test("exact reader fails closed when the active release still points to a legacy artifact"):
    val payload = Files.readAllBytes(
      repositoryFile("docs/schemas/fixtures/series-analysis/aggregate-payload-v3.json")
    )
    val payloadDepth = parser.parse(new String(payload, StandardCharsets.UTF_8))
      .fold(error => fail(s"invalid shared aggregate fixture: $error"), jsonDepth)
    val artifactId = "artifact-analysis-legacy"
    for
      _ <- seedTitle
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET validation_contract_id = NULL
        WHERE game_title_id = $titleId
      """.update.run.transact(transactor)
      _ <- insertPublishedArtifact(
        artifactId,
        payload,
        itemCount = 0,
        nestingDepth = payloadDepth,
        validationContractId = None,
      )
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET current_artifact_id = $artifactId, pending_work = false
        WHERE game_title_id = $titleId
      """.update.run.transact(transactor)
      repo <- repository
      status <- repo.status(titleId)
      chunk <- repo.chunk(SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Aggregate,
        titleId,
        artifactId,
        SeriesAnalysisScope.Overall,
      ))
    yield
      assertEquals(status, Left(AppError.AnalysisStateUnavailable()))
      assertEquals(chunk, Left(AppError.AnalysisArtifactExpired()))

  private def insertPublishedArtifact(
      artifactId: String,
      payload: Array[Byte],
      itemCount: Int,
      nestingDepth: Int,
      validationContractId: Option[String],
  ): IO[Unit] =
    val length = payload.length
    val checksum = sha256(payload)
    (sql"""
      INSERT INTO series_analysis_artifacts (
        id, game_title_id, input_revision, algorithm_version,
        artifact_schema_version, validation_contract_id, source_input_checksum, root_checksum,
        status, aggregate_chunk_count, review_chunk_count,
        drilldown_chunk_count, match_context_chunk_count,
        encoded_bytes, decoded_bytes, published_at
      ) VALUES (
        $artifactId, $titleId, 0, 'series-analysis-v3',
        2, NULL,
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'staging', 1, 0, 0, 0, $length, $length, NULL
      )
    """.update.run.void *> sql"""
      INSERT INTO series_analysis_scope_aggregate_artifacts (
        artifact_id, scope_key, scope_kind, payload,
        encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum
      ) VALUES (
        $artifactId, 'overall', 'overall', $payload,
        $length, $length, $itemCount, $nestingDepth, $checksum
      )
    """.update.run.void *> validationContractId.traverse_(contractId => sql"""
      UPDATE series_analysis_artifacts
      SET validation_contract_id = $contractId
      WHERE id = $artifactId AND status = 'staging'
    """.update.run.void) *> sql"""
      UPDATE series_analysis_artifacts
      SET status = 'published', published_at = now()
      WHERE id = $artifactId AND status = 'staging'
    """.update.run.void).transact(transactor)

  private def pointToArtifacts(currentId: String, previousId: Option[String]): IO[Unit] = sql"""
      UPDATE series_analysis_title_states
      SET algorithm_version = 'series-analysis-v3',
          artifact_schema_version = 2,
          validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId},
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
