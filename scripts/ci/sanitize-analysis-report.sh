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

# Maintenance is the only published report. The caller selects it from CLI logs;
# reject streams and obsolete report shapes rather than copying free-form values.
jq -es '
  select(length == 1) | .[0] | select(type == "object") |
  select(.schemaVersion == 1 and
      (.status | IN("planned", "running", "complete", "not_needed", "attention_required")) and
      (.action | IN("none", "resume", "algorithm_update", "artifact_schema_update", "validation_contract_update", "initial_backfill")) and
      (.reason | IN("already_current", "existing_operation", "release_integrity_audit_failed", "applied_operation_has_a_different_current_release", "promote_before_backfill", "previous_generation_requires_explicit_recovery", "release_update_required", "reader_or_worker_incompatible", "plan_changed_run_check_again", "operation_accepted", "current_generation_operations")) and
      (.planDigest | type == "string" and (. == "" or test("\\Asha256:[0-9a-f]{64}\\z"))) and
      ([.targetCount, .completedCount, .failedCount] | all(.[]; type == "number" and . >= 0 and floor == .))) |
    {schemaVersion: 1, kind: "maintenance", status, action, reason, planDigest,
      targetCount, completedCount, failedCount}
' "${input_file}" > "${output_file}"
