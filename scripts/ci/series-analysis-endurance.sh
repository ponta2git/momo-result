#!/usr/bin/env bash
set -euo pipefail

# Private/resource-gate harness for the existing analysis child limit.  This intentionally does
# not change Fly or image memory configuration; it only proves that the current 192 MiB child
# budget remains viable across repeated complete artifact builds.
binary="${1:-}"
database_url="${MOMO_ANALYSIS_READ_DATABASE_URL:-${DATABASE_URL:-}}"
title_id="${ANALYSIS_GAME_TITLE_ID:-}"
external_peak_file="${ANALYSIS_EXTERNAL_RUNTIME_PEAK_FILE:-}"
runs="${ANALYSIS_SHADOW_RUNS:-100}"
child_memory_limit_bytes="${ANALYSIS_CHILD_MEMORY_LIMIT_BYTES:-201326592}"
calculation_timeout_ms="${ANALYSIS_CALCULATION_TIMEOUT_MS:-120000}"
maximum_chunk_bytes="${ANALYSIS_MAXIMUM_CHUNK_BYTES:-8388608}"
maximum_chunk_count="${ANALYSIS_MAXIMUM_CHUNK_COUNT:-4096}"
maximum_total_bytes="${ANALYSIS_MAXIMUM_TOTAL_BYTES:-67108864}"
maximum_file_count="${ANALYSIS_MAXIMUM_FILE_COUNT:-4097}"

if [[ -z "${database_url}" || -z "${title_id}" || -z "${external_peak_file}" ]]; then
  echo "MOMO_ANALYSIS_READ_DATABASE_URL, ANALYSIS_GAME_TITLE_ID, and ANALYSIS_EXTERNAL_RUNTIME_PEAK_FILE are required." >&2
  exit 1
fi
if [[ ! -x "${binary}" ]]; then
  echo "processing worker binary is not executable: ${binary}" >&2
  exit 1
fi
if [[ ! -f "${external_peak_file}" ]]; then
  echo "external runtime peak file does not exist: ${external_peak_file}" >&2
  exit 1
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/momo-analysis-endurance.XXXXXX")"
cleanup() {
  local status=$?
  set +e
  case "${temporary_root}" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
      rm -r -- "${temporary_root}"
      ;;
    *)
      echo "Refusing to clean an unexpected temporary path: ${temporary_root}" >&2
      status=1
      ;;
  esac
  return "${status}"
}
trap cleanup EXIT

MOMO_ANALYSIS_READ_DATABASE_URL="${database_url}" \
MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES="${child_memory_limit_bytes}" \
  "${binary}" shadow-endurance \
    --game-title-id "${title_id}" \
    --runs "${runs}" \
    --child-memory-limit-bytes "${child_memory_limit_bytes}" \
    --calculation-timeout-ms "${calculation_timeout_ms}" \
    --maximum-chunk-bytes "${maximum_chunk_bytes}" \
    --maximum-chunk-count "${maximum_chunk_count}" \
    --maximum-total-bytes "${maximum_total_bytes}" \
    --maximum-file-count "${maximum_file_count}" \
    --temporary-root "${temporary_root}" \
    --external-runtime-peak-file "${external_peak_file}"
