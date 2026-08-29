#!/usr/bin/env bash
set -euo pipefail

binary="${1:-}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
worker_image="${ANALYSIS_WORKER_IMAGE:-}"
operation_key="ci-release-control-plane"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=analysis-smoke-safety.sh
source "${repo_root}/scripts/ci/analysis-smoke-safety.sh"
algorithm_version="${analysis_smoke_algorithm_version}"
release_database_url="${RELEASE_DATABASE_URL:-${WORKER_DATABASE_URL:-${DATABASE_URL:-}}}"
publication_contract="${repo_root}/docs/schemas/series-analysis-publication-contract-v1.json"
artifact_schema_version="$(jq -er '
  .artifactSchemaVersion |
  select(type == "number" and . == floor and . >= 1)
' "${publication_contract}")"
validation_contract_id="$(jq -er '
  .validationContractId |
  select(type == "string" and test("^[a-z0-9][a-z0-9._-]{0,127}$"))
' "${publication_contract}")"
release_worker_id="worker-release-smoke"
release_capability_id="${release_worker_id}@${algorithm_version}@${artifact_schema_version}@${validation_contract_id}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [[ -z "${worker_image}" && ! -x "${binary}" ]]; then
  echo "analysis worker binary is not executable: ${binary}" >&2
  exit 1
fi

analysis_smoke_require_isolated_services
analysis_smoke_require_bootstrapped_postgres "${postgres_image}" "${DATABASE_URL}"
analysis_smoke_require_same_postgres_database \
  "${postgres_image}" \
  "${DATABASE_URL}" \
  "the release command database URL" \
  "${release_database_url}"

# `release-promote --apply` intentionally leaves the release singleton and generated campaign in
# place for series-analysis-control-plane-smoke.sh. This hand-off is safe only because the caller
# has attested that PostgreSQL is disposable and isolated from every durable environment.

run_release_command() {
  if [[ -n "${worker_image}" ]]; then
    docker run --rm --network host --add-host host.docker.internal:host-gateway \
      -e "DATABASE_URL=${release_database_url}" \
      "${worker_image}" \
      /usr/local/bin/momo-processing-worker bootstrap -- "$@"
  else
    DATABASE_URL="${release_database_url}" "${binary}" "$@"
  fi
}

psql_ci() {
  docker run --rm -i --network host \
    --add-host host.docker.internal:host-gateway \
    -e DATABASE_URL="${DATABASE_URL}" \
    "${postgres_image}" \
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"
}

cleanup_fixture() {
  local analysis_capability_id="ci-analysis-worker@${algorithm_version}@${artifact_schema_version}@${validation_contract_id}"
  psql_ci -v analysis_capability_id="${analysis_capability_id}" \
    -v release_worker_id="${release_worker_id}" \
    -v release_capability_id="${release_capability_id}" >/dev/null <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
UPDATE worker_execution_slots
SET task_kind = NULL, owner = NULL, job_id = NULL, attempt_id = NULL,
    holder_preemptible = NULL, lease_expires_at = NULL,
    preempt_requested_by = NULL, preempt_requested_at = NULL,
    updated_at = clock_timestamp()
WHERE slot_key = 'shared-heavy-work'
  AND (owner IS NULL OR owner = 'ci-analysis-worker');
UPDATE series_analysis_title_states
SET current_artifact_id = NULL, previous_artifact_id = NULL
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_artifacts
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_operation_requests operation
WHERE EXISTS (
  SELECT 1
  FROM series_analysis_campaigns campaign
  JOIN series_analysis_campaign_targets target ON target.campaign_id = campaign.id
  WHERE campaign.operation_request_id = operation.id
    AND target.game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b')
)
OR EXISTS (
  SELECT 1
  FROM series_analysis_job_requests request
  WHERE request.operation_request_id = operation.id
    AND request.game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b')
);
DELETE FROM series_analysis_job_requests
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_jobs
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_reader_capabilities
WHERE reader_id = 'reader-release-smoke';
DELETE FROM series_analysis_worker_capabilities
WHERE worker_id IN (
  :'release_worker_id',
  :'release_capability_id',
  'ci-analysis-worker',
  :'analysis_capability_id'
);
DELETE FROM match_incidents WHERE match_id = 'match-release-smoke-a';
DELETE FROM match_players WHERE match_id = 'match-release-smoke-a';
DELETE FROM matches WHERE id = 'match-release-smoke-a';
DELETE FROM held_events WHERE id = 'event-release-smoke-a';
DELETE FROM season_masters WHERE id = 'season-release-smoke-a';
DELETE FROM map_masters WHERE id = 'map-release-smoke-a';
DELETE FROM game_titles
WHERE id IN ('title-release-smoke-a', 'title-release-smoke-b');
COMMIT;
SQL
}

cleanup_fixture

cleanup_on_failure() {
  local status=$?
  if (( status != 0 )); then
    cleanup_fixture >/dev/null 2>&1 || true
  fi
  return "${status}"
}
trap cleanup_on_failure EXIT

psql_ci -v artifact_schema_version="${artifact_schema_version}" \
  -v algorithm_version="${algorithm_version}" \
  -v validation_contract_id="${validation_contract_id}" \
  -v release_capability_id="${release_capability_id}" <<'SQL'
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
    reader_id, artifact_schema_versions, validation_contract_ids
  ) VALUES (
    'reader-release-smoke',
    jsonb_build_array(:artifact_schema_version),
    jsonb_build_array(:'validation_contract_id')
  );
  INSERT INTO series_analysis_worker_capabilities (
    worker_id, algorithm_versions, artifact_schema_versions
  ) VALUES (
    :'release_capability_id',
    jsonb_build_array(:'algorithm_version'),
    jsonb_build_array(:artifact_schema_version)
  );
SQL

if run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}"; then
  echo "release promotion accepted a worker without a validation contract." >&2
  exit 1
fi

psql_ci -c "
  UPDATE series_analysis_worker_capabilities
  SET validation_contract_ids = '[\"unknown-validation-contract\"]'::jsonb
  WHERE worker_id = '${release_capability_id}';
"
if run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}"; then
  echo "release promotion accepted a worker with an unknown validation contract." >&2
  exit 1
fi

psql_ci -c "
  UPDATE series_analysis_worker_capabilities
  SET validation_contract_ids = jsonb_build_array('${validation_contract_id}')
  WHERE worker_id = '${release_capability_id}';
"

psql_ci -c "
  UPDATE series_analysis_reader_capabilities
  SET validation_contract_ids = '[]'::jsonb
  WHERE reader_id = 'reader-release-smoke';
"
if run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}"; then
  echo "release promotion accepted a reader without a validation contract." >&2
  exit 1
fi

psql_ci -c "
  UPDATE series_analysis_reader_capabilities
  SET validation_contract_ids = '[\"unknown-validation-contract\"]'::jsonb
  WHERE reader_id = 'reader-release-smoke';
"
if run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key "${operation_key}"; then
  echo "release promotion accepted a reader with an unknown validation contract." >&2
  exit 1
fi

psql_ci -c "
  UPDATE series_analysis_reader_capabilities
  SET validation_contract_ids = jsonb_build_array('${validation_contract_id}')
  WHERE reader_id = 'reader-release-smoke';
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
        AND artifact_schema_version = ${artifact_schema_version}
        AND validation_contract_id = '${validation_contract_id}'),
    (SELECT COUNT(*) FROM series_analysis_campaigns
      WHERE validation_contract_id = '${validation_contract_id}'),
    (SELECT COUNT(*) FROM series_analysis_campaign_targets
      WHERE validation_contract_id = '${validation_contract_id}'),
    (SELECT COUNT(*) FROM series_analysis_title_states
      WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b')
        AND validation_contract_id = '${validation_contract_id}');
")"
if [[ "${applied_counts}" != "1|1|2|0|0|0|2|1|2|2" ]]; then
  echo "release apply produced an unexpected control-plane shape: ${applied_counts}" >&2
  exit 1
fi

run_release_command release-audit
if run_release_command release-audit --require-current --require-quiescent; then
  echo "strict audit must reject active backfill work." >&2
  exit 1
fi
