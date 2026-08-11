#!/opt/momo-result/ocr-worker/.venv/bin/python
from __future__ import annotations

import json
import os
import sys
from collections.abc import Iterable

REQUIRED_COLUMNS = frozenset(
    {
        ("app_sessions", "account_id"),
        ("app_sessions", "csrf_secret_hash"),
        ("app_sessions", "expires_at"),
        ("app_sessions", "id_hash"),
        ("game_titles", "id"),
        ("held_event_participants", "held_event_id"),
        ("held_event_participants", "member_id"),
        ("held_events", "id"),
        ("held_events", "session_id"),
        ("idempotency_keys", "account_id"),
        ("idempotency_keys", "endpoint"),
        ("idempotency_keys", "expires_at"),
        ("idempotency_keys", "key"),
        ("match_drafts", "confirmed_match_id"),
        ("match_drafts", "created_by_account_id"),
        ("match_drafts", "id"),
        ("match_drafts", "source_images_deleted_at"),
        ("match_drafts", "source_images_retained_until"),
        ("match_incidents", "match_id"),
        ("match_players", "match_id"),
        ("matches", "analysis_revision"),
        ("matches", "created_by_account_id"),
        ("matches", "id"),
        ("member_aliases", "alias"),
        ("member_aliases", "member_id"),
        ("members", "display_name"),
        ("members", "id"),
        ("momo_login_accounts", "id"),
        ("momo_login_accounts", "login_enabled"),
        ("momo_login_accounts", "player_member_id"),
        ("ocr_drafts", "job_id"),
        ("ocr_drafts", "payload_json"),
        ("ocr_jobs", "attempt_count"),
        ("ocr_jobs", "id"),
        ("ocr_jobs", "status"),
        ("ocr_queue_outbox", "dedupe_key"),
        ("ocr_queue_outbox", "job_id"),
        ("ocr_queue_outbox", "next_attempt_at"),
        ("ocr_queue_outbox", "status"),
        ("series_analysis_artifacts", "artifact_schema_version"),
        ("series_analysis_artifacts", "id"),
        ("series_analysis_campaign_targets", "artifact_schema_version"),
        ("series_analysis_jobs", "lease_fencing_token"),
        ("series_analysis_jobs", "status"),
        ("series_analysis_queue_outbox", "schema_version"),
        ("series_analysis_reader_capabilities", "artifact_schema_versions"),
        ("series_analysis_title_states", "current_artifact_id"),
        ("series_analysis_title_states", "input_revision"),
        ("series_analysis_worker_capabilities", "algorithm_versions"),
        ("worker_execution_slots", "fencing_token"),
        ("worker_execution_slots", "slot_key"),
    }
)

REQUIRED_TABLES = frozenset(
    {
        "incident_masters",
        "map_masters",
        "season_masters",
        "series_analysis_campaigns",
        "series_analysis_drilldown_artifacts",
        "series_analysis_job_attempts",
        "series_analysis_job_requests",
        "series_analysis_match_context_artifacts",
        "series_analysis_operation_requests",
        "series_analysis_scope_aggregate_artifacts",
        "series_analysis_scope_review_artifacts",
    }
)

REQUIRED_INDEXES = frozenset(
    {
        "idempotency_keys_account_expires_at_idx",
        "idempotency_keys_expires_at_idx",
        "idx_ocr_queue_outbox_status_next",
        "series_analysis_jobs_active_title_unique",
        "series_analysis_jobs_claim_idx",
        "uq_ocr_queue_outbox_dedupe_active",
    }
)

REQUIRED_FUNCTIONS = frozenset(
    {
        "ensure_series_analysis_title_state",
        "prevent_series_analysis_artifact_unpublish",
        "validate_series_analysis_artifact_pointers",
    }
)

REQUIRED_MEMBER_IDS = frozenset({"member_akane_mami", "member_eu", "member_otaka", "member_ponta"})


def missing_contract(
    *,
    columns: Iterable[tuple[str, str]],
    tables: Iterable[str],
    indexes: Iterable[str],
    hardened_functions: Iterable[str],
    member_ids: Iterable[str],
) -> dict[str, list[str]]:
    actual_columns = set(columns)
    return {
        "columns": sorted(
            f"{table}.{column}" for table, column in REQUIRED_COLUMNS - actual_columns
        ),
        "tables": sorted(REQUIRED_TABLES - set(tables)),
        "indexes": sorted(REQUIRED_INDEXES - set(indexes)),
        "functions": sorted(REQUIRED_FUNCTIONS - set(hardened_functions)),
        "seedMembers": sorted(REQUIRED_MEMBER_IDS - set(member_ids)),
    }


def _inspect_contract(connection: object) -> dict[str, list[str]]:
    with connection.cursor() as cursor:  # type: ignore[attr-defined]
        cursor.execute("SET TRANSACTION READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = 10000")
        cursor.execute("SET LOCAL lock_timeout = 3000")
        cursor.execute(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public'"
        )
        columns = cursor.fetchall()
        cursor.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        )
        tables = (row[0] for row in cursor.fetchall())
        cursor.execute("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
        indexes = (row[0] for row in cursor.fetchall())
        cursor.execute(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public' AND EXISTS ("
            "SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) setting "
            "WHERE setting = 'search_path=pg_catalog, public')"
        )
        functions = (row[0] for row in cursor.fetchall())
        cursor.execute("SELECT id FROM members")
        member_ids = (row[0] for row in cursor.fetchall())
        return missing_contract(
            columns=columns,
            tables=tables,
            indexes=indexes,
            hardened_functions=functions,
            member_ids=member_ids,
        )


def main() -> int:
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        _write_failure("MissingDatabaseUrl")
        return 1

    try:
        import psycopg  # noqa: PLC0415 - only the packaged runtime owns this dependency.

        with psycopg.connect(
            database_url,
            connect_timeout=10,
            application_name="momo-result-release-preflight",
        ) as connection:
            missing = _inspect_contract(connection)
    except Exception as error:  # noqa: BLE001 - emit only the safe exception class at this boundary.
        _write_failure(type(error).__name__)
        return 1
    missing_counts = {key: len(value) for key, value in missing.items()}
    if any(missing_counts.values()):
        _write_json(
            {
                "event": "runtime_release_preflight",
                "status": "failed",
                "missingCounts": missing_counts,
            },
            stream=sys.stderr,
        )
        return 1
    _write_json(
        {
            "event": "runtime_release_preflight",
            "status": "ok",
            "contractChecks": sum(
                (
                    len(REQUIRED_COLUMNS),
                    len(REQUIRED_TABLES),
                    len(REQUIRED_INDEXES),
                    len(REQUIRED_FUNCTIONS),
                    len(REQUIRED_MEMBER_IDS),
                )
            ),
        },
        stream=sys.stdout,
    )
    return 0


def _write_failure(error_class: str) -> None:
    safe_class = error_class if error_class.replace("_", "").isalnum() else "UnknownError"
    _write_json(
        {
            "event": "runtime_release_preflight",
            "status": "failed",
            "errorClass": safe_class,
        },
        stream=sys.stderr,
    )


def _write_json(payload: dict[str, object], *, stream: object) -> None:
    stream.write(json.dumps(payload, separators=(",", ":"), sort_keys=True))  # type: ignore[attr-defined]
    stream.write("\n")  # type: ignore[attr-defined]


if __name__ == "__main__":
    raise SystemExit(main())
