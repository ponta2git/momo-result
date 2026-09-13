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
  if has("planDigest") then
    select(.schemaVersion == 1 and
      (.status | IN("planned", "running", "complete", "not_needed", "attention_required")) and
      (.action | IN("none", "resume", "algorithm_update", "artifact_schema_update", "validation_contract_update", "initial_backfill")) and
      (.reason | IN("already_current", "existing_operation", "release_integrity_audit_failed", "applied_operation_has_a_different_current_release", "promote_before_backfill", "previous_generation_requires_explicit_recovery", "release_update_required", "reader_or_worker_incompatible", "plan_changed_run_check_again", "operation_accepted", "current_generation_operations")) and
      (.planDigest | type == "string" and (. == "" or test("^sha256:[0-9a-f]{64}$"))) and
      ([.targetCount, .completedCount, .failedCount] | all(.[]; type == "number" and . >= 0 and floor == .))) |
    {schemaVersion: 1, kind: "maintenance", status, action, reason, planDigest,
      targetCount, completedCount, failedCount}
  elif has("operationId") and has("campaignId") then
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
