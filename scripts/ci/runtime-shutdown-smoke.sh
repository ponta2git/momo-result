#!/usr/bin/env bash
set -euo pipefail

container_name="${RUNTIME_CONTAINER_NAME:-momo-result-runtime}"
stop_timeout="${RUNTIME_STOP_TIMEOUT_SECONDS:-80}"
[[ "${stop_timeout}" =~ ^[1-9][0-9]*$ ]] || {
  echo "RUNTIME_STOP_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 1
}

log_file="$(mktemp)"
message_file="$(mktemp)"
trap 'rm -f "${log_file}" "${message_file}"' EXIT

[[ "$(docker inspect --format '{{.State.Running}}' "${container_name}")" == "true" ]] || {
  echo "Runtime container must be running before the shutdown smoke." >&2
  exit 1
}
docker stop --time "${stop_timeout}" "${container_name}" > /dev/null
exit_code="$(docker inspect "${container_name}" --format '{{.State.ExitCode}}')"
# HotSpot's SIGTERM shutdown hook can finish normally with the signal-derived 143.
# A killed/timed-out JVM (137), startup failure, or missing drain log still fails.
[[ "${exit_code}" == "0" || "${exit_code}" == "143" ]] || {
  echo "Runtime container did not exit cleanly after SIGTERM." >&2
  exit 1
}

docker logs "${container_name}" > "${log_file}" 2>&1
jq -Rr 'fromjson? | .message // empty' "${log_file}" > "${message_file}"

grep -Fxq 'momo_result_api_stopping' "${message_file}" || {
  echo "API did not record a graceful shutdown." >&2
  exit 1
}
echo "API exited cleanly after SIGTERM."
