#!/usr/bin/env bash
set -euo pipefail

if (( $# != 0 )); then
  echo "series-analysis-control-plane-smoke.sh accepts no positional arguments." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=analysis-smoke-safety.sh
source "${repo_root}/scripts/ci/analysis-smoke-safety.sh"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
redis_image="${REDIS_IMAGE:-redis:7-alpine}"
redis_stream="${ANALYSIS_SMOKE_REDIS_STREAM:-}"
redis_group="ci-analysis-worker-v1"
worker_image="${ANALYSIS_WORKER_IMAGE:-}"
worker_container="momo-analysis-control-smoke-worker-$$"
worker_database_url="${WORKER_DATABASE_URL:-${DATABASE_URL:-}}"
worker_redis_url="${WORKER_REDIS_URL:-${REDIS_URL:-}}"
release_database_url="${RELEASE_DATABASE_URL:-${DATABASE_URL:-}}"
publication_contract="${repo_root}/docs/schemas/series-analysis-publication-contract-v1.json"
algorithm_version="${analysis_smoke_algorithm_version}"
artifact_schema_version="$(jq -er '
  .artifactSchemaVersion |
  select(type == "number" and . == floor and . >= 1)
' "${publication_contract}")"
validation_contract_id="$(jq -er '
  .validationContractId |
  select(type == "string" and test("^[a-z0-9][a-z0-9._-]{0,127}$"))
' "${publication_contract}")"
analysis_worker_id="ci-analysis-worker"
analysis_capability_id="${analysis_worker_id}@${algorithm_version}@${artifact_schema_version}@${validation_contract_id}"
release_capability_id="worker-release-smoke@${algorithm_version}@${artifact_schema_version}@${validation_contract_id}"
runtime_memory_limit_bytes="268435456"
child_memory_limit_bytes="201326592"
parent_headroom_bytes="67108864"
temporary_limit_bytes="67108864"

if [[ -z "${DATABASE_URL:-}" || -z "${REDIS_URL:-}" ]]; then
  echo "DATABASE_URL and REDIS_URL are required." >&2
  exit 1
fi

if [[ -z "${worker_image}" ]]; then
  echo "ANALYSIS_WORKER_IMAGE is required." >&2
  exit 1
fi

if [[ ! "${redis_stream}" =~ ^momo:analysis:control-plane-smoke:[a-zA-Z0-9._-]+$ ]]; then
  echo "ANALYSIS_SMOKE_REDIS_STREAM must be an explicit CI-only momo:analysis:control-plane-smoke:* stream." >&2
  exit 1
fi

analysis_smoke_require_isolated_services
analysis_smoke_require_bootstrapped_postgres "${postgres_image}" "${DATABASE_URL}"
analysis_smoke_require_same_postgres_database \
  "${postgres_image}" \
  "${DATABASE_URL}" \
  "WORKER_DATABASE_URL" \
  "${worker_database_url}" \
  "RELEASE_DATABASE_URL" \
  "${release_database_url}"
analysis_smoke_require_same_redis_database \
  "${redis_image}" \
  "${REDIS_URL}" \
  "WORKER_REDIS_URL" \
  "${worker_redis_url}"

run_release_command() {
  docker run --rm --network host --add-host host.docker.internal:host-gateway \
    -e "DATABASE_URL=${release_database_url}" \
    "${worker_image}" \
    /usr/local/bin/momo-processing-worker bootstrap -- "$@"
}

run_root="$(mktemp -d "${TMPDIR:-/tmp}/momo-analysis-control-plane.XXXXXX")"
worker_log="${run_root}/worker.log"
worker_pid=""

report_error() {
  local status=$?
  echo "Series-analysis control-plane smoke failed near line ${BASH_LINENO[0]}." >&2
  tail -100 "${worker_log}" >&2 || true
  return "${status}"
}
trap report_error ERR

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ -n "${worker_pid}" ]]; then
    docker stop --timeout 5 "${worker_container}" >/dev/null 2>&1 || status=1
    wait "${worker_pid}" 2>/dev/null || status=1
  fi
  redis_ci DEL "${redis_stream}" >/dev/null 2>&1 || status=1
  cleanup_database >/dev/null 2>&1 || status=1
  case "${run_root}" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
      rm -r -- "${run_root}" || status=1
      ;;
    *)
      echo "Refusing to clean an unexpected temporary path: ${run_root}" >&2
      status=1
      ;;
  esac
  exit "${status}"
}
trap cleanup EXIT

worker_is_running() {
  [[ "$(docker inspect --format '{{.State.Running}}' "${worker_container}" 2>/dev/null)" == "true" ]]
}

psql_ci() {
  docker run --rm -i --network host \
    --add-host host.docker.internal:host-gateway \
    -e DATABASE_URL="${DATABASE_URL}" \
    "${postgres_image}" \
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"
}

cleanup_database() {
  # The release singleton is the generation under test, not a row-owned fixture. It is left intact
  # until the caller disposes this explicitly isolated PostgreSQL service.
  psql_ci -v analysis_worker_id="${analysis_worker_id}" \
    -v analysis_capability_id="${analysis_capability_id}" \
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
  AND (owner IS NULL OR owner IN (:'analysis_worker_id', 'ci-expired-worker'));
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
  'worker-release-smoke',
  :'release_capability_id',
  :'analysis_worker_id',
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

redis_ci() {
  docker run --rm --network host --add-host host.docker.internal:host-gateway "${redis_image}" \
    redis-cli --raw -u "${REDIS_URL}" "$@"
}

fail_with_worker_log() {
  local message="$1"
  echo "${message}" >&2
  if [[ -f "${worker_log}" ]]; then
    tail -100 "${worker_log}" >&2
  fi
  exit 1
}

assert_worker_log_contains() {
  local fragment="$1"
  local description="$2"
  if ! grep -Fq -- "${fragment}" "${worker_log}"; then
    fail_with_worker_log "Worker log did not contain ${description}."
  fi
}

wait_for_worker_log_contains() {
  local fragment="$1"
  local description="$2"
  local attempts=0
  while (( attempts < 60 )); do
    if grep -Fq -- "${fragment}" "${worker_log}"; then
      return 0
    fi
    if [[ -n "${worker_pid}" ]] && ! worker_is_running; then
      fail_with_worker_log "Worker exited while waiting for ${description}."
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  fail_with_worker_log "Timed out waiting for ${description}."
}

wait_for_sql_value() {
  local expected="$1"
  local query="$2"
  local description="$3"
  local attempts=0
  local actual=""
  while (( attempts < 180 )); do
    actual="$(psql_ci -At -c "${query}")"
    if [[ "${actual}" == "${expected}" ]]; then
      return 0
    fi
    terminal_failures="$(psql_ci -At -c "
      SELECT COUNT(*)::int FROM series_analysis_jobs
      WHERE status IN ('failed','timed_out');
    ")"
    if [[ "${terminal_failures}" != "0" ]]; then
      fail_with_worker_log "A worker job failed while waiting for ${description}."
    fi
    if [[ -n "${worker_pid}" ]] && ! worker_is_running; then
      fail_with_worker_log "Worker exited while waiting for ${description}."
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  fail_with_worker_log "Timed out waiting for ${description}; expected ${expected}, got ${actual}."
}

wait_for_redis_group_lag() {
  local expected="$1"
  local description="$2"
  local attempts=0
  local actual=""
  while (( attempts < 180 )); do
    actual="$(redis_ci XINFO GROUPS "${redis_stream}" | awk '$0 == "lag" { getline; print; exit }')"
    if [[ "${actual}" == "${expected}" ]]; then
      return 0
    fi
    if [[ -n "${worker_pid}" ]] && ! worker_is_running; then
      fail_with_worker_log "Worker exited while waiting for ${description}."
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  fail_with_worker_log "Timed out waiting for ${description}; expected lag ${expected}, got ${actual}."
}

publish_job() {
  local job_id="$1"
  redis_ci XADD "${redis_stream}" '*' schemaVersion 1 jobId "${job_id}" >/dev/null
}

# Recovery and supersede cases need a precise pre-delivery state. Create only the consumer's
# durable input here; campaign expansion and normal outbox dispatch stay owned and exercised by
# the running worker above this fixture boundary.
create_fixture_job_pair() {
  local prefix="$1"
  psql_ci -v job_a="${prefix}-a" -v job_b="${prefix}-b" <<'SQL'
BEGIN;
UPDATE series_analysis_title_states
SET pending_work = true, updated_at = clock_timestamp()
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
INSERT INTO series_analysis_jobs (
  id, game_title_id, input_revision, algorithm_version,
  artifact_schema_version, validation_contract_id,
  status, trigger, requested_at, available_at
)
SELECT
  fixture.job_id,
  state.game_title_id,
  state.input_revision,
  state.algorithm_version,
  state.artifact_schema_version,
  state.validation_contract_id,
  'queued',
  'algorithm_update',
  clock_timestamp(),
  clock_timestamp()
FROM series_analysis_title_states state
JOIN (
  VALUES
    ('title-release-smoke-a', :'job_a'),
    ('title-release-smoke-b', :'job_b')
) AS fixture(game_title_id, job_id) USING (game_title_id);
COMMIT;
SQL
}

worker_environment=(
  "DATABASE_URL=${worker_database_url}"
  "REDIS_URL=${worker_redis_url}"
  "MOMO_ANALYSIS_PUBLICATION_MODE=enabled"
  "MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES=${runtime_memory_limit_bytes}"
  "MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES=${child_memory_limit_bytes}"
  "MOMO_ANALYSIS_PARENT_HEADROOM_BYTES=${parent_headroom_bytes}"
  "MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS=120000"
  "MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS=30000"
  "MOMO_ANALYSIS_TEMPORARY_MAX_BYTES=${temporary_limit_bytes}"
  "MOMO_ANALYSIS_CHUNK_MAX_BYTES=8388608"
  "MOMO_ANALYSIS_CHUNK_COUNT_MAX=4096"
  "MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX=4097"
  "MOMO_ANALYSIS_READ_DATABASE_URL=${worker_database_url}"
  "MOMO_REDIS_ANALYSIS_STREAM=${redis_stream}"
  "MOMO_ANALYSIS_REDIS_GROUP=${redis_group}"
  "MOMO_ANALYSIS_WORKER_ID=${analysis_worker_id}"
  "MOMO_ANALYSIS_TEMPORARY_ROOT=/var/lib/momo-analysis"
  "MOMO_ANALYSIS_CONFIG_VERSION=ci-control-plane-v1"
  "MOMO_ANALYSIS_LEASE_DURATION_MS=60000"
  "MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS=1000"
  "MOMO_ANALYSIS_CHILD_STOP_GRACE_MS=1000"
  "MOMO_ANALYSIS_REDIS_BLOCK_MS=200"
  "MOMO_ANALYSIS_PEL_RECOVERY_INTERVAL_MS=300000"
  "MOMO_OCR_V2_CONSUMER_MODE=disabled"
  "MOMO_LOG_FORMAT=json"
  "RUST_LOG=momo_processing_worker=info"
)

redis_ci DEL "${redis_stream}" >/dev/null

docker_environment=()
for value in "${worker_environment[@]}"; do
  docker_environment+=(--env "${value}")
done
docker run --rm --name "${worker_container}" --privileged --cgroupns private \
  --memory 256m --memory-swap 256m \
  --add-host host.docker.internal:host-gateway \
  --tmpfs /var/lib/momo-analysis:rw,noexec,nosuid,size=${temporary_limit_bytes},uid=10001,gid=10001,mode=0700 \
  --env MOMO_HEAVY_CGROUP_V2_VALIDATED=true \
  "${docker_environment[@]}" \
  "${worker_image}" >"${worker_log}" 2>&1 &
worker_pid=$!

wait_for_sql_value "1" "
  SELECT COUNT(*)::int FROM series_analysis_worker_capabilities
  WHERE worker_id = '${analysis_capability_id}'
    AND algorithm_versions = jsonb_build_array('${algorithm_version}')
    AND artifact_schema_versions = jsonb_build_array(${artifact_schema_version})
    AND validation_contract_ids = jsonb_build_array('${validation_contract_id}')
    AND draining = false;
" "worker capability registration"

wait_for_sql_value "2|0" "
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status IN ('queued','running','failed','timed_out'))::int
  FROM series_analysis_jobs;
" "worker-owned campaign expansion, dispatch, and publication"

contract_propagation_shape="$(psql_ci -At -c "
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (
      WHERE campaign.validation_contract_id IS DISTINCT FROM '${validation_contract_id}'
         OR target.validation_contract_id IS DISTINCT FROM '${validation_contract_id}'
         OR request.validation_contract_id IS DISTINCT FROM target.validation_contract_id
         OR job.validation_contract_id IS DISTINCT FROM '${validation_contract_id}'
    )::int,
    (SELECT COUNT(*)::int FROM series_analysis_queue_outbox WHERE status = 'delivered')
  FROM series_analysis_campaign_targets target
  JOIN series_analysis_campaigns campaign ON campaign.id = target.campaign_id
  JOIN series_analysis_job_requests request ON request.id = target.job_request_id
  JOIN series_analysis_jobs job ON job.id = request.assigned_job_id;
")"
if [[ "${contract_propagation_shape}" != "2|0|2" ]]; then
  fail_with_worker_log \
    "Worker expansion/dispatch lost the campaign contract: ${contract_propagation_shape}"
fi

artifact_shape="$(psql_ci -At -c "
  SELECT
    (SELECT COUNT(*) FROM series_analysis_title_states WHERE current_artifact_id IS NOT NULL),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published'),
    (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_scope_review_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_drilldown_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_match_context_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-b'),
    (SELECT COUNT(*) FROM series_analysis_scope_review_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-b'),
    (SELECT COUNT(*) FROM series_analysis_artifacts
      WHERE status = 'published'
        AND validation_contract_id = '${validation_contract_id}');
")"
if [[ "${artifact_shape}" != "2|2|4|4|64|4|1|1|2" ]]; then
  fail_with_worker_log "Unexpected published artifact shape: ${artifact_shape}"
fi

first_job="$(psql_ci -At -c "SELECT id FROM series_analysis_jobs ORDER BY requested_at, id LIMIT 1;")"
attempts_before="$(psql_ci -At -c "SELECT attempt_count FROM series_analysis_jobs WHERE id = '${first_job}';")"
redis_ci XADD "${redis_stream}" '*' schemaVersion 1 jobId "${first_job}" >/dev/null
wait_for_redis_group_lag "0" "duplicate terminal delivery acknowledgement"

pending_count="$(redis_ci XPENDING "${redis_stream}" "${redis_group}" | sed -n '1p')"
attempts_after="$(psql_ci -At -c "SELECT attempt_count FROM series_analysis_jobs WHERE id = '${first_job}';")"
if [[ "${pending_count}" != "0" || "${attempts_before}" != "${attempts_after}" ]]; then
  fail_with_worker_log "Duplicate delivery was not acknowledged idempotently."
fi

run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key ci-release-reuse \
  --apply >/dev/null
wait_for_sql_value "4|0" "
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status <> 'succeeded')::int
  FROM series_analysis_jobs;
" "checksum reuse jobs"

dispositions="$(psql_ci -At -c "
  SELECT
    COUNT(*) FILTER (WHERE result_disposition = 'published'),
    COUNT(*) FILTER (WHERE result_disposition = 'reused'),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published')
  FROM series_analysis_jobs;
")"
if [[ "${dispositions}" != "2|2|2" ]]; then
  fail_with_worker_log "Unexpected publication/reuse dispositions: ${dispositions}"
fi

create_fixture_job_pair "ci-analysis-lease-recovery"
lease_job="$(psql_ci -At -c "
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-a' AND status = 'queued';
")"
psql_ci -c "
  UPDATE worker_execution_slots
  SET task_kind = 'analysis', owner = 'ci-expired-worker', job_id = '${lease_job}',
      attempt_id = 'ci-expired-attempt', holder_preemptible = true,
      lease_expires_at = clock_timestamp() - interval '1 second',
      fencing_token = fencing_token + 1,
      preempt_requested_by = NULL, preempt_requested_at = NULL,
      updated_at = clock_timestamp()
  WHERE slot_key = 'shared-heavy-work';
  UPDATE series_analysis_jobs
  SET status = 'running', started_at = clock_timestamp() - interval '2 seconds',
      lease_owner = 'ci-expired-worker', lease_attempt_id = 'ci-expired-attempt',
      lease_fencing_token = (
        SELECT fencing_token FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work'
      ),
      lease_expires_at = clock_timestamp() - interval '1 second',
      lease_validation_contract_id = validation_contract_id,
      attempt_count = 1, updated_at = clock_timestamp()
  WHERE id = '${lease_job}';
  INSERT INTO series_analysis_job_attempts (
    id, job_id, attempt_no, owner, fencing_token, input_revision,
    algorithm_version, artifact_schema_version, validation_contract_id, status,
    effective_config_version, calculation_timeout_milliseconds, started_at
  )
  SELECT
    'ci-expired-attempt', id, 1, 'ci-expired-worker', lease_fencing_token,
    input_revision, algorithm_version, artifact_schema_version, validation_contract_id, 'running',
    'ci-expired-config', 120000, clock_timestamp() - interval '2 seconds'
  FROM series_analysis_jobs WHERE id = '${lease_job}';
"
expired_contract_shape="$(psql_ci -At -c "
  SELECT
    job.validation_contract_id,
    job.lease_validation_contract_id,
    attempt.validation_contract_id
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.id = job.lease_attempt_id
  WHERE job.id = '${lease_job}';
")"
expected_expired_contract_shape="${validation_contract_id}|${validation_contract_id}|${validation_contract_id}"
if [[ "${expired_contract_shape}" != "${expected_expired_contract_shape}" ]]; then
  fail_with_worker_log \
    "Expired lease fixture lost validation contract provenance: ${expired_contract_shape}"
fi
publish_job "${lease_job}"
queued_peer="$(psql_ci -At -c "
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-b' AND status = 'queued';
")"
publish_job "${queued_peer}"
wait_for_sql_value "6|0" "
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status <> 'succeeded')::int
  FROM series_analysis_jobs;
" "expired lease recovery jobs"

lease_recovery_shape="$(psql_ci -At -c "
  SELECT
    (SELECT COUNT(*) FROM series_analysis_job_attempts WHERE outcome = 'owner_lost'),
    (SELECT lease_recovery_count FROM series_analysis_jobs WHERE id = '${lease_job}'),
    (SELECT attempt_count FROM series_analysis_jobs WHERE id = '${lease_job}');
")"
if [[ "${lease_recovery_shape}" != "1|1|2" ]]; then
  fail_with_worker_log "Expired lease recovery did not preserve the fencing state machine: ${lease_recovery_shape}"
fi

create_fixture_job_pair "ci-analysis-supersede"
stale_job="$(psql_ci -At -c "
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-a' AND status = 'queued';
")"
peer_job="$(psql_ci -At -c "
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-b' AND status = 'queued';
")"
psql_ci -c "
  UPDATE series_analysis_title_states
  SET input_revision = input_revision + 1, pending_work = true,
      updated_at = clock_timestamp()
  WHERE game_title_id = 'title-release-smoke-a';
"
publish_job "${stale_job}"
# The stale attempt commits a superseding job and its analysis outbox row together. The
# process-local post-commit wake must publish that row without a second manual delivery.
publish_job "${peer_job}"
wait_for_sql_value "8|0" "
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status <> 'succeeded')::int
  FROM series_analysis_jobs;
" "superseded revision jobs"

final_shape="$(psql_ci -At -c "
  SELECT
    (SELECT COUNT(*) FROM series_analysis_job_attempts WHERE outcome = 'superseded'),
    (SELECT COUNT(*) FROM series_analysis_jobs WHERE result_disposition = 'published'),
    (SELECT COUNT(*) FROM series_analysis_jobs WHERE result_disposition = 'reused'),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published'),
    (SELECT a.input_revision FROM series_analysis_artifacts a JOIN series_analysis_title_states s ON s.current_artifact_id = a.id WHERE s.game_title_id = 'title-release-smoke-a');
")"
if [[ "${final_shape}" != "1|3|5|3|1" ]]; then
  fail_with_worker_log "Supersede/publication state was unexpected: ${final_shape}"
fi

attempt_contract_mismatches="$(psql_ci -At -c "
  SELECT COUNT(*)::int
  FROM series_analysis_job_attempts attempt
  JOIN series_analysis_jobs job ON job.id = attempt.job_id
  WHERE attempt.validation_contract_id IS DISTINCT FROM job.validation_contract_id;
")"
if [[ "${attempt_contract_mismatches}" != "0" ]]; then
  fail_with_worker_log \
    "Attempt validation contracts diverged from their claimed jobs: ${attempt_contract_mismatches}"
fi

attempt_metric_shape="$(psql_ci -At -c "
  SELECT
    COUNT(*) FILTER (WHERE outcome = 'succeeded'),
    COUNT(*) FILTER (
      WHERE outcome = 'succeeded'
        AND (
          elapsed_milliseconds IS NULL
          OR calculation_milliseconds IS NULL
          OR staging_milliseconds IS NULL
          OR publication_milliseconds IS NULL
          OR child_peak_bytes IS NULL
          OR worker_peak_bytes IS NULL
          OR elapsed_milliseconds < 0
          OR calculation_milliseconds < 0
          OR staging_milliseconds < 0
          OR publication_milliseconds < 0
          OR child_peak_bytes <= 0
          OR worker_peak_bytes <= 0
          OR elapsed_milliseconds
             <> calculation_milliseconds + staging_milliseconds + publication_milliseconds
        )
    )
  FROM series_analysis_job_attempts;
")"
if [[ "${attempt_metric_shape}" != "8|0" ]]; then
  fail_with_worker_log "Successful attempt timing metrics were incomplete or inconsistent: ${attempt_metric_shape}"
fi

assert_worker_log_contains '"event":"analysis_child_report_accepted"' \
  "an accepted child diagnostic report event"
assert_worker_log_contains '"event":"analysis_attempt_finished"' \
  "a terminal attempt event"
assert_worker_log_contains '"outcome":"succeeded"' \
  "a successful terminal outcome"

correlated_log="$(grep -Fm1 '"event":"analysis_child_report_accepted"' "${worker_log}")"
for required_field in \
  '"delivery_message_id":' \
  '"worker_id":' \
  '"job_id":' \
  '"attempt_id":' \
  '"game_title_id":' \
  '"attempt_no":' \
  '"input_revision":' \
  '"algorithm_version":' \
  '"artifact_schema_version":' \
  '"fencing_token":' \
  '"terminal_phase":' \
  '"child_total_milliseconds":' \
  '"input_milliseconds":' \
  '"kernel_milliseconds":' \
  '"encoding_milliseconds":' \
  '"input_row_count":' \
  '"artifact_chunk_count":' \
  '"artifact_payload_bytes":' \
  '"artifact_temporary_bytes":' \
  '"child_self_peak_bytes":'
do
  if [[ "${correlated_log}" != *"${required_field}"* ]]; then
    fail_with_worker_log "Correlated child diagnostic log omitted ${required_field}"
  fi
done

terminal_log="$(awk '
  index($0, "\"event\":\"analysis_attempt_finished\"") \
    && index($0, "\"outcome\":\"succeeded\"") { print; exit }
' "${worker_log}")"
child_payload_bytes="$(sed -nE 's/.*"artifact_payload_bytes":([0-9]+).*/\1/p' <<<"${correlated_log}")"
child_temporary_bytes="$(sed -nE 's/.*"artifact_temporary_bytes":([0-9]+).*/\1/p' <<<"${correlated_log}")"
terminal_payload_bytes="$(sed -nE 's/.*"artifact_encoded_bytes":([0-9]+).*/\1/p' <<<"${terminal_log}")"
if [[ -z "${child_payload_bytes}" \
  || -z "${child_temporary_bytes}" \
  || -z "${terminal_payload_bytes}" \
  || "${child_payload_bytes}" != "${terminal_payload_bytes}" \
  || "${child_payload_bytes}" -gt "${child_temporary_bytes}" ]]
then
  fail_with_worker_log "Child, validated artifact, and terminal byte metrics were inconsistent."
fi

if grep -Eq '(postgres|redis)://[^" ]+' "${worker_log}"; then
  fail_with_worker_log "Worker log exposed a database or Redis connection URL."
fi

run_release_command release-audit --require-current --require-quiescent >/dev/null

unsupported_job_id="ci-analysis-job-unsupported-version"
psql_ci -c "
  INSERT INTO series_analysis_jobs (
    id, game_title_id, input_revision, algorithm_version,
    artifact_schema_version, validation_contract_id,
    status, trigger, requested_at, available_at
  )
  SELECT
    '${unsupported_job_id}', game_title_id, input_revision, 'series-analysis-v999999',
    artifact_schema_version, validation_contract_id,
    'queued', 'algorithm_update', clock_timestamp(), clock_timestamp()
  FROM series_analysis_title_states
  WHERE game_title_id = 'title-release-smoke-a';
"
publish_job "${unsupported_job_id}"
wait_for_worker_log_contains '"event":"analysis_delivery_deferred"' \
  "unsupported-version delivery diagnostic"

deferred_log="$(grep -F "${unsupported_job_id}" "${worker_log}" \
  | grep -Fm1 '"event":"analysis_delivery_deferred"')"
for required_field in \
  '"reason":"unsupported_version"' \
  '"disposition":"leave_pending"' \
  '"job_algorithm_version":"series-analysis-v999999"' \
  '"supported_algorithm_version":' \
  '"supported_artifact_schema_version":' \
  '"job_validation_contract_id":' \
  '"supported_validation_contract_id":'
do
  if [[ "${deferred_log}" != *"${required_field}"* ]]; then
    fail_with_worker_log "Unsupported-version diagnostic omitted ${required_field}"
  fi
done

unsupported_shape="$(psql_ci -At -c "
  SELECT status, attempt_count, lease_owner IS NULL
  FROM series_analysis_jobs WHERE id = '${unsupported_job_id}';
")"
unsupported_pending="$(redis_ci XPENDING "${redis_stream}" "${redis_group}" | sed -n '1p')"
if [[ "${unsupported_shape}" != "queued|0|t" || "${unsupported_pending}" != "1" ]]; then
  fail_with_worker_log \
    "Unsupported-version delivery was not preserved for a compatible worker: ${unsupported_shape}|${unsupported_pending}"
fi

residue="$(docker exec "${worker_container}" find /var/lib/momo-analysis -mindepth 1 -print -quit)"
if [[ -n "${residue}" ]]; then
  fail_with_worker_log "Worker left temporary attempt data behind."
fi
docker stop --timeout 5 "${worker_container}" >/dev/null
if ! wait "${worker_pid}"; then
  worker_pid=""
  fail_with_worker_log "Worker did not drain cleanly."
fi
worker_pid=""

draining="$(psql_ci -At -c "
  SELECT draining FROM series_analysis_worker_capabilities
  WHERE worker_id = '${analysis_capability_id}';
")"
if [[ "${draining}" != "t" ]]; then
  fail_with_worker_log "Worker capability did not enter draining state."
fi
echo "Series-analysis control-plane smoke passed."
