#!/usr/bin/env bash
set -euo pipefail

binary="${1:?analysis worker binary path is required}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
operation_key="ci-release-control-plane"
algorithm_version="${ANALYSIS_ALGORITHM_VERSION:-series-analysis-v3}"
release_database_url="${RELEASE_DATABASE_URL:-${WORKER_DATABASE_URL:-${DATABASE_URL:-}}}"

if [[ ! "${algorithm_version}" =~ ^series-analysis-v[0-9]+$ ]]; then
  echo "ANALYSIS_ALGORITHM_VERSION must use the series-analysis-vN form." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [[ ! -x "${binary}" ]]; then
  echo "analysis worker binary is not executable: ${binary}" >&2
  exit 1
fi

run_release_command() {
  DATABASE_URL="${release_database_url}" "${binary}" "$@"
}

psql_ci() {
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker exec -i "${POSTGRES_CONTAINER}" \
      psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-momo_result}" \
      -v ON_ERROR_STOP=1 "$@"
  else
    docker run --rm --network host \
      -e DATABASE_URL="${DATABASE_URL}" \
      "${postgres_image}" \
      psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"
  fi
}

psql_ci -c "
  INSERT INTO game_titles (id, name, layout_family, display_order)
  VALUES
    ('title-release-smoke-a', 'Release smoke A', 'momotetsu2', 901),
    ('title-release-smoke-b', 'Release smoke B', 'momotetsu2', 902);
  INSERT INTO map_masters (id, game_title_id, name, display_order)
  VALUES ('map-release-smoke-a', 'title-release-smoke-a', 'Release smoke map', 1);
  INSERT INTO season_masters (id, game_title_id, name, display_order)
  VALUES ('season-release-smoke-a', 'title-release-smoke-a', 'Release smoke season', 1);
  INSERT INTO held_events (id, session_id, held_date_iso, start_at)
  VALUES ('event-release-smoke-a', NULL, DATE '2026-08-09', TIMESTAMPTZ '2026-08-09T00:00:00Z');
  INSERT INTO matches (
    id, held_event_id, match_no_in_event, game_title_id, layout_family,
    season_master_id, owner_member_id, map_master_id, played_at,
    created_by_member_id, created_by_account_id, analysis_revision
  ) VALUES (
    'match-release-smoke-a', 'event-release-smoke-a', 1,
    'title-release-smoke-a', 'momotetsu2', 'season-release-smoke-a',
    'member_ponta', 'map-release-smoke-a', TIMESTAMPTZ '2026-08-09T00:00:00Z',
    'member_ponta', 'account_ponta', 1
  );
  INSERT INTO match_players (
    match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
  ) VALUES
    ('match-release-smoke-a', 'member_eu', 1, 4, -100, 10),
    ('match-release-smoke-a', 'member_ponta', 2, 1, 4000, 800),
    ('match-release-smoke-a', 'member_akane_mami', 3, 2, 3000, 600),
    ('match-release-smoke-a', 'member_otaka', 4, 3, 2000, 400);
  INSERT INTO match_incidents (match_id, member_id, incident_master_id, count)
  VALUES
    ('match-release-smoke-a', 'member_ponta', 'incident_destination', 2),
    ('match-release-smoke-a', 'member_eu', 'incident_suri_no_ginji', 1);
  INSERT INTO series_analysis_reader_capabilities (
    reader_id, artifact_schema_versions
  ) VALUES ('reader-release-smoke', '[1]');
  INSERT INTO series_analysis_worker_capabilities (
    worker_id, algorithm_versions, artifact_schema_versions
  ) VALUES ('worker-release-smoke', jsonb_build_array('${algorithm_version}'), '[1]');
"

dry_run="$(run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}")"
grep -q '"mode":"dry_run"' <<<"${dry_run}"
grep -q '"targetCount":2' <<<"${dry_run}"

dry_counts="$(psql_ci -At -c "
  SELECT
    (SELECT COUNT(*) FROM series_analysis_operation_requests),
    (SELECT COUNT(*) FROM series_analysis_campaigns),
    (SELECT COUNT(*) FROM series_analysis_jobs),
    (SELECT COUNT(*) FROM series_analysis_queue_outbox);
")"
if [[ "${dry_counts}" != "0|0|0|0" ]]; then
  echo "release dry-run changed durable state: ${dry_counts}" >&2
  exit 1
fi

run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}" \
  --apply

replay="$(run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}" \
  --apply)"
grep -q '"idempotentReplay":true' <<<"${replay}"
grep -q '"compatibleReaderCount":1' <<<"${replay}"
grep -q '"compatibleWorkerCount":1' <<<"${replay}"

applied_counts="$(psql_ci -At -c "
  SELECT
    (SELECT COUNT(*) FROM series_analysis_operation_requests),
    (SELECT COUNT(*) FROM series_analysis_campaigns),
    (SELECT COUNT(*) FROM series_analysis_campaign_targets),
    (SELECT COUNT(*) FROM series_analysis_job_requests),
    (SELECT COUNT(*) FROM series_analysis_jobs),
    (SELECT COUNT(*) FROM series_analysis_queue_outbox),
    (SELECT COUNT(*) FROM series_analysis_campaign_targets
      WHERE status = 'pending'
        AND job_request_id IS NULL
        AND algorithm_version = '${algorithm_version}'
        AND artifact_schema_version = 1);
")"
if [[ "${applied_counts}" != "1|1|2|0|0|0|2" ]]; then
  echo "release apply produced an unexpected control-plane shape: ${applied_counts}" >&2
  exit 1
fi

run_release_command release-audit
if run_release_command release-audit --require-current --require-quiescent; then
  echo "strict audit must reject active backfill work." >&2
  exit 1
fi
