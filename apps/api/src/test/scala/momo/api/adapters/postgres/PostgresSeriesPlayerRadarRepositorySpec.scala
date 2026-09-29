package momo.api.adapters.postgres

import java.nio.file.Files
import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json}

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.integration.IntegrationSuite
import momo.api.testing.JsonSchemaAssertions
import momo.api.usecases.seriesanalysis.RequestSeriesPlayerRadarOperation

final class PostgresSeriesPlayerRadarRepositorySpec extends IntegrationSuite
    with JsonSchemaAssertions:
  private val title = GameTitleId.unsafeFromString("title")
  private val account = AccountId.unsafeFromString("account_ponta")
  private val now = Instant.parse("2026-09-29T00:00:00Z")
  private val candidateId = "radar-candidate-ready"
  private val basisId = "radar-basis-ready"
  private val previewId = "radar-preview-ready"

  private def repo =
    PostgresSeriesPlayerRadarRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
  private def seedTitle: IO[Unit] = new PostgresGameTitlesRepository[IO](transactor)
    .createWithNextDisplayOrder(GameTitle(title, "レーダー契約作品", "momotetsu2", 1, now)).void

  private def fixture(kind: String): Json = parser.parse(Files.readString(repositoryFile(
    s"docs/schemas/fixtures/series-analysis/radar-$kind-v1.json"
  )))
    .fold(error => fail(s"Invalid Rust fixture: $error"), identity)

  /** Stored Worker output is the fixture here; these tests exercise acceptance, never recalculate it. */
  private def seedReady: IO[Unit] =
    val basis = fixture("basis").noSpaces
    val source = fixture("source").noSpaces
    val result = fixture("candidate").noSpaces
    val after = fixture("evaluation")
    val checksum =
      after.hcursor.get[String]("basisChecksum").getOrElse(fail("missing basis checksum"))
    val sourceChecksum = fixture("basis").hcursor.downField("source").get[String]("sourceChecksum")
      .getOrElse(fail("missing source checksum"))
    val payload = Json.obj("before" -> Json.Null, "after" -> after).noSpaces
    (sql"""
      INSERT INTO series_radar_title_states(game_title_id) VALUES ($title)
      ON CONFLICT (game_title_id) DO NOTHING
    """.update.run *>
      sql"""
      INSERT INTO series_radar_bases
        (id, game_title_id, checksum, payload, source_snapshot, source_checksum, source_input_revision)
      SELECT $basisId, $title, $checksum, $basis::jsonb, $source::jsonb, $sourceChecksum, input_revision
      FROM series_analysis_title_states WHERE game_title_id = $title
    """.update.run *>
      sql"""
      INSERT INTO series_radar_candidates(id, game_title_id, basis_id, status, result, source_input_revision)
      SELECT $candidateId, $title, $basisId, 'ready', $result::jsonb, input_revision
      FROM series_analysis_title_states WHERE game_title_id = $title
    """.update.run *>
      sql"""
      INSERT INTO series_radar_previews
        (id, game_title_id, candidate_id, before_basis_id, input_revision, status, evaluation_snapshot, scope_keys)
      SELECT $previewId, $title, $candidateId, NULL, input_revision, 'ready', $source::jsonb, ARRAY['overall']
      FROM series_analysis_title_states WHERE game_title_id = $title
    """.update.run *> sql"""
      INSERT INTO series_radar_preview_scopes(preview_id, scope_key, payload)
      VALUES ($previewId, 'overall', $payload::jsonb)
    """.update.run).transact(transactor).void

  private def command(
      kind: SeriesPlayerRadarOperationKind,
      candidate: Option[String],
      preview: Option[String]
  ): SeriesPlayerRadarCommand =
    SeriesPlayerRadarCommand(title, kind, candidate, preview, None, None, None)

  test("concurrent retries retain one operation and candidate after the HTTP replay cache expires"):
    for
      _ <- seedTitle
      repository <- repo
      useCase = RequestSeriesPlayerRadarOperation[IO](repository)
      request = command(SeriesPlayerRadarOperationKind.Candidate, None, None)
      results <- (
        useCase.run(request, account, "same-candidate"),
        useCase.run(request, account, "same-candidate")
      ).parTupled
      counts <- sql"""
        SELECT (SELECT count(*)::int FROM series_radar_candidates),
          (SELECT count(*)::int FROM series_radar_operations)
      """.query[(Int, Int)].unique.transact(transactor)
      state <- repository.radarState(title)
    yield
      assertEquals(results._1, results._2)
      assertEquals(results._1.map(_.status), Right("pending"))
      assertEquals(counts, (1, 1))
      assert(state.isRight)

  test(
    "withdrawal before job materialization fences the desired basis and retains a durable normal recovery"
  ):
    for
      _ <- seedTitle *> seedReady
      repository <- repo
      useCase = RequestSeriesPlayerRadarOperation[IO](repository)
      accepted <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Apply, Some(candidateId), Some(previewId)),
        account,
        "apply"
      )
      replay <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Apply, Some(candidateId), Some(previewId)),
        account,
        "apply"
      )
      requested <- titleState
      jobsBeforeWithdrawal <-
        sql"SELECT count(*)::int FROM series_analysis_jobs WHERE game_title_id = $title"
          .query[Int].unique.transact(transactor)
      withdrawn <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Withdraw, Some(candidateId), None),
        account,
        "withdraw"
      )
      finalState <- titleState
      original <- accepted.traverse(value => repository.radarOperation(title, value.operationId))
      pending <-
        sql"SELECT pending_work FROM series_analysis_title_states WHERE game_title_id = $title"
          .query[Boolean].unique.transact(transactor)
      recovery <- sql"""
        SELECT status, assigned_job_id, force_run FROM series_analysis_job_requests
        WHERE game_title_id = $title
      """.query[(String, Option[String], Boolean)].to[List].transact(transactor)
    yield
      assertEquals(accepted, replay)
      assertEquals(accepted.map(_.status), Right("pending"))
      assertEquals(requested._1, Some(basisId))
      assertEquals(requested._2, None)
      assertEquals(requested._3, 1L)
      assertEquals(jobsBeforeWithdrawal, 0)
      assertEquals(withdrawn.map(_.status), Right("succeeded"))
      assertEquals(finalState, (None, None, 2L, None))
      assertEquals(original.toOption.flatMap(_.toOption).map(_.status), Some("withdrawn"))
      assertEquals(recovery, List(("pending", None, false)))
      assert(pending)

  test(
    "a stale comparison cannot be applied and a missing nonempty preview is not reported as empty"
  ):
    for
      _ <- seedTitle *> seedReady
      repository <- repo
      initial <- repository.radarPreview(SeriesPlayerRadarPreviewRequest(
        title,
        previewId,
        SeriesAnalysisScope.Overall
      ))
      _ <- sql"UPDATE series_radar_previews SET status = 'stale' WHERE id = $previewId"
        .update.run.transact(transactor)
      refused <- RequestSeriesPlayerRadarOperation[IO](repository).run(
        command(SeriesPlayerRadarOperationKind.Apply, Some(candidateId), Some(previewId)),
        account,
        "stale-apply"
      )
      _ <-
      (sql"UPDATE series_radar_previews SET status = 'ready' WHERE id = $previewId".update.run *>
        sql"DELETE FROM series_radar_preview_scopes WHERE preview_id = $previewId".update.run).transact(
        transactor
      )
      missing <- repository.radarPreview(SeriesPlayerRadarPreviewRequest(
        title,
        previewId,
        SeriesAnalysisScope.Overall
      ))
      unchanged <- titleState
    yield
      assert(initial.isRight, initial.toString)
      assertEquals(refused.left.toOption.map(_.code), Some("CONFLICT"))
      assertEquals(missing.left.toOption.map(_.code), Some("INTERNAL_ERROR"))
      assertEquals(unchanged, (None, None, 0L, None))

  test(
    "owner-only edits keep the comparison usable but a source result edit stops an accepted application"
  ):
    val original = matchRecord
    val ownerEdit = original.copy(ownerMemberId = MemberId.unsafeFromString("member_eu"))
    val resultEdit = ownerEdit.copy(playedAt = now.plusSeconds(1))
    for
      _ <- seedTitle *> seedMatchPrerequisites
      _ <- new PostgresMatchConfirmationRepository[IO](transactor).confirm(original, None, now)
      _ <- seedReady
      repository <- repo
      matches = new PostgresMatchesRepository[IO](transactor)
      _ <- matches.update(ownerEdit, now.plusSeconds(1))
      retained <- sql"""
        SELECT c.status, p.status FROM series_radar_candidates c
        JOIN series_radar_previews p ON p.candidate_id = c.id WHERE c.id = $candidateId
      """.query[(String, String)].unique.transact(transactor)
      accepted <- RequestSeriesPlayerRadarOperation[IO](repository).run(
        command(SeriesPlayerRadarOperationKind.Apply, Some(candidateId), Some(previewId)),
        account,
        "owner-safe-apply"
      )
      _ <- matches.update(resultEdit, now.plusSeconds(2))
      candidate <- sql"SELECT status FROM series_radar_candidates WHERE id = $candidateId"
        .query[String].unique.transact(transactor)
      application <- accepted.traverse(value => repository.radarOperation(title, value.operationId))
      restored <- titleState
    yield
      assertEquals(retained, ("ready", "ready"))
      assert(accepted.isRight, accepted.toString)
      assertEquals(candidate, "invalid")
      assertEquals(application.toOption.flatMap(_.toOption).map(_.status), Some("failed"))
      assertEquals(restored, (None, None, 2L, None))

  test("a queued preparation never absorbs a normal manual or match-mutation request"):
    for
      _ <- seedTitle
      radar <- repo
      accepted <- RequestSeriesPlayerRadarOperation[IO](radar).run(
        command(SeriesPlayerRadarOperationKind.Candidate, None, None),
        account,
        "prepare"
      )
      operationId =
        accepted.toOption.map(_.operationId).getOrElse(fail("missing preparation operation"))
      _ <-
        sql"""
        INSERT INTO series_analysis_jobs(id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id, status, trigger, work_kind, radar_operation_id)
        VALUES ('radar-prepare-job', $title, 0, 'series-analysis-v6', 5,
          'series-analysis-artifact-v5-full-validation-v1', 'queued', 'manual', 'radar_prepare', $operationId)
      """.update.run.transact(transactor)
      analysis <-
        PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      manual <- analysis.requestTitleRecalculation(title, account, "normal-during-prepare")
      _ <- PostgresSeriesAnalysisMutationOps.enqueueMatchMutation(List(title)).transact(transactor)
      assigned <-
        sql"SELECT assigned_job_id FROM series_analysis_job_requests WHERE game_title_id = $title"
          .query[Option[String]].to[List].transact(transactor)
      job <-
        sql"SELECT work_kind, input_revision FROM series_analysis_jobs WHERE id = 'radar-prepare-job'"
          .query[(String, Long)].unique.transact(transactor)
    yield
      assertEquals(manual.map(_.target.flatMap(_.jobId)), Right(None))
      assertEquals(assigned, List(None, None))
      assertEquals(job, ("radar_prepare", 0L))

  test(
    "valid empty scopes retain names, new records wait for analysis, and indexed missing chunks fail closed"
  ):
    val scope = SeriesAnalysisScope.SeasonMap(
      SeasonMasterId.unsafeFromString("winter"),
      MapMasterId.unsafeFromString("east")
    )
    for
      _ <- seedTitle *> seedMatchPrerequisites
      analysis <-
        PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      empty <- analysis.scopeStatus(SeriesAnalysisScopeStatusRequest(title, None, scope))
      _ <- new PostgresMatchConfirmationRepository[IO](transactor).confirm(matchRecord, None, now)
      waiting <- analysis.scopeStatus(SeriesAnalysisScopeStatusRequest(title, None, scope))
      _ <-
      (sql"""
        INSERT INTO series_analysis_artifacts(id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, source_input_checksum, root_checksum, status,
          aggregate_chunk_count, review_chunk_count, drilldown_chunk_count, match_context_chunk_count,
          encoded_bytes, decoded_bytes, scope_keys)
        SELECT 'artifact-scope-proof', $title, input_revision, 'series-analysis-v6', 5,
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          'staging', 2, 0, 0, 1, 2, 2, ARRAY['overall', ${scope.key}]
        FROM series_analysis_title_states WHERE game_title_id = $title
      """.update.run *> sql"""
        UPDATE series_analysis_artifacts
        SET validation_contract_id = 'series-analysis-artifact-v5-full-validation-v1'
        WHERE id = 'artifact-scope-proof'
      """.update.run *> sql"""
        UPDATE series_analysis_artifacts SET status = 'published', published_at = now()
        WHERE id = 'artifact-scope-proof'
      """.update.run *> sql"""
        UPDATE series_analysis_title_states SET current_artifact_id = 'artifact-scope-proof'
        WHERE game_title_id = $title
      """.update.run).transact(transactor)
      indexed <- analysis.scopeStatus(SeriesAnalysisScopeStatusRequest(
        title,
        Some("artifact-scope-proof"),
        scope
      ))
      missing <- analysis.chunk(SeriesAnalysisChunkRequest(
        SeriesAnalysisChunkKind.Aggregate,
        title,
        "artifact-scope-proof",
        scope
      ))
    yield
      assertEquals(
        empty.map(value => (value.state, value.seasonName, value.mapName)),
        Right(("empty", Some("冬"), Some("東")))
      )
      assertEquals(waiting.map(_.state), Right("awaiting_analysis"))
      assertEquals(indexed.map(_.state), Right("available"))
      assertEquals(missing.left.toOption.map(_.code), Some("INTERNAL_ERROR"))

  test(
    "retry resumes a confirmed failed candidate with a new inspectable operation and the same candidate"
  ):
    for
      _ <- seedTitle
      repository <- repo
      useCase = RequestSeriesPlayerRadarOperation[IO](repository)
      first <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Candidate, None, None),
        account,
        "initial"
      )
      original = first.toOption.getOrElse(fail("candidate was not accepted"))
      retryCommand = command(SeriesPlayerRadarOperationKind.Retry, None, None)
        .copy(originOperationId = Some(original.operationId))
      refused <- useCase.run(retryCommand, account, "retry-pending")
      _ <-
      (sql"""
        UPDATE series_radar_operations SET status = 'failed', finished_at = now(), safe_failure_code = 'calculation_failed'
        WHERE id = ${original.operationId}
      """.update.run *> sql"""
        UPDATE series_radar_candidates SET status = 'failed', safe_failure_code = 'calculation_failed'
        WHERE id = ${original.candidateId}
      """.update.run).transact(transactor)
      accepted <- useCase.run(retryCommand, account, "retry-failed")
      replay <- useCase.run(retryCommand, account, "retry-failed")
      status <- sql"SELECT status FROM series_radar_candidates WHERE id = ${original.candidateId}"
        .query[String].unique.transact(transactor)
    yield
      assertEquals(refused.left.toOption.map(_.code), Some("CONFLICT"))
      assertEquals(accepted, replay)
      assertEquals(
        accepted.map(value =>
          (value.kind, value.status, value.originOperationId, value.candidateId)
        ),
        Right(("candidate", "pending", Some(original.operationId), original.candidateId))
      )
      assert(accepted.toOption.exists(_.operationId != original.operationId))
      assertEquals(status, "pending")

  test(
    "restoring the previous basis first creates a candidate and cannot silently change the published basis"
  ):
    val current = "radar-current-basis"
    for
      _ <- seedTitle *> seedReady
      _ <-
      (sql"""
        INSERT INTO series_radar_bases
          (id, game_title_id, checksum, payload, source_snapshot, source_checksum, source_input_revision)
        SELECT $current, game_title_id, checksum, payload, source_snapshot, source_checksum, source_input_revision
        FROM series_radar_bases WHERE id = $basisId
      """.update.run *>
        sql"""
        UPDATE series_radar_title_states SET current_basis_id = $current, desired_basis_id = $current,
          previous_basis_id = $basisId, current_applied_at = now(), previous_applied_at = now()
        WHERE game_title_id = $title
      """.update.run *>
        sql"UPDATE series_radar_candidates SET status = 'applied' WHERE id = $candidateId"
          .update.run).transact(transactor)
      repository <- repo
      useCase = RequestSeriesPlayerRadarOperation[IO](repository)
      refused <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Restore, None, None),
        account,
        "restore-stale"
      )
      accepted <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Restore, None, None)
          .copy(expectedCurrentBasisId = Some(current)),
        account,
        "restore"
      )
      unchanged <- titleState
      candidate <- accepted.traverse(value => sql"""
        SELECT status, basis_id FROM series_radar_candidates WHERE id = ${value.candidateId}
      """.query[(String, Option[String])].unique.transact(transactor))
    yield
      assertEquals(refused.left.toOption.map(_.code), Some("CONFLICT"))
      assertEquals(
        accepted.map(value => (value.kind, value.status, value.basisId)),
        Right(("restore", "pending", Some(basisId)))
      )
      assertEquals(candidate, Right(("pending", Some(basisId))))
      assertEquals(unchanged, (Some(current), Some(current), 0L, None))

  test("review acknowledgment applies only to the displayed evidence and survives a reload"):
    val monitoring = fixture("monitoring")
    val evidence = monitoring.hcursor.downField("reasons").downArray.get[String]("evidenceChecksum")
      .getOrElse(fail("monitoring fixture has no evidence"))
    for
      _ <- seedTitle *> seedReady
      _ <-
        sql"UPDATE series_radar_title_states SET monitor = ${monitoring.noSpaces}::jsonb WHERE game_title_id = $title"
          .update.run.transact(transactor)
      repository <- repo
      useCase = RequestSeriesPlayerRadarOperation[IO](repository)
      refused <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Acknowledge, None, None)
          .copy(evidenceKey = Some("outdated-evidence")),
        account,
        "ack-stale"
      )
      accepted <- useCase.run(
        command(SeriesPlayerRadarOperationKind.Acknowledge, None, None)
          .copy(evidenceKey = Some(evidence)),
        account,
        "ack-current"
      )
      document <- repository.radarState(title)
    yield
      assertEquals(refused.left.toOption.map(_.code), Some("CONFLICT"))
      assertEquals(accepted.map(_.status), Right("succeeded"))
      val saved = document.toOption.map(value =>
        parser.parse(new String(
          value.payload,
          java.nio.charset.StandardCharsets.UTF_8
        )).toOption.getOrElse(fail("invalid saved state"))
      )
        .getOrElse(fail("state read failed"))
      assertEquals(
        saved.hcursor.get[List[String]]("acknowledgedEvidenceKeys"),
        Right(List(evidence))
      )

  private def titleState: IO[(Option[String], Option[String], Long, Option[String])] = sql"""
    SELECT desired_basis_id, current_basis_id, generation, active_operation_id
    FROM series_radar_title_states WHERE game_title_id = $title
  """.query[(Option[String], Option[String], Long, Option[String])].unique.transact(transactor)

  private def seedMatchPrerequisites: IO[Unit] =
    (sql"INSERT INTO map_masters(id, game_title_id, name, display_order) VALUES ('east', $title, '東', 1)".update.run *>
      sql"INSERT INTO season_masters(id, game_title_id, name, display_order) VALUES ('winter', $title, '冬', 1)".update.run *>
      sql"INSERT INTO held_events(id, held_date_iso, start_at) VALUES ('event-0000', '2026-09-29', $now)".update.run)
      .transact(transactor).void

  private def matchRecord: MatchRecord =
    def player(id: String, order: Int): PlayerResult = PlayerResult.unsafeFromInts(
      MemberId.unsafeFromString(id),
      order,
      order,
      1000 * order,
      100 * order,
      IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0)
    )
    MatchRecord(
      MatchId.unsafeFromString("match-0000"),
      HeldEventId.unsafeFromString("event-0000"),
      MatchNoInEvent.unsafeFromInt(1),
      title,
      "momotetsu2",
      SeasonMasterId.unsafeFromString("winter"),
      MemberId.unsafeFromString("member_ponta"),
      MapMasterId.unsafeFromString("east"),
      now,
      None,
      None,
      None,
      FourPlayers(
        player("member_ponta", 1),
        player("member_eu", 2),
        player("member_otaka", 3),
        player("member_akane_mami", 4)
      ),
      account,
      Some(MemberId.unsafeFromString("member_ponta")),
      now
    )
