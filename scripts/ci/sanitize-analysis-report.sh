#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <input-json> <output-json>" >&2
  exit 2
fi

input_file="$1"
output_file="$2"
[[ -f "${input_file}" && ! -L "${input_file}" ]] || {
  echo "Analysis report input must be a regular file." >&2
  exit 1
}

jq -e '
  if has("operationId") and has("campaignId") then
    select(
      (.mode == "dry_run" or .mode == "apply") and
      (.trigger | type == "string") and
      (.targetCount | type == "number") and
      (.compatibleReaderCount | type == "number") and
      (.compatibleWorkerCount | type == "number") and
      (.idempotentReplay | type == "boolean")
    ) |
    {
      schemaVersion: 1,
      kind: "promotion",
      mode,
      trigger,
      targetCount,
      compatibleReaderCount,
      compatibleWorkerCount,
      idempotentReplay
    }
  elif has("passed") and has("violations") then
    select(
      (.passed | type == "boolean") and
      (.requireCurrent | type == "boolean") and
      (.requireQuiescent | type == "boolean") and
      (.titleCount | type == "number") and
      (.currentArtifactCount | type == "number") and
      (.activeJobCount | type == "number") and
      (.failedOutboxCount | type == "number") and
      (.compatibleReaderCount | type == "number") and
      (.compatibleWorkerCount | type == "number") and
      (.violations | type == "array" and all(.[]; .code | type == "string"))
    ) |
    {
      schemaVersion: 1,
      kind: "audit",
      passed,
      requireCurrent,
      requireQuiescent,
      titleCount,
      currentArtifactCount,
      activeJobCount,
      failedOutboxCount,
      compatibleReaderCount,
      compatibleWorkerCount,
      violationCodes: [.violations[].code] | unique | sort
    }
  elif has("controlReadOnly") and has("readerReadOnly") and has("redisPong") then
    select(
      (.controlReadOnly | type == "boolean") and
      (.readerReadOnly | type == "boolean") and
      (.redisPong | type == "boolean")
    ) |
    {
      schemaVersion: 1,
      kind: "dependencyProbe",
      controlReadOnly,
      readerReadOnly,
      redisPong
    }
  else
    empty
  end
' "${input_file}" > "${output_file}"

[[ -s "${output_file}" ]] || {
  echo "Analysis report did not match a safe evidence schema." >&2
  exit 1
}
