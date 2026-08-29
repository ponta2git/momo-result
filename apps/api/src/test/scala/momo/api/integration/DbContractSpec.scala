package momo.api.integration

import cats.syntax.all.*
import doobie.implicits.*

import momo.api.adapters.postgres.SeriesAnalysisArtifactSupport

/**
 * Cross-consumer DB behavior not owned by one API repository.
 *
 * Repository suites execute the API's production statements and therefore own column, index, and
 * constraint compatibility for those statements. This suite is limited to migration-owned seed
 * meaning and behavior shared with consumers outside the API.
 */
final class DbContractSpec extends IntegrationSuite:

  test("members table is seeded with the four application players"):
    sql"SELECT id FROM members ORDER BY id".query[String].to[Set].transact(transactor).map { ids =>
      assertEquals(
        ids,
        Set("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
      )
    }

  test("login account seeds preserve player identity and the initial administrator"):
    sql"""
      SELECT id, player_member_id, login_enabled, is_admin
      FROM momo_login_accounts
    """.query[(String, Option[String], Boolean, Boolean)].to[Set].transact(transactor).map { rows =>
      assertEquals(
        rows,
        Set[(String, Option[String], Boolean, Boolean)](
          ("account_akane_mami", Some("member_akane_mami"), true, false),
          ("account_eu", Some("member_eu"), true, false),
          ("account_otaka", Some("member_otaka"), true, false),
          ("account_ponta", Some("member_ponta"), true, true),
        ),
      )
    }

  test("incident master seeds preserve the exported domain order"):
    sql"SELECT id FROM incident_masters ORDER BY display_order".query[String].to[List]
      .transact(transactor).map { ids =>
        assertEquals(
          ids,
          List(
            "incident_destination",
            "incident_plus_station",
            "incident_minus_station",
            "incident_card_station",
            "incident_card_shop",
            "incident_suri_no_ginji",
          ),
        )
      }

  test("game-title creation initializes analysis state with an empty caller search path"):
    val program =
      for
        _ <- sql"SELECT set_config('search_path', '', true)".query[String].unique
        release <- sql"""
        SELECT algorithm_version, artifact_schema_version, validation_contract_id
        FROM public.series_analysis_release_state
        WHERE singleton_key = 'current'
      """.query[(String, Int, Option[String])].unique
        _ <- sql"""
        INSERT INTO public.game_titles (id, name, layout_family, display_order)
        VALUES ('title_contract', 'Contract title', 'contract', 1)
      """.update.run
        state <- sql"""
        SELECT input_revision, algorithm_version, artifact_schema_version,
               validation_contract_id
        FROM public.series_analysis_title_states
        WHERE game_title_id = 'title_contract'
      """.query[(Long, String, Int, Option[String])].unique
      yield (release, state)

    program.transact(transactor).map { case (release, state) =>
      assertEquals(state, (0L, release._1, release._2, release._3))
    }

  test("the shared heavy-work slot starts available with its initial fence"):
    sql"""
      SELECT slot_key, task_kind, owner, fencing_token
      FROM worker_execution_slots
    """.query[(String, Option[String], Option[String], Long)].unique.transact(transactor).map:
      row => assertEquals(row, ("shared-heavy-work", None, None, 0L))

  test("published analysis artifact headers and payloads are immutable until parent cleanup"):
    val artifactId = "artifact-contract-immutable"
    val unattestedArtifactId = "artifact-contract-unattested"
    val titleId = "title-contract-immutable"
    val jobId = "job-contract-immutable"
    val attemptId = "attempt-contract-immutable"
    val payloadChecksum =
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    val setup =
      for
        _ <- sql"""
        INSERT INTO game_titles (id, name, layout_family, display_order)
        VALUES ($titleId, 'Immutable contract title', 'contract', 2)
      """.update.run
        _ <- sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
          status, trigger, finished_at, attempt_count, result_disposition
        ) VALUES (
          $jobId, $titleId, 0, 'series-analysis-v1', 2,
          'succeeded', 'manual', clock_timestamp(), 1, 'published'
        )
      """.update.run
        _ <- sql"""
        INSERT INTO series_analysis_job_attempts (
          id, job_id, attempt_no, owner, fencing_token, input_revision, algorithm_version,
          artifact_schema_version, status, outcome, effective_config_version,
          calculation_timeout_milliseconds, finished_at
        ) VALUES (
          $attemptId, $jobId, 1, 'worker-contract', 1, 0, 'series-analysis-v1',
          2, 'terminal', 'succeeded', 'contract-test', 1000, clock_timestamp()
        )
      """.update.run
        _ <- sql"""
        INSERT INTO series_analysis_artifacts (
          id, game_title_id, attempt_id, input_revision, algorithm_version, artifact_schema_version,
          validation_contract_id, source_input_checksum, root_checksum, status,
          aggregate_chunk_count, review_chunk_count, drilldown_chunk_count,
          match_context_chunk_count, encoded_bytes, decoded_bytes
        ) VALUES (
          $artifactId, $titleId, $attemptId, 0, 'series-analysis-v1', 2,
          NULL,
          ${"sha256:" + "0" * 64}, ${"sha256:" + "1" * 64}, 'staging',
          1, 0, 0, 0, 2, 2
        )
      """.update.run
        _ <- sql"""
        INSERT INTO series_analysis_scope_aggregate_artifacts (
          artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes,
          item_count, nesting_depth, checksum
        ) VALUES (
          $artifactId, 'overall', 'overall', decode('7b7d', 'hex'), 2, 2,
          0, 1, $payloadChecksum
        )
      """.update.run
        unsealedHeader <- sql"""
        UPDATE series_analysis_artifacts
        SET root_checksum = ${"sha256:" + "2" * 64}
        WHERE id = $artifactId
      """.update.run
        unsealedChild <- sql"""
        UPDATE series_analysis_scope_aggregate_artifacts
        SET item_count = 1
        WHERE artifact_id = $artifactId AND scope_key = 'overall'
      """.update.run
        sealedCount <- sql"""
        UPDATE series_analysis_artifacts
        SET validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
        WHERE id = $artifactId
      """.update.run
        _ <- sql"""
        INSERT INTO series_analysis_artifacts (
          id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
          validation_contract_id, source_input_checksum, root_checksum, status,
          aggregate_chunk_count, review_chunk_count, drilldown_chunk_count,
          match_context_chunk_count, encoded_bytes, decoded_bytes
        ) VALUES (
          $unattestedArtifactId, $titleId, 0, 'series-analysis-v1', 2,
          NULL, ${"sha256:" + "4" * 64}, ${"sha256:" + "5" * 64}, 'staging',
          1, 0, 0, 0, 0, 0
        )
      """.update.run
        _ <- sql"""
        UPDATE series_analysis_artifacts
        SET status = 'published', published_at = clock_timestamp()
        WHERE id = $unattestedArtifactId
      """.update.run
      yield (unsealedHeader, unsealedChild, sealedCount)
    val insertAlreadyPublished = sql"""
      INSERT INTO series_analysis_artifacts (
        id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
        source_input_checksum, root_checksum, status, aggregate_chunk_count,
        review_chunk_count, drilldown_chunk_count, match_context_chunk_count,
        encoded_bytes, decoded_bytes, published_at
      ) VALUES (
        'artifact-contract-direct-published', $titleId, 0, 'series-analysis-v1', 2,
        ${"sha256:" + "8" * 64}, ${"sha256:" + "9" * 64}, 'published',
        1, 0, 0, 0, 0, 0, clock_timestamp()
      )
    """.update.run
    val insertAlreadySealed = sql"""
      INSERT INTO series_analysis_artifacts (
        id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
        validation_contract_id, source_input_checksum, root_checksum, status,
        aggregate_chunk_count, review_chunk_count, drilldown_chunk_count,
        match_context_chunk_count, encoded_bytes, decoded_bytes
      ) VALUES (
        'artifact-contract-direct-sealed', $titleId, 0, 'series-analysis-v1', 2,
        ${SeriesAnalysisArtifactSupport.ValidationContractId},
        ${"sha256:" + "a" * 64}, ${"sha256:" + "b" * 64}, 'staging',
        1, 0, 0, 0, 0, 0
      )
    """.update.run
    val insertSealProbes = sql"""
      INSERT INTO series_analysis_artifacts (
        id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
        source_input_checksum, root_checksum, status, aggregate_chunk_count,
        review_chunk_count, drilldown_chunk_count, match_context_chunk_count,
        encoded_bytes, decoded_bytes
      ) VALUES
        ('artifact-contract-wrong-seal', $titleId, 0, 'series-analysis-v1', 2,
         ${"sha256:" + "c" * 64}, ${"sha256:" + "d" * 64}, 'staging',
         1, 0, 0, 0, 0, 0),
        ('artifact-contract-wrong-schema', $titleId, 0, 'series-analysis-v1', 1,
         ${"sha256:" + "e" * 64}, ${"sha256:" + "f" * 64}, 'staging',
         1, 0, 0, 0, 0, 0)
    """.update.run
    val sealWrongContract = sql"""
      UPDATE series_analysis_artifacts
      SET validation_contract_id = 'another-valid-validator'
      WHERE id = 'artifact-contract-wrong-seal'
    """.update.run
    val sealWrongSchema = sql"""
      UPDATE series_analysis_artifacts
      SET validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
      WHERE id = 'artifact-contract-wrong-schema'
    """.update.run
    val publishStaging =
      for
        published <- sql"""
        UPDATE series_analysis_artifacts
        SET status = 'published', published_at = clock_timestamp()
        WHERE id = $artifactId
      """.update.run
        provenanceReleased <- sql"""
        UPDATE series_analysis_artifacts
        SET attempt_id = NULL
        WHERE id = $artifactId
      """.update.run
        pointed <- sql"""
        UPDATE series_analysis_title_states
        SET artifact_schema_version = 2,
            validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId},
            current_artifact_id = $artifactId
        WHERE game_title_id = $titleId
      """.update.run
      yield (published, provenanceReleased, pointed)
    val mutateSealedHeader = sql"""
      UPDATE series_analysis_artifacts
      SET root_checksum = ${"sha256:" + "6" * 64}
      WHERE id = $artifactId
    """.update.run
    val unsealArtifact = sql"""
      UPDATE series_analysis_artifacts
      SET validation_contract_id = NULL
      WHERE id = $artifactId
    """.update.run
    val combineMutationWithPublication = sql"""
      UPDATE series_analysis_artifacts
      SET status = 'published', published_at = clock_timestamp(),
          root_checksum = ${"sha256:" + "7" * 64}
      WHERE id = $artifactId
    """.update.run
    val mutateSealedPayload = sql"""
      UPDATE series_analysis_scope_aggregate_artifacts
      SET payload = decode('7b7c', 'hex')
      WHERE artifact_id = $artifactId AND scope_key = 'overall'
    """.update.run
    val pointUnattested = sql"""
      UPDATE series_analysis_title_states
      SET current_artifact_id = $unattestedArtifactId
      WHERE game_title_id = $titleId
    """.update.run
    val pointUnattestedPrevious = sql"""
      UPDATE series_analysis_title_states
      SET previous_artifact_id = $unattestedArtifactId
      WHERE game_title_id = $titleId
    """.update.run
    val deleteReferencedParent = sql"""
      DELETE FROM series_analysis_artifacts
      WHERE id = $artifactId
    """.update.run
    val mutateHeader = sql"""
      UPDATE series_analysis_artifacts
      SET root_checksum = ${"sha256:" + "3" * 64}
      WHERE id = $artifactId
    """.update.run
    val mutateAttestation = sql"""
      UPDATE series_analysis_artifacts
      SET validation_contract_id = 'another-valid-validator'
      WHERE id = $artifactId
    """.update.run
    val mutateChild = sql"""
      UPDATE series_analysis_scope_aggregate_artifacts
      SET item_count = 2
      WHERE artifact_id = $artifactId AND scope_key = 'overall'
    """.update.run
    val deleteChild = sql"""
      DELETE FROM series_analysis_scope_aggregate_artifacts
      WHERE artifact_id = $artifactId AND scope_key = 'overall'
    """.update.run
    val insertChild = sql"""
      INSERT INTO series_analysis_scope_aggregate_artifacts (
        artifact_id, scope_key, scope_kind, map_master_id, payload, encoded_bytes,
        decoded_bytes, item_count, nesting_depth, checksum
      ) VALUES (
        $artifactId, 'map:map-contract', 'map', 'map-contract', decode('7b7d', 'hex'), 2,
        2, 0, 1, $payloadChecksum
      )
    """.update.run
    val installedChildGuards = sql"""
      SELECT c.relname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND t.tgname IN (
          'series_analysis_aggregate_published_guard',
          'series_analysis_review_published_guard',
          'series_analysis_drilldown_published_guard',
          'series_analysis_context_published_guard'
        )
    """.query[String].to[Set]

    for
      setupResult <- setup.transact(transactor)
      directPublishedResult <- insertAlreadyPublished.transact(transactor).attempt
      directSealedResult <- insertAlreadySealed.transact(transactor).attempt
      sealProbeCount <- insertSealProbes.transact(transactor)
      wrongContractResult <- sealWrongContract.transact(transactor).attempt
      wrongSchemaResult <- sealWrongSchema.transact(transactor).attempt
      sealedHeaderResult <- mutateSealedHeader.transact(transactor).attempt
      unsealResult <- unsealArtifact.transact(transactor).attempt
      combinedPublishResult <- combineMutationWithPublication.transact(transactor).attempt
      sealedPayloadResult <- mutateSealedPayload.transact(transactor).attempt
      published <- publishStaging.transact(transactor)
      headerResult <- mutateHeader.transact(transactor).attempt
      attestationResult <- mutateAttestation.transact(transactor).attempt
      childUpdateResult <- mutateChild.transact(transactor).attempt
      childDeleteResult <- deleteChild.transact(transactor).attempt
      childInsertResult <- insertChild.transact(transactor).attempt
      unattestedPointerResult <- pointUnattested.transact(transactor).attempt
      unattestedPreviousResult <- pointUnattestedPrevious.transact(transactor).attempt
      referencedDeleteResult <- deleteReferencedParent.transact(transactor).attempt
      guards <- installedChildGuards.transact(transactor)
      cleared <- sql"""
        UPDATE series_analysis_title_states
        SET current_artifact_id = NULL
        WHERE game_title_id = $titleId
      """.update.run.transact(transactor)
      deleted <- sql"""
        DELETE FROM series_analysis_artifacts
        WHERE id IN (
          $artifactId, $unattestedArtifactId,
          'artifact-contract-wrong-seal', 'artifact-contract-wrong-schema'
        )
      """.update.run
        .transact(transactor)
      remainingChildren <- sql"""
        SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts
        WHERE artifact_id = $artifactId
      """.query[Long].unique.transact(transactor)
    yield
      assertEquals(setupResult, (1, 1, 1))
      assertUnattestedStagingInsertRequired(directPublishedResult)
      assertUnattestedStagingInsertRequired(directSealedResult)
      assertEquals(sealProbeCount, 2)
      assertExactSealRejected(wrongContractResult)
      assertExactSealRejected(wrongSchemaResult)
      assertSealedHeaderMutationRejected(sealedHeaderResult)
      assertSealedHeaderMutationRejected(unsealResult)
      assertSealedHeaderMutationRejected(combinedPublishResult)
      assertAttestedPayloadMutationRejected(sealedPayloadResult)
      assertEquals(published, (1, 1, 1))
      assertPublishedMutationRejected(headerResult, "headers")
      assertPublishedMutationRejected(attestationResult, "headers")
      assertPublishedMutationRejected(childUpdateResult, "payloads")
      assertPublishedMutationRejected(childDeleteResult, "payloads")
      assertPublishedMutationRejected(childInsertResult, "payloads")
      assertAttestationPointerRejected(unattestedPointerResult)
      assertPreviousAttestationPointerRejected(unattestedPreviousResult)
      assertReferencedParentDeleteRejected(referencedDeleteResult)
      assertEquals(
        guards,
        Set(
          "series_analysis_scope_aggregate_artifacts",
          "series_analysis_scope_review_artifacts",
          "series_analysis_drilldown_artifacts",
          "series_analysis_match_context_artifacts",
        ),
      )
      assertEquals(cleared, 1)
      assertEquals(deleted, 4)
      assertEquals(remainingChildren, 0L)

  test("OCR migration accepts complete v1 and v2 inputs but rejects incomplete v2 input"):
    val accountId = "account_ponta"
    val insertSource = sql"""
      INSERT INTO source_images (
        id, owner_account_id, object_key, idempotency_key_hash, status,
        media_type, byte_length, sha256_hex, width, height, available_at
      ) VALUES (
        'source-contract-v2', $accountId, 'source-images/contract/input.webp',
        repeat('a', 64), 'AVAILABLE', 'image/webp', 3145728, repeat('b', 64), 1920, 1080, now()
      )
    """.update.run
    val insertV1 = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, image_path, requested_screen_type, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'job-contract-v1', 'draft-contract-v1', 'image-contract-v1',
        '/tmp/image-contract-v1.png', 'total_assets', 'queued', 0, now(), now()
      )
    """.update.run
    val insertV2 = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, source_image_id, queue_schema_version,
        requested_screen_type, status, attempt_count, created_at, updated_at
      ) VALUES (
        'job-contract-v2', 'draft-contract-v2', 'source-contract-v2',
        'source-contract-v2', 2, 'revenue', 'queued', 0, now(), now()
      )
    """.update.run
    val insertInvalidV2 = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, queue_schema_version, requested_screen_type,
        status, attempt_count, created_at, updated_at
      ) VALUES (
        'job-contract-v2-invalid', 'draft-contract-v2-invalid', 'image-contract-v2-invalid',
        2, 'incident_log', 'queued', 0, now(), now()
      )
    """.update.run

    (insertSource *> insertV1 *> insertV2).transact(transactor) *>
      insertInvalidV2.transact(transactor).attempt.map(result => assert(result.isLeft))

  private def assertPublishedMutationRejected(
      result: Either[Throwable, Int],
      boundary: String,
  ): Unit = result match
    case Left(error) =>
      val expected =
        if boundary == "headers" then "published series analysis artifact headers are immutable"
        else "attested series analysis artifact payloads are immutable"
      assert(error.getMessage.contains(expected), error.getMessage)
    case Right(updated) => fail(s"published artifact mutation unexpectedly changed $updated rows")

  private def assertSealedHeaderMutationRejected(result: Either[Throwable, Int]): Unit =
    result match
      case Left(error) => assert(
          error.getMessage.contains("attested staging series analysis artifact headers"),
          error.getMessage,
        )
      case Right(updated) => fail(s"attested staging header unexpectedly changed $updated rows")

  private def assertUnattestedStagingInsertRequired(result: Either[Throwable, Int]): Unit =
    result match
      case Left(error) => assert(
          error.getMessage.contains("must begin as unattested staging rows"),
          error.getMessage,
        )
      case Right(inserted) => fail(s"invalid artifact header unexpectedly inserted $inserted rows")

  private def assertExactSealRejected(result: Either[Throwable, Int]): Unit = result match
    case Left(error) => assert(
        error.getMessage.contains("must be an exact seal-only transition"),
        error.getMessage,
      )
    case Right(updated) => fail(s"invalid artifact attestation unexpectedly changed $updated rows")

  private def assertAttestedPayloadMutationRejected(result: Either[Throwable, Int]): Unit =
    result match
      case Left(error) => assert(
          error.getMessage.contains("attested series analysis artifact payloads are immutable"),
          error.getMessage,
        )
      case Right(updated) => fail(s"attested staging payload unexpectedly changed $updated rows")

  private def assertAttestationPointerRejected(result: Either[Throwable, Int]): Unit = result match
    case Left(error) => assert(
        error.getMessage.contains("not an attested published desired-version artifact"),
        error.getMessage,
      )
    case Right(updated) => fail(s"unattested artifact pointer unexpectedly changed $updated rows")

  private def assertPreviousAttestationPointerRejected(result: Either[Throwable, Int]): Unit =
    result match
      case Left(error) => assert(
          error.getMessage.contains(
            "previous series analysis artifact is not an attested publication"
          ),
          error.getMessage,
        )
      case Right(updated) =>
        fail(s"unattested previous artifact pointer unexpectedly changed $updated rows")

  private def assertReferencedParentDeleteRejected(result: Either[Throwable, Int]): Unit =
    result match
      case Left(error) => assert(
          error.getMessage.contains("series_analysis_title_states_current_artifact_fk"),
          error.getMessage,
        )
      case Right(updated) => fail(s"referenced artifact unexpectedly deleted $updated rows")

end DbContractSpec
