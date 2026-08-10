#!/usr/bin/env bash
set -euo pipefail

binary="${1:?analysis worker binary path is required}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
redis_image="${REDIS_IMAGE:-redis:7-alpine}"
redis_stream="${MOMO_REDIS_ANALYSIS_STREAM:-momo:analysis:jobs}"
redis_group="ci-analysis-worker-v1"
redis_host="${REDIS_HOST:-127.0.0.1}"
redis_port="${REDIS_PORT:-6379}"
worker_image="${ANALYSIS_WORKER_IMAGE:-}"
worker_container="momo-analysis-control-smoke-worker"
worker_database_url="${WORKER_DATABASE_URL:-${DATABASE_URL:-}}"
worker_redis_url="${WORKER_REDIS_URL:-${REDIS_URL:-}}"
release_database_url="${RELEASE_DATABASE_URL:-${DATABASE_URL:-}}"
runtime_memory_limit_bytes="268435456"
child_memory_limit_bytes="134217728"
parent_headroom_bytes="134217728"
temporary_limit_bytes="67108864"

if [[ -z "${DATABASE_URL:-}" || -z "${REDIS_URL:-}" ]]; then
  echo "DATABASE_URL and REDIS_URL are required." >&2
  exit 1
fi

if [[ ! -x "${binary}" ]]; then
  echo "analysis worker binary is not executable: ${binary}" >&2
  exit 1
fi

run_release_command() {
  DATABASE_URL="${release_database_url}" "${binary}" "$@"
}

run_root="$(mktemp -d "${TMPDIR:-/tmp}/momo-analysis-control-plane.XXXXXX")"
worker_temporary_root="${run_root}/attempts"
worker_log="${run_root}/worker.log"
mkdir -p "${worker_temporary_root}"
worker_pid=""

cleanup() {
  local status=$?
  set +e
  if [[ -n "${worker_pid}" ]]; then
    if [[ -n "${worker_image}" ]]; then
      docker stop --timeout 5 "${worker_container}" >/dev/null 2>&1
    elif kill -0 "${worker_pid}" 2>/dev/null; then
      kill -TERM "${worker_pid}" 2>/dev/null
    fi
    wait "${worker_pid}" 2>/dev/null
  fi
  case "${run_root}" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
      rm -r -- "${run_root}"
      ;;
    *)
      echo "Refusing to clean an unexpected temporary path: ${run_root}" >&2
      status=1
      ;;
  esac
  return "${status}"
}
trap cleanup EXIT

worker_is_running() {
  if [[ -n "${worker_image}" ]]; then
    [[ "$(docker inspect --format '{{.State.Running}}' "${worker_container}" 2>/dev/null)" == "true" ]]
  else
    [[ -n "${worker_pid}" ]] && kill -0 "${worker_pid}" 2>/dev/null
  fi
}

psql_ci() {
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker exec -i "${POSTGRES_CONTAINER}" \
      psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-momo_result}" \
      -v ON_ERROR_STOP=1 "$@"
  else
    docker run --rm -i --network host \
      -e DATABASE_URL="${DATABASE_URL}" \
      "${postgres_image}" \
      psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"
  fi
}

# The API dispatcher expansion itself is concurrency-tested by
# PostgresSeriesAnalysisRepositorySpec. This worker smoke deliberately publishes Redis messages
# itself, so it materializes only the durable job/request input that the worker consumes. Keeping
# this fixture explicit prevents the worker CI job from silently depending on the old synchronous
# release-promote behavior.
materialize_pending_campaign_targets() {
  local pending_targets
  psql_ci <<'SQL'
WITH pending_targets AS MATERIALIZED (
  SELECT
    t.campaign_id,
    t.game_title_id,
    t.input_revision AS requested_input_revision,
    t.algorithm_version AS requested_algorithm_version,
    t.artifact_schema_version AS requested_artifact_schema_version,
    t.accepted_at,
    c.operation_request_id,
    c.trigger,
    s.input_revision,
    s.algorithm_version,
    s.artifact_schema_version,
    'ci-analysis-job-' || md5(t.campaign_id || ':' || t.game_title_id) AS job_id,
    'ci-analysis-request-' || md5(t.campaign_id || ':' || t.game_title_id) AS request_id
  FROM series_analysis_campaign_targets t
  JOIN series_analysis_campaigns c ON c.id = t.campaign_id
  JOIN series_analysis_title_states s ON s.game_title_id = t.game_title_id
  WHERE t.status = 'pending'
),
inserted_jobs AS (
  INSERT INTO series_analysis_jobs (
    id, game_title_id, input_revision, algorithm_version,
    artifact_schema_version, status, trigger, requested_at, available_at
  )
  SELECT
    job_id, game_title_id, input_revision, algorithm_version,
    artifact_schema_version, 'queued', trigger, accepted_at, accepted_at
  FROM pending_targets
  RETURNING id
),
inserted_requests AS (
  INSERT INTO series_analysis_job_requests (
    id, game_title_id, operation_request_id, campaign_id,
    input_revision, algorithm_version, artifact_schema_version,
    trigger, force_run, status, assigned_job_id, accepted_at
  )
  SELECT
    target.request_id,
    target.game_title_id,
    target.operation_request_id,
    target.campaign_id,
    target.requested_input_revision,
    target.requested_algorithm_version,
    target.requested_artifact_schema_version,
    target.trigger,
    true,
    'pending',
    target.job_id,
    target.accepted_at
  FROM pending_targets target
  JOIN inserted_jobs job ON job.id = target.job_id
  RETURNING id, campaign_id, game_title_id
),
updated_targets AS (
  UPDATE series_analysis_campaign_targets target
  SET status = 'expanded',
      job_request_id = request.id,
      updated_at = clock_timestamp()
  FROM inserted_requests request
  WHERE target.campaign_id = request.campaign_id
    AND target.game_title_id = request.game_title_id
    AND target.status = 'pending'
  RETURNING target.campaign_id
),
updated_campaigns AS (
  UPDATE series_analysis_campaigns campaign
  SET status = 'running',
      expanded_count = campaign.target_count
  WHERE campaign.id IN (SELECT DISTINCT campaign_id FROM updated_targets)
  RETURNING campaign.operation_request_id
)
UPDATE series_analysis_operation_requests operation
SET status = 'running'
WHERE operation.id IN (SELECT operation_request_id FROM updated_campaigns);
SQL

  pending_targets="$(psql_ci -At -c "
    SELECT COUNT(*)::int
    FROM series_analysis_campaign_targets
    WHERE status = 'pending';
  ")"
  if [[ "${pending_targets}" != "0" ]]; then
    fail_with_worker_log "Worker fixture left ${pending_targets} campaign targets pending."
  fi
}

redis_ci() {
  if [[ -n "${REDIS_CONTAINER:-}" ]]; then
    docker exec "${REDIS_CONTAINER}" redis-cli --raw "$@"
  else
    docker run --rm --network host "${redis_image}" \
      redis-cli --raw -h "${redis_host}" -p "${redis_port}" "$@"
  fi
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

publish_queued_jobs() {
  local jobs
  jobs="$(psql_ci -At -c "
    SELECT id FROM series_analysis_jobs
    WHERE status = 'queued'
    ORDER BY requested_at, id;
  ")"
  if [[ -z "${jobs}" ]]; then
    fail_with_worker_log "No queued analysis jobs were available for delivery."
  fi
  while IFS= read -r job_id; do
    publish_job "${job_id}"
  done <<<"${jobs}"
}

publish_job() {
  local job_id="$1"
  redis_ci XADD "${redis_stream}" '*' schemaVersion 1 jobId "${job_id}" >/dev/null
}

worker_runtime_temporary_root="${worker_temporary_root}"
if [[ -n "${worker_image}" ]]; then
  worker_runtime_temporary_root="/var/lib/momo-analysis"
fi
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
  "MOMO_ANALYSIS_WORKER_ID=ci-analysis-worker"
  "MOMO_ANALYSIS_TEMPORARY_ROOT=${worker_runtime_temporary_root}"
  "MOMO_ANALYSIS_CONFIG_VERSION=ci-control-plane-v1"
  "MOMO_ANALYSIS_LEASE_DURATION_MS=60000"
  "MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS=1000"
  "MOMO_ANALYSIS_CHILD_STOP_GRACE_MS=1000"
  "MOMO_ANALYSIS_REDIS_BLOCK_MS=200"
  "MOMO_LOG_FORMAT=json"
  "RUST_LOG=momo_analysis=info"
)

if [[ -n "${worker_image}" ]]; then
  docker_environment=()
  for value in "${worker_environment[@]}"; do
    docker_environment+=(--env "${value}")
  done
  docker run --rm --name "${worker_container}" \
    --memory 256m --memory-swap 256m \
    --add-host host.docker.internal:host-gateway \
    --tmpfs /var/lib/momo-analysis:rw,noexec,nosuid,size=${temporary_limit_bytes},uid=10001,gid=10001,mode=0700 \
    "${docker_environment[@]}" \
    "${worker_image}" >"${worker_log}" 2>&1 &
else
  env "${worker_environment[@]}" "${binary}" worker >"${worker_log}" 2>&1 &
fi
worker_pid=$!

wait_for_sql_value "1" "
  SELECT COUNT(*)::int FROM series_analysis_worker_capabilities
  WHERE worker_id = 'ci-analysis-worker' AND draining = false;
" "worker capability registration"

materialize_pending_campaign_targets
publish_queued_jobs
wait_for_sql_value "2|0" "
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status IN ('queued','running','failed','timed_out'))::int
  FROM series_analysis_jobs;
" "initial jobs to publish"

artifact_shape="$(psql_ci -At -c "
  SELECT
    (SELECT COUNT(*) FROM series_analysis_title_states WHERE current_artifact_id IS NOT NULL),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published'),
    (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_scope_review_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_drilldown_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_match_context_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-b'),
    (SELECT COUNT(*) FROM series_analysis_scope_review_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-b');
")"
if [[ "${artifact_shape}" != "2|2|4|4|64|4|1|1" ]]; then
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
materialize_pending_campaign_targets
publish_queued_jobs
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

run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key ci-release-lease-recovery \
  --apply >/dev/null
materialize_pending_campaign_targets
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
      attempt_count = 1, updated_at = clock_timestamp()
  WHERE id = '${lease_job}';
  INSERT INTO series_analysis_job_attempts (
    id, job_id, attempt_no, owner, fencing_token, input_revision,
    algorithm_version, artifact_schema_version, status,
    effective_config_version, calculation_timeout_milliseconds, started_at
  )
  SELECT
    'ci-expired-attempt', id, 1, 'ci-expired-worker', lease_fencing_token,
    input_revision, algorithm_version, artifact_schema_version, 'running',
    'ci-expired-config', 120000, clock_timestamp() - interval '2 seconds'
  FROM series_analysis_jobs WHERE id = '${lease_job}';
  UPDATE series_analysis_job_requests
  SET status = 'assigned', assigned_attempt_id = 'ci-expired-attempt'
  WHERE assigned_job_id = '${lease_job}';
  UPDATE series_analysis_campaign_targets t
  SET status = 'running', updated_at = clock_timestamp()
  FROM series_analysis_job_requests r
  WHERE t.job_request_id = r.id AND r.assigned_job_id = '${lease_job}';
"
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

run_release_command release-promote \
  --trigger algorithm-update \
  --operation-key ci-release-supersede \
  --apply >/dev/null
materialize_pending_campaign_targets
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
wait_for_sql_value "1|queued|1" "
  SELECT input_revision, status, attempt_count
  FROM series_analysis_jobs WHERE id = '${stale_job}';
" "stale input revision detection"
publish_job "${stale_job}"
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
    artifact_schema_version, status, trigger, requested_at, available_at
  )
  SELECT
    '${unsupported_job_id}', game_title_id, input_revision, 'series-analysis-v999999',
    artifact_schema_version, 'queued', 'algorithm_update', clock_timestamp(), clock_timestamp()
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
  '"supported_artifact_schema_version":'
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

if [[ -n "${worker_image}" ]]; then
  residue="$(docker exec "${worker_container}" find /var/lib/momo-analysis -mindepth 1 -print -quit)"
  if [[ -n "${residue}" ]]; then
    fail_with_worker_log "Worker left temporary attempt data behind."
  fi
  docker stop --timeout 5 "${worker_container}" >/dev/null
else
  kill -TERM "${worker_pid}"
fi
if ! wait "${worker_pid}"; then
  worker_pid=""
  fail_with_worker_log "Worker did not drain cleanly."
fi
worker_pid=""

draining="$(psql_ci -At -c "
  SELECT draining FROM series_analysis_worker_capabilities
  WHERE worker_id = 'ci-analysis-worker';
")"
if [[ "${draining}" != "t" ]]; then
  fail_with_worker_log "Worker capability did not enter draining state."
fi
if [[ -z "${worker_image}" ]] && find "${worker_temporary_root}" -mindepth 1 -print -quit | grep -q .; then
  fail_with_worker_log "Worker left temporary attempt data behind."
fi

echo "Analysis worker control-plane smoke passed."
