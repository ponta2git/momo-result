#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:?analysis worker image reference is required}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
redis_image="${REDIS_IMAGE:-redis:7-alpine}"
worker_container="momo-analysis-preemption-smoke-worker"
analysis_stream="momo:analysis:preemption-smoke"
analysis_group="momo-analysis-preemption-smoke"
ocr_stream="momo:ocr:v2:preemption-smoke"
ocr_group="momo-ocr-v2-preemption-smoke"
ocr_dead_stream="momo:ocr:v2:preemption-smoke:dead"
analysis_job="ci-preemption-analysis-job"
ocr_job="ci-preemption-ocr-job"
title_id="ci-preemption-title"
run_root="$(mktemp -d "${TMPDIR:-/tmp}/momo-preemption-smoke.XXXXXX")"
worker_log="${run_root}/worker.log"
lock_log="${run_root}/lock.log"
lock_pid=""
worker_pid=""

report_error() {
  local status=$?
  echo "Preemption smoke failed near line ${BASH_LINENO[0]}." >&2
  tail -100 "${worker_log}" >&2 || true
  return "${status}"
}
trap report_error ERR

if [[ -z "${DATABASE_URL:-}" || -z "${REDIS_URL:-}" ]]; then
  echo "DATABASE_URL and REDIS_URL are required." >&2
  exit 1
fi
if [[ -z "${WORKER_DATABASE_URL:-}" || -z "${WORKER_REDIS_URL:-}" ]]; then
  echo "WORKER_DATABASE_URL and WORKER_REDIS_URL are required." >&2
  exit 1
fi

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

redis_ci() {
  if [[ -n "${REDIS_CONTAINER:-}" ]]; then
    docker exec "${REDIS_CONTAINER}" redis-cli --raw "$@"
  else
    docker run --rm --network host "${redis_image}" redis-cli --raw -u "${REDIS_URL}" "$@"
  fi
}

cleanup_database() {
  psql_ci >/dev/null <<'SQL'
SET statement_timeout = '10s';
SET lock_timeout = '5s';
UPDATE worker_execution_slots
SET task_kind = NULL, owner = NULL, job_id = NULL, attempt_id = NULL,
    holder_preemptible = NULL, lease_expires_at = NULL,
    preempt_requested_by = NULL, preempt_requested_at = NULL,
    updated_at = clock_timestamp()
WHERE slot_key = 'shared-heavy-work'
  AND (owner IS NULL OR owner IN ('ci-preemption-analysis-worker','ci-preemption-ocr-worker'));
DELETE FROM ocr_drafts WHERE job_id = 'ci-preemption-ocr-job';
DELETE FROM ocr_jobs WHERE id = 'ci-preemption-ocr-job';
DELETE FROM source_images WHERE id = 'ci-preemption-source-image';
UPDATE series_analysis_title_states
SET current_artifact_id = NULL, previous_artifact_id = NULL
WHERE game_title_id = 'ci-preemption-title';
DELETE FROM series_analysis_artifacts WHERE game_title_id = 'ci-preemption-title';
DELETE FROM series_analysis_jobs WHERE id = 'ci-preemption-analysis-job';
DELETE FROM series_analysis_worker_capabilities
WHERE worker_id = 'ci-preemption-analysis-worker';
DELETE FROM match_incidents WHERE match_id = 'ci-preemption-match';
DELETE FROM match_players WHERE match_id = 'ci-preemption-match';
DELETE FROM matches WHERE id = 'ci-preemption-match';
DELETE FROM held_events WHERE id = 'ci-preemption-event';
DELETE FROM season_masters WHERE id = 'ci-preemption-season';
DELETE FROM map_masters WHERE id = 'ci-preemption-map';
DELETE FROM game_titles WHERE id = 'ci-preemption-title';
SQL
}

release_input_lock() {
  if [[ -n "${lock_pid}" ]]; then
    kill -TERM "${lock_pid}" 2>/dev/null || true
    wait "${lock_pid}" 2>/dev/null || true
  fi
  psql_ci -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'ci-preemption-lock' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  lock_pid=""
}

cleanup() {
  local status=$?
  set +e
  release_input_lock
  if [[ -n "${worker_pid}" ]]; then
    docker stop --timeout 5 "${worker_container}" >/dev/null 2>&1
    wait "${worker_pid}" 2>/dev/null
  fi
  redis_ci DEL "${analysis_stream}" "${ocr_stream}" "${ocr_dead_stream}" >/dev/null 2>&1
  cleanup_database >/dev/null 2>&1
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

fail_with_log() {
  echo "$1" >&2
  tail -100 "${worker_log}" >&2 || true
  exit 1
}

wait_for_log() {
  local fragment="$1"
  local description="$2"
  local attempts=0
  while (( attempts < 200 )); do
    if grep -Fq -- "${fragment}" "${worker_log}"; then
      return 0
    fi
    if [[ -n "${worker_pid}" ]] && ! kill -0 "${worker_pid}" 2>/dev/null; then
      fail_with_log "Worker exited while waiting for ${description}."
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  fail_with_log "Timed out waiting for ${description}."
}

wait_for_sql_value() {
  local expected="$1"
  local query="$2"
  local description="$3"
  local attempts=0
  local actual=""
  while (( attempts < 200 )); do
    actual="$(psql_ci -At -c "${query}")"
    if [[ "${actual}" == "${expected}" ]]; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  fail_with_log "Timed out waiting for ${description}; expected ${expected}, got ${actual}."
}

cleanup_database
redis_ci DEL "${analysis_stream}" "${ocr_stream}" "${ocr_dead_stream}" >/dev/null

slot_owner="$(psql_ci -At -c \
  "SELECT COALESCE(owner, '') FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work';")"
if [[ -n "${slot_owner}" ]]; then
  echo "Shared heavy-work slot is owned by another runtime." >&2
  exit 1
fi

psql_ci >/dev/null <<'SQL'
INSERT INTO game_titles (id, name, layout_family, display_order)
VALUES ('ci-preemption-title', 'Preemption smoke', 'momotetsu2', 9901);
INSERT INTO map_masters (id, game_title_id, name, display_order)
VALUES ('ci-preemption-map', 'ci-preemption-title', 'Preemption map', 1);
INSERT INTO season_masters (id, game_title_id, name, display_order)
VALUES ('ci-preemption-season', 'ci-preemption-title', 'Preemption season', 1);
INSERT INTO held_events (id, session_id, held_date_iso, start_at)
VALUES ('ci-preemption-event', NULL, DATE '2026-08-12', TIMESTAMPTZ '2026-08-12T00:00:00Z');
INSERT INTO matches (
  id, held_event_id, match_no_in_event, game_title_id, layout_family,
  season_master_id, owner_member_id, map_master_id, played_at,
  created_by_member_id, created_by_account_id, analysis_revision
) VALUES (
  'ci-preemption-match', 'ci-preemption-event', 1, 'ci-preemption-title', 'momotetsu2',
  'ci-preemption-season', 'member_ponta', 'ci-preemption-map',
  TIMESTAMPTZ '2026-08-12T00:00:00Z', 'member_ponta', 'account_ponta', 1
);
INSERT INTO match_players (
  match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
) VALUES
  ('ci-preemption-match', 'member_eu', 1, 4, -100, 10),
  ('ci-preemption-match', 'member_ponta', 2, 1, 4000, 800),
  ('ci-preemption-match', 'member_akane_mami', 3, 2, 3000, 600),
  ('ci-preemption-match', 'member_otaka', 4, 3, 2000, 400);
UPDATE series_analysis_title_states
SET input_revision = 1, pending_work = true, algorithm_version = 'series-analysis-v2',
    artifact_schema_version = 1
WHERE game_title_id = 'ci-preemption-title';
INSERT INTO series_analysis_jobs (
  id, game_title_id, input_revision, algorithm_version,
  artifact_schema_version, status, trigger, requested_at, available_at
) VALUES (
  'ci-preemption-analysis-job', 'ci-preemption-title', 1, 'series-analysis-v2',
  1, 'queued', 'manual', clock_timestamp(), clock_timestamp()
);
INSERT INTO source_images (
  id, owner_account_id, object_key, idempotency_key_hash, status,
  media_type, byte_length, sha256_hex, width, height, storage_etag, available_at
) VALUES (
  'ci-preemption-source-image', 'account_ponta',
  'source-images/ci-preemption-source.png', repeat('1', 64), 'AVAILABLE',
  'image/png', 68, repeat('ab', 32), 1, 1, 'ci-preemption-etag', clock_timestamp()
);
INSERT INTO ocr_jobs (
  id, draft_id, image_id, image_path, requested_screen_type,
  status, source_image_id, queue_schema_version, available_at
) VALUES (
  'ci-preemption-ocr-job', 'ci-preemption-draft', 'ci-preemption-source-image', NULL,
  'total_assets', 'queued', 'ci-preemption-source-image', 2, clock_timestamp()
);
SQL

docker run --rm --name "${worker_container}" --privileged --cgroupns private \
  --memory 256m --memory-swap 256m \
  --add-host host.docker.internal:host-gateway \
  --tmpfs /var/lib/momo-analysis:rw,noexec,nosuid,size=67108864,uid=10001,gid=10001,mode=0700 \
  --env "DATABASE_URL=${WORKER_DATABASE_URL}" \
  --env "REDIS_URL=${WORKER_REDIS_URL}" \
  --env MOMO_ANALYSIS_PUBLICATION_MODE=enabled \
  --env MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES=268435456 \
  --env MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES=201326592 \
  --env MOMO_ANALYSIS_PARENT_HEADROOM_BYTES=67108864 \
  --env MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS=30000 \
  --env MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS=1000 \
  --env MOMO_ANALYSIS_TEMPORARY_MAX_BYTES=67108864 \
  --env MOMO_ANALYSIS_CHUNK_MAX_BYTES=8388608 \
  --env MOMO_ANALYSIS_CHUNK_COUNT_MAX=4096 \
  --env MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX=4097 \
  --env "MOMO_ANALYSIS_READ_DATABASE_URL=${WORKER_DATABASE_URL}" \
  --env "MOMO_REDIS_ANALYSIS_STREAM=${analysis_stream}" \
  --env "MOMO_ANALYSIS_REDIS_GROUP=${analysis_group}" \
  --env MOMO_ANALYSIS_WORKER_ID=ci-preemption-analysis-worker \
  --env MOMO_ANALYSIS_TEMPORARY_ROOT=/var/lib/momo-analysis \
  --env MOMO_ANALYSIS_CONFIG_VERSION=ci-preemption-v1 \
  --env MOMO_ANALYSIS_LEASE_DURATION_MS=10000 \
  --env MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS=200 \
  --env MOMO_ANALYSIS_CHILD_STOP_GRACE_MS=1000 \
  --env MOMO_ANALYSIS_REDIS_BLOCK_MS=50 \
  --env MOMO_HEAVY_CGROUP_V2_VALIDATED=true \
  --env MOMO_OCR_V2_CONSUMER_MODE=enabled \
  --env "OCR_REDIS_V2_STREAM=${ocr_stream}" \
  --env "MOMO_OCR_V2_REDIS_GROUP=${ocr_group}" \
  --env "OCR_REDIS_V2_DEAD_LETTER_STREAM=${ocr_dead_stream}" \
  --env MOMO_OCR_V2_WORKER_ID=ci-preemption-ocr-worker \
  --env SOURCE_IMAGE_R2_ENDPOINT=http://127.0.0.1:9 \
  --env SOURCE_IMAGE_R2_BUCKET=ci-preemption \
  --env SOURCE_IMAGE_R2_ACCESS_KEY_ID=ci-access-key \
  --env SOURCE_IMAGE_R2_SECRET_ACCESS_KEY=ci-secret-key \
  --env MOMO_OCR_V2_R2_OPERATION_TIMEOUT_MS=1000 \
  --env MOMO_OCR_V2_R2_ATTEMPT_TIMEOUT_MS=500 \
  --env MOMO_OCR_V2_R2_MAXIMUM_ATTEMPTS=1 \
  --env MOMO_OCR_V2_LEASE_DURATION_MS=5000 \
  --env MOMO_OCR_V2_HEARTBEAT_INTERVAL_MS=200 \
  --env MOMO_OCR_V2_FINALIZATION_TIMEOUT_MS=1000 \
  --env MOMO_OCR_V2_RETRY_DELAY_MS=1000 \
  --env MOMO_OCR_V2_REDIS_BLOCK_MS=50 \
  --env MOMO_OCR_V2_CLAIM_IDLE_MS=15000 \
  --env MOMO_OCR_V2_TIMEOUT_MS=5000 \
  --env MOMO_OCR_V2_MAXIMUM_DELIVERY_ATTEMPTS=2 \
  --env MOMO_OCR_V2_PENDING_SCAN_COUNT=10 \
  --env MOMO_LOG_FORMAT=json \
  --env RUST_LOG=momo_processing_worker=info,momo_analysis=info \
  "${image_ref}" >"${worker_log}" 2>&1 &
worker_pid=$!

wait_for_log '"event":"analysis_worker_ready"' "analysis readiness"
wait_for_log '"event":"ocr_rust_v2_worker_ready"' "OCR readiness"
echo "Combined worker loops are ready."

psql_ci -c \
  "SET application_name = 'ci-preemption-lock'; BEGIN; LOCK TABLE matches IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120);" \
  >"${lock_log}" 2>&1 &
lock_pid=$!
wait_for_sql_value "1" "
  SELECT COUNT(*)::int
  FROM pg_locks lock
  JOIN pg_stat_activity activity ON activity.pid = lock.pid
  WHERE activity.application_name = 'ci-preemption-lock'
    AND lock.relation = 'matches'::regclass
    AND lock.mode = 'AccessExclusiveLock'
    AND lock.granted;
" "the deterministic analysis input lock"
echo "Analysis input lock is held."

redis_ci XADD "${analysis_stream}" '*' schemaVersion 1 jobId "${analysis_job}" >/dev/null
wait_for_sql_value "analysis|ci-preemption-analysis-worker" "
  SELECT task_kind || '|' || owner
  FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work';
" "the running analysis holder"

analysis_child="$(docker exec --user 10001:10001 "${worker_container}" \
  pgrep -f '^/usr/local/bin/momo-analysis child-compute ' | head -1 || true)"
if [[ ! "${analysis_child}" =~ ^[0-9]+$ ]]; then
  fail_with_log "The analysis child was not running behind the held input lock."
fi
echo "Analysis child is blocked inside the bounded process group."

redis_ci XADD "${ocr_stream}" '*' \
  schemaVersion 2 \
  jobId "${ocr_job}" \
  draftId ci-preemption-draft \
  sourceImageId ci-preemption-source-image \
  imageObjectKey source-images/ci-preemption-source.png \
  sha256 "$(printf 'ab%.0s' {1..32})" \
  byteLength 68 \
  mediaType image/png \
  requestedScreenType total_assets \
  attempt 1 \
  enqueuedAt 2026-08-12T00:00:00Z >/dev/null

wait_for_sql_value "queued|1|0|true|1" "
  SELECT job.status || '|' || job.attempt_count || '|' || job.transient_retry_count || '|' ||
         (job.safe_failure_code IS NULL)::text || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'preempted')::text
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.job_id = job.id
  WHERE job.id = 'ci-preemption-analysis-job'
  GROUP BY job.status, job.attempt_count, job.transient_retry_count, job.safe_failure_code;
" "analysis preemption without failure accounting"
wait_for_log '"reason":"preempted"' "the analysis preemption requeue event"
echo "OCR priority preempted and requeued analysis without a failure."

wait_for_sql_value "queued|1|true" "
  SELECT status || '|' || attempt_count || '|' || (failure_code IS NULL)::text
  FROM ocr_jobs WHERE id = 'ci-preemption-ocr-job';
" "the transient R2 failure requeue"
wait_for_sql_value "true" "
  SELECT (owner IS NULL AND preempt_requested_by IS NULL)::text
  FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work';
" "the released shared execution slot"

if docker exec --user 10001:10001 "${worker_container}" \
  pgrep -f '^/usr/local/bin/momo-analysis child-compute ' >/dev/null
then
  fail_with_log "The preempted analysis process group was not reaped."
fi

release_input_lock
redis_ci XADD "${analysis_stream}" '*' schemaVersion 1 jobId "${analysis_job}" >/dev/null
wait_for_sql_value "succeeded|2|1|1" "
  SELECT job.status || '|' || job.attempt_count || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'preempted')::text || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'succeeded')::text
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.job_id = job.id
  WHERE job.id = 'ci-preemption-analysis-job'
  GROUP BY job.status, job.attempt_count;
" "same-cgroup analysis recovery after preemption"

if ! docker inspect --format '{{.State.Running}}' "${worker_container}" | grep -qx true; then
  fail_with_log "The combined processing runtime did not survive child preemption."
fi
if grep -Eq '(postgres|redis)://[^" ]+' "${worker_log}"; then
  fail_with_log "Worker log exposed a database or Redis connection URL."
fi

echo "Combined analysis/OCR preemption smoke passed."
