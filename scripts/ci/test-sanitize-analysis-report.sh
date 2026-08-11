#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sanitizer="${repo_root}/scripts/ci/sanitize-analysis-report.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

jq -n '{
  mode: "apply",
  trigger: "initial_backfill",
  operationId: "private-operation-id",
  campaignId: "private-campaign-id",
  targetCount: 2,
  compatibleReaderCount: 1,
  compatibleWorkerCount: 1,
  idempotentReplay: false
}' > "${test_dir}/promotion.json"
"${sanitizer}" "${test_dir}/promotion.json" "${test_dir}/safe-promotion.json"
jq -e '
  .kind == "promotion" and
  .targetCount == 2 and
  (has("operationId") | not) and
  (has("campaignId") | not)
' "${test_dir}/safe-promotion.json" > /dev/null

jq -n '{
  passed: false,
  requireCurrent: true,
  requireQuiescent: false,
  titleCount: 2,
  currentArtifactCount: 1,
  activeJobCount: 0,
  failedOutboxCount: 0,
  compatibleReaderCount: 1,
  compatibleWorkerCount: 1,
  violations: [{code: "missing_current", gameTitleId: "private-title-id"}]
}' > "${test_dir}/audit.json"
"${sanitizer}" "${test_dir}/audit.json" "${test_dir}/safe-audit.json"
jq -e '
  .kind == "audit" and
  .violationCodes == ["missing_current"] and
  ([paths | map(tostring) | join(".")] | all(. != "gameTitleId"))
' "${test_dir}/safe-audit.json" > /dev/null

printf '%s\n' '{"unknown":"private-value"}' > "${test_dir}/unknown.json"
if "${sanitizer}" "${test_dir}/unknown.json" "${test_dir}/unsafe.json" \
  > /dev/null 2>&1; then
  echo "Unknown analysis evidence schema was accepted." >&2
  exit 1
fi

echo "Analysis report sanitization tests passed."
