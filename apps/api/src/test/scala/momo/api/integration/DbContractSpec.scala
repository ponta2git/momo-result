package momo.api.integration

import cats.syntax.all.*
import doobie.implicits.*

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
        _ <- sql"""
        INSERT INTO public.game_titles (id, name, layout_family, display_order)
        VALUES ('title_contract', 'Contract title', 'contract', 1)
      """.update.run
        state <- sql"""
        SELECT input_revision, algorithm_version, artifact_schema_version
        FROM public.series_analysis_title_states
        WHERE game_title_id = 'title_contract'
      """.query[(Long, String, Int)].unique
      yield state

    program.transact(transactor).map(state => assertEquals(state, (0L, "series-analysis-v1", 1)))

  test("the shared heavy-work slot starts available with its initial fence"):
    sql"""
      SELECT slot_key, task_kind, owner, fencing_token
      FROM worker_execution_slots
    """.query[(String, Option[String], Option[String], Long)].unique.transact(transactor).map:
      row => assertEquals(row, ("shared-heavy-work", None, None, 0L))

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

end DbContractSpec
