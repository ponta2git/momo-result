package momo.api.integration

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*

/**
 * Lightweight smoke test that the Testcontainers Postgres exposes the columns and seeded rows the
 * API expects. If this fails, the migrations in `momo-db` have drifted from the API's contract.
 */
final class DbContractSpec extends IntegrationSuite:

  private def columnsFor(tableName: String) = sql"""
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $tableName
    ORDER BY ordinal_position
  """.query[String].to[List].transact(transactor)

  test("members table is seeded with the four MVP players"):
    val program = sql"""
      SELECT id, display_name FROM members ORDER BY id
    """.query[(String, String)].to[List].transact(transactor)
    program.map { rows =>
      val ids = rows.map(_._1).toSet
      assertEquals(
        ids,
        Set("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
        s"unexpected members: $rows",
      )
    }

  test("momo_login_accounts table is seeded with MVP player accounts"):
    val program = sql"""
      SELECT id, player_member_id, login_enabled, is_admin
      FROM momo_login_accounts
      ORDER BY id
    """.query[(String, Option[String], Boolean, Boolean)].to[List].transact(transactor)
    program.map { rows =>
      assertEquals(
        rows.toSet,
        Set[(String, Option[String], Boolean, Boolean)](
          ("account_akane_mami", Some("member_akane_mami"), true, false),
          ("account_eu", Some("member_eu"), true, false),
          ("account_otaka", Some("member_otaka"), true, false),
          ("account_ponta", Some("member_ponta"), true, true),
        ),
        s"unexpected login accounts: $rows",
      )
    }

  test("incident_masters has the 6 fixed incident IDs"):
    val program = sql"""
      SELECT id FROM incident_masters ORDER BY display_order
    """.query[String].to[List].transact(transactor)
    program.map { ids =>
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

  test("member_aliases exposes OCR name resolution columns and indexes"):
    val columnProgram = columnsFor("member_aliases")
    val indexProgram = sql"""
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'member_aliases'
        AND indexname IN ('member_aliases_member_alias_unique', 'member_aliases_alias_idx')
    """.query[String].to[List].transact(transactor)
    (columnProgram, indexProgram).mapN { (cols, indexes) =>
      val missing = Set("id", "member_id", "alias", "created_at") -- cols.toSet
      assert(missing.isEmpty, s"member_aliases is missing columns: $missing (have $cols)")
      assertEquals(
        indexes.toSet,
        Set("member_aliases_member_alias_unique", "member_aliases_alias_idx"),
      )
    }

  test("matches table exposes the expected columns"):
    columnsFor("matches").map { cols =>
      val expected = Set(
        "id",
        "held_event_id",
        "match_no_in_event",
        "game_title_id",
        "layout_family",
        "season_master_id",
        "owner_member_id",
        "map_master_id",
        "played_at",
        "total_assets_draft_id",
        "revenue_draft_id",
        "incident_log_draft_id",
        "created_by_account_id",
        "created_by_member_id",
        "created_at",
        "updated_at",
        "analysis_revision",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"matches is missing columns: $missing (have $cols)")
    }

  test("match_drafts table exposes the expected workflow and source-image columns"):
    columnsFor("match_drafts").map { cols =>
      val expected = Set(
        "id",
        "created_by_account_id",
        "created_by_member_id",
        "status",
        "held_event_id",
        "match_no_in_event",
        "game_title_id",
        "layout_family",
        "season_master_id",
        "owner_member_id",
        "map_master_id",
        "played_at",
        "total_assets_image_id",
        "revenue_image_id",
        "incident_log_image_id",
        "total_assets_draft_id",
        "revenue_draft_id",
        "incident_log_draft_id",
        "source_images_retained_until",
        "source_images_deleted_at",
        "confirmed_match_id",
        "created_at",
        "updated_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"match_drafts is missing columns: $missing (have $cols)")
    }

  test("match_players table exposes the expected rank columns"):
    columnsFor("match_players").map { cols =>
      val expected = Set("match_id", "member_id", "play_order", "rank")
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"match_players is missing columns: $missing (have $cols)")
    }

  test("match_incidents table exists for confirmed match details"):
    columnsFor("match_incidents").map { cols =>
      val expected = Set("match_id", "member_id", "incident_master_id", "count")
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"match_incidents is missing columns: $missing (have $cols)")
    }

  test("series analysis tables expose the revision, control, artifact, and slot boundaries"):
    val expectedTables = Set(
      "series_analysis_title_states",
      "series_analysis_operation_requests",
      "series_analysis_campaigns",
      "series_analysis_campaign_targets",
      "series_analysis_job_requests",
      "series_analysis_jobs",
      "series_analysis_job_attempts",
      "series_analysis_worker_capabilities",
      "series_analysis_reader_capabilities",
      "series_analysis_queue_outbox",
      "series_analysis_artifacts",
      "series_analysis_scope_aggregate_artifacts",
      "series_analysis_scope_review_artifacts",
      "series_analysis_drilldown_artifacts",
      "series_analysis_match_context_artifacts",
      "worker_execution_slots",
    )
    sql"""
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE 'series_analysis_%' OR table_name = 'worker_execution_slots')
    """.query[String].to[List].transact(transactor).map: actual =>
      assertEquals(expectedTables -- actual.toSet, Set.empty[String])

  test("series analysis campaign targets persist the complete accepted version snapshot"):
    columnsFor("series_analysis_campaign_targets").map { columns =>
      val expected = Set(
        "campaign_id",
        "game_title_id",
        "input_revision",
        "algorithm_version",
        "artifact_schema_version",
        "status",
        "job_request_id",
        "accepted_at",
        "updated_at",
      )
      val missing = expected -- columns.toSet
      assert(missing.isEmpty, s"analysis campaign targets are missing columns: $missing")
    }

  test("analysis artifact bytes are exact and reader capabilities are indexed"):
    val constraints = sql"""
      SELECT conname, pg_get_constraintdef(oid)
      FROM pg_constraint
      WHERE conname IN (
        'series_analysis_artifacts_bytes_check',
        'series_analysis_scope_aggregate_artifacts_chunk_check',
        'series_analysis_scope_review_artifacts_chunk_check',
        'series_analysis_drilldown_artifacts_chunk_check',
        'series_analysis_match_context_artifacts_chunk_check'
      )
    """.query[(String, String)].to[List].transact(transactor)
    val indexes = sql"""
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'series_analysis_reader_capabilities'
    """.query[String].to[List].transact(transactor)

    (constraints, indexes).mapN: (rows, indexNames) =>
      assertEquals(rows.map(_._1).toSet.size, 5)
      rows.foreach: (_, definition) =>
        assert(
          definition.contains("decoded_bytes = encoded_bytes"),
          s"decoded byte equality is missing: $definition",
        )
      assert(indexNames.contains("series_analysis_reader_capabilities_heartbeat_idx"))

  test("series analysis trigger functions use a restore-safe search path"):
    sql"""
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'ensure_series_analysis_title_state',
          'validate_series_analysis_artifact_pointers',
          'prevent_series_analysis_artifact_unpublish'
        )
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) setting
          WHERE setting = 'search_path=pg_catalog, public'
        )
    """.query[String].to[Set].transact(transactor).map: functions =>
      assertEquals(
        functions,
        Set(
          "ensure_series_analysis_title_state",
          "validate_series_analysis_artifact_pointers",
          "prevent_series_analysis_artifact_unpublish",
        ),
      )

  test("a game title receives an analysis title state with an empty caller search path"):
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

    program.transact(transactor).map: state =>
      assertEquals(state, (0L, "series-analysis-v1", 1))

  test("analysis scheduling indexes enforce one active title job and deterministic claim order"):
    sql"""
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'series_analysis_jobs_active_title_unique',
          'series_analysis_jobs_claim_idx',
          'series_analysis_jobs_terminal_cleanup_idx'
        )
      ORDER BY indexname
    """.query[(String, String)].to[List].transact(transactor).map: rows =>
      assertEquals(
        rows.map(_._1).toSet,
        Set(
          "series_analysis_jobs_active_title_unique",
          "series_analysis_jobs_claim_idx",
          "series_analysis_jobs_terminal_cleanup_idx",
        )
      )
      val definitions = rows.map(_._2).mkString("\n")
      assert(definitions.contains("queued"))
      assert(definitions.contains("running"))
      assert(definitions.contains("available_at"))
      assert(definitions.contains("requested_at"))

  test("the shared heavy-work slot is present and initially unowned"):
    sql"""
      SELECT slot_key, task_kind, owner, fencing_token
      FROM worker_execution_slots
    """.query[(String, Option[String], Option[String], Long)].unique.transact(transactor).map:
      row => assertEquals(row, ("shared-heavy-work", None, None, 0L))

  test("held_events.session_id is nullable so momo-result can create events"):
    val program = sql"""
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'held_events'
        AND column_name = 'session_id'
    """.query[String].unique.transact(transactor)
    program.map(v => assertEquals(v, "YES"))

  test("ocr_drafts exposes the payload columns used by the API and worker"):
    columnsFor("ocr_drafts").map { cols =>
      val expected = Set(
        "id",
        "job_id",
        "requested_screen_type",
        "detected_screen_type",
        "profile_id",
        "payload_json",
        "warnings_json",
        "timings_ms_json",
        "created_at",
        "updated_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"ocr_drafts is missing columns: $missing (have $cols)")
    }

  test("ocr_jobs exposes the lifecycle columns used by the API and worker repositories"):
    columnsFor("ocr_jobs").map { cols =>
      val expected = Set(
        "id",
        "draft_id",
        "image_id",
        "image_path",
        "requested_screen_type",
        "detected_screen_type",
        "status",
        "attempt_count",
        "worker_id",
        "failure_code",
        "failure_message",
        "failure_retryable",
        "failure_user_action",
        "started_at",
        "finished_at",
        "duration_ms",
        "created_at",
        "updated_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"ocr_jobs is missing columns: $missing (have $cols)")
    }

  test("ocr_queue_outbox exposes the durable OCR enqueue contract"):
    columnsFor("ocr_queue_outbox").map { cols =>
      val expected = Set(
        "id",
        "job_id",
        "dedupe_key",
        "stream_payload",
        "status",
        "attempt_count",
        "last_error",
        "claim_expires_at",
        "next_attempt_at",
        "delivered_at",
        "redis_message_id",
        "created_at",
        "updated_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"ocr_queue_outbox is missing columns: $missing (have $cols)")
    }

  test("ocr_queue_outbox has dispatcher indexes"):
    val program = sql"""
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'ocr_queue_outbox'
        AND indexname IN (
          'uq_ocr_queue_outbox_dedupe_active',
          'idx_ocr_queue_outbox_status_next',
          'idx_ocr_queue_outbox_job_id'
        )
    """.query[String].to[List].transact(transactor)
    program.map { indexes =>
      assertEquals(
        indexes.toSet,
        Set(
          "uq_ocr_queue_outbox_dedupe_active",
          "idx_ocr_queue_outbox_status_next",
          "idx_ocr_queue_outbox_job_id",
        ),
      )
    }

  test("app_sessions tracks the login account separately from the optional player member"):
    columnsFor("app_sessions").map { cols =>
      val expected = Set(
        "id_hash",
        "account_id",
        "member_id",
        "csrf_secret_hash",
        "created_at",
        "last_seen_at",
        "expires_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"app_sessions is missing columns: $missing (have $cols)")
    }

  test("idempotency_keys table exposes the account-scoped columns required by the API"):
    columnsFor("idempotency_keys").map { cols =>
      val expected = Set(
        "key",
        "account_id",
        "member_id",
        "endpoint",
        "request_hash",
        "response_status",
        "response_headers",
        "response_body",
        "created_at",
        "expires_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"idempotency_keys is missing columns: $missing (have $cols)")
    }

  test("idempotency_keys primary key is (key, account_id, endpoint)"):
    val program = sql"""
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public.idempotency_keys'::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    """.query[String].to[List].transact(transactor)
    program.map(cols => assertEquals(cols, List("key", "account_id", "endpoint")))

  test("idempotency_keys has an expires_at index for the cleanup query"):
    val program = sql"""
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'idempotency_keys'
        AND indexname = 'idempotency_keys_expires_at_idx'
    """.query[Int].option.transact(transactor)
    program.map(opt => assert(opt.isDefined, "idempotency_keys_expires_at_idx is missing"))

  test("idempotency_keys has an account/expires_at index for active key limits"):
    val program = sql"""
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'idempotency_keys'
        AND indexname = 'idempotency_keys_account_expires_at_idx'
    """.query[Int].option.transact(transactor)
    program.map(opt => assert(opt.isDefined, "idempotency_keys_account_expires_at_idx is missing"))

end DbContractSpec
