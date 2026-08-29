#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="${repo_root}/scripts/ci/validate-analysis-worker-readiness.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly machine_id=machine-current
readonly analysis_worker_id=analysis-current
readonly ocr_worker_id=ocr-current
readonly log_file="${test_dir}/fly.json"

write_log() {
  local include_outbox="${1:-true}"
  local include_notification_route="${2:-true}"
  jq -nc \
    --arg machineId "${machine_id}" \
    --arg analysisWorkerId "${analysis_worker_id}" \
    --arg ocrWorkerId "${ocr_worker_id}" \
    --arg includeOutbox "${include_outbox}" \
    --arg includeNotificationRoute "${include_notification_route}" '
      def outer($machine; $provider; $timestamp; $message): {
        instance: $machine,
        timestamp: $timestamp,
        message: $message,
        meta: {Event: {Provider: $provider}}
      };
      def app($event; $worker): {
        timestamp: "2026-08-24T12:00:00Z",
        level: "INFO",
        fields: {event: $event, worker_id: $worker}
      };
      outer($machineId; "runner"; "2026-08-24T11:59:58Z"; "Machine started"),
      outer($machineId; "app"; "2026-08-24T11:59:59Z"; "not-json"),
      outer("machine-old"; "app"; "2026-08-24T12:00:00Z";
        (app("analysis_worker_ready"; $analysisWorkerId) | tojson)),
      outer($machineId; "app"; "2026-08-24T12:00:01Z";
        (app("analysis_worker_ready"; $analysisWorkerId) | tojson)),
      outer($machineId; "app"; "2026-08-24T12:00:02Z";
        (app("ocr_rust_v2_worker_ready"; $ocrWorkerId) | tojson)),
      if $includeNotificationRoute == "true" then
        outer($machineId; "app"; "2026-08-24T12:00:03Z";
          (app("analysis_outbox_notification_route_ready"; $analysisWorkerId) | tojson))
      else empty end,
      if $includeOutbox == "true" then
        outer($machineId; "app"; "2026-08-24T12:00:04Z";
          (app("analysis_outbox_ready"; $analysisWorkerId) | tojson))
      else empty end
    ' > "${log_file}"
}

expect_rejected() {
  local name="$1"
  shift
  if "${validator}" "$@" > /dev/null 2>&1; then
    echo "Invalid readiness evidence was accepted: ${name}" >&2
    exit 1
  fi
}

write_log
actual="$(
  "${validator}" "${log_file}" "${machine_id}" "${analysis_worker_id}" "${ocr_worker_id}"
)"
jq -e \
  --arg machineId "${machine_id}" \
  --arg analysisWorkerId "${analysis_worker_id}" \
  --arg ocrWorkerId "${ocr_worker_id}" '
    .schemaVersion == 1 and
    .machineId == $machineId and
    .analysisWorkerId == $analysisWorkerId and
    .ocrWorkerId == $ocrWorkerId and
    (.checks | map(.event)) == [
      "analysis_worker_ready",
      "ocr_rust_v2_worker_ready",
      "analysis_outbox_notification_route_ready",
      "analysis_outbox_ready"
    ]
  ' <<< "${actual}" > /dev/null

expect_rejected wrong-machine \
  "${log_file}" machine-wrong "${analysis_worker_id}" "${ocr_worker_id}"
expect_rejected stale-analysis-worker \
  "${log_file}" "${machine_id}" analysis-old "${ocr_worker_id}"
expect_rejected stale-ocr-worker \
  "${log_file}" "${machine_id}" "${analysis_worker_id}" ocr-old

write_log false
expect_rejected missing-outbox \
  "${log_file}" "${machine_id}" "${analysis_worker_id}" "${ocr_worker_id}"

write_log true false
expect_rejected missing-notification-route \
  "${log_file}" "${machine_id}" "${analysis_worker_id}" "${ocr_worker_id}"

echo "Analysis worker readiness evidence tests passed."
