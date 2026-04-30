package momo.api.integration

import cats.effect.IO
import doobie.implicits.*

/**
 * Lightweight smoke test that the local Postgres exposes the columns and seeded rows the API
 * expects. If this fails, the migrations in `momo-db` have drifted from the API's contract.
 */
final class DbContractSpec extends IntegrationSuite:

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

  test("matches table exposes the expected columns"):
    val program = sql"""
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'matches'
      ORDER BY ordinal_position
    """.query[String].to[List].transact(transactor)
    program.map { cols =>
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
        "created_by_member_id",
        "created_at",
        "updated_at",
      )
      val missing = expected -- cols.toSet
      assert(missing.isEmpty, s"matches is missing columns: $missing (have $cols)")
    }

  test("held_events.session_id is nullable so momo-result can create events"):
    val program = sql"""
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'held_events'
        AND column_name = 'session_id'
    """.query[String].unique.transact(transactor)
    program.map(v => assertEquals(v, "YES"))

  test("ocr_jobs has the failure_* triplet used by the PostgreSQL job repository"):
    val program = sql"""
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ocr_jobs'
        AND column_name IN ('failure_code','failure_message','failure_retryable','failure_user_action')
    """.query[String].to[List].transact(transactor)
    program.map { cols =>
      assertEquals(
        cols.toSet,
        Set("failure_code", "failure_message", "failure_retryable", "failure_user_action"),
      )
    }
end DbContractSpec
