#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" != 4 ]]; then
  echo "usage: $0 <fly-json-log> <machine-id> <analysis-worker-id> <ocr-worker-id>" >&2
  exit 2
fi

readonly log_file="$1"
readonly machine_id="$2"
readonly analysis_worker_id="$3"
readonly ocr_worker_id="$4"

[[ -s "${log_file}" ]] || exit 1

jq -s -e \
  --arg machineId "${machine_id}" \
  --arg analysisWorkerId "${analysis_worker_id}" \
  --arg ocrWorkerId "${ocr_worker_id}" '
    def app_events:
      map(
        select(
          .instance == $machineId and
          .meta.Event.Provider == "app" and
          (.message | type == "string")
        ) |
        (.message | fromjson?) as $entry |
        select(
          ($entry.fields.event | type == "string") and
          ($entry.fields.worker_id | type == "string")
        ) |
        {
          timestamp,
          event: $entry.fields.event,
          workerId: $entry.fields.worker_id
        }
      );
    def latest($events; $event; $workerId):
      [$events[] | select(.event == $event and .workerId == $workerId)] | last;

    app_events as $events |
    [
      latest($events; "analysis_worker_ready"; $analysisWorkerId),
      latest($events; "ocr_rust_v2_worker_ready"; $ocrWorkerId),
      latest($events; "analysis_outbox_notification_route_ready"; $analysisWorkerId),
      latest($events; "analysis_outbox_ready"; $analysisWorkerId)
    ] as $checks |
    select(all($checks[]; . != null)) |
    {
      schemaVersion: 1,
      machineId: $machineId,
      analysisWorkerId: $analysisWorkerId,
      ocrWorkerId: $ocrWorkerId,
      checks: $checks
    }
  ' "${log_file}"
