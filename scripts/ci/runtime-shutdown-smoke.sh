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

docker stop --time "${stop_timeout}" "${container_name}" > /dev/null
exit_code="$(docker inspect "${container_name}" --format '{{.State.ExitCode}}')"
[[ "${exit_code}" == "0" ]] || {
  echo "Runtime container did not exit cleanly after SIGTERM." >&2
  exit 1
}

docker logs "${container_name}" > "${log_file}" 2>&1
jq -Rr 'fromjson? | .message // empty' "${log_file}" > "${message_file}"

grep -Fxq 'momo_result_api_stopping' "${message_file}" || {
  echo "API did not record a graceful shutdown." >&2
  exit 1
}
if jq -Re 'fromjson? | select(.event == "runtime_serve" and .status == "failed")' \
  "${log_file}" >/dev/null; then
  echo "Go runtime supervisor reported a failed shutdown." >&2
  exit 1
fi

echo "Runtime processes drained cleanly after SIGTERM."
