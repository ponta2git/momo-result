#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sanitizer="${repo_root}/scripts/ci/sanitize-analysis-report.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

jq -n '{schemaVersion:1,status:"attention_required",action:"none",
  reason:"reader_or_worker_incompatible",planDigest:"",targetCount:0,
  completedCount:0,failedCount:0,current:{private:"omit"}}' > "${test_dir}/maintenance.json"
"${sanitizer}" "${test_dir}/maintenance.json" "${test_dir}/safe.json"
jq -e '.kind == "maintenance" and .reason == "reader_or_worker_incompatible" and
  (keys == ["action","completedCount","failedCount","kind","planDigest","reason","schemaVersion","status","targetCount"])' \
  "${test_dir}/safe.json" > /dev/null

reject() {
  if "${sanitizer}" "${test_dir}/invalid.json" "${test_dir}/safe.json" > /dev/null 2>&1; then
    echo "Invalid or obsolete report was accepted: $1" >&2
    exit 1
  fi
  [[ ! -s "${test_dir}/safe.json" ]] || {
    echo "Invalid report left publishable evidence: $1" >&2
    exit 1
  }
}
for field in status reason action; do
  jq --arg field "${field}" '.[$field] = "untrusted-free-text"' "${test_dir}/maintenance.json" > "${test_dir}/invalid.json"
  reject "unknown ${field}"
done
for value in 'null' '[]' '1' '"report"' '{"unknown":"private-value"}' \
  '{"operationId":"private","campaignId":"private","mode":"apply"}' \
  '{"passed":true,"violations":[]}' \
  '{"controlReadOnly":true,"readerReadOnly":true,"redisPong":true}'; do
  printf '%s\n' "${value}" > "${test_dir}/invalid.json"
  reject 'non-maintenance shape'
done
for field in targetCount completedCount failedCount; do
  for value in -1 0.5 null '"1"'; do
    jq --arg field "${field}" --argjson value "${value}" '.[$field] = $value' \
      "${test_dir}/maintenance.json" > "${test_dir}/invalid.json"
    reject "invalid ${field}"
  done
done
jq '.planDigest = ("sha256:" + ("a" * 64))' "${test_dir}/maintenance.json" > "${test_dir}/digest.json"
"${sanitizer}" "${test_dir}/digest.json" "${test_dir}/safe.json"
jq '.planDigest += "\n"' "${test_dir}/digest.json" > "${test_dir}/invalid.json"
reject 'digest trailing newline'
cat "${test_dir}/maintenance.json" "${test_dir}/maintenance.json" > "${test_dir}/invalid.json"
reject 'multiple valid documents'
printf '{}\n' > "${test_dir}/invalid.json"
cat "${test_dir}/maintenance.json" >> "${test_dir}/invalid.json"
reject 'invalid prefix and valid last document'
cat "${test_dir}/maintenance.json" > "${test_dir}/invalid.json"
printf '{broken\n' >> "${test_dir}/invalid.json"
reject 'malformed trailing document'
: > "${test_dir}/invalid.json"
reject 'empty input'
echo "Analysis report sanitization tests passed."
