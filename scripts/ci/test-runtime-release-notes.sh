#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
renderer="${repo_root}/scripts/ci/runtime-release-notes.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

repository=ponta2git/momo-result
commit=0123456789abcdef0123456789abcdef01234567
run_url="https://github.com/${repository}/actions/runs/123"

write_fixture() {
  local base_ref="$1"
  local head_ref="$2"
  local head_repository="$3"
  local merged_at="$4"
  local merge_commit="$5"
  local body="$6"
  jq -n \
    --arg base "${base_ref}" \
    --arg body "${body}" \
    --arg head "${head_ref}" \
    --arg headRepository "${head_repository}" \
    --arg mergedAt "${merged_at}" \
    --arg mergeCommit "${merge_commit}" \
    '[{
      number: 42,
      body: $body,
      merged_at: (if $mergedAt == "null" then null else $mergedAt end),
      merge_commit_sha: $mergeCommit,
      base: {ref: $base},
      head: {ref: $head, repo: {full_name: $headRepository}}
    }]' > "${test_root}/prs.json"
}

write_fixture master release/20260830-1 "${repository}" 2026-08-30T00:00:00Z \
  "${commit}" $'## Release notes\n\n- Safe note with `$(not executed)`.\n\n## Verification\n\nPassed.'
metadata="$(${renderer} "${test_root}/prs.json" "${repository}" "${commit}" \
  "${run_url}" "${test_root}/notes.md")"
[[ "${metadata}" == "pull_request_number=42" ]]
grep -Fq -- '- Safe note with `$(not executed)`.' "${test_root}/notes.md"
grep -Fq -- "Release PR: [#42](https://github.com/${repository}/pull/42)" \
  "${test_root}/notes.md"
grep -Fq -- "Commit: \`${commit}\`" "${test_root}/notes.md"

assert_rejected() {
  local name="$1"
  if "${renderer}" "${test_root}/prs.json" "${repository}" "${commit}" \
    "${run_url}" "${test_root}/notes.md" >/dev/null 2>&1; then
    echo "Expected runtime release notes fixture to be rejected: ${name}" >&2
    exit 1
  fi
}

write_fixture develop release/20260830-1 "${repository}" 2026-08-30T00:00:00Z \
  "${commit}" $'## Release notes\n\n- Note.'
assert_rejected wrong-base
write_fixture master feat/not-release "${repository}" 2026-08-30T00:00:00Z \
  "${commit}" $'## Release notes\n\n- Note.'
assert_rejected wrong-head
write_fixture master release/20260830-1 fork/momo-result 2026-08-30T00:00:00Z \
  "${commit}" $'## Release notes\n\n- Note.'
assert_rejected fork
write_fixture master release/20260830-1 "${repository}" null \
  "${commit}" $'## Release notes\n\n- Note.'
assert_rejected unmerged
write_fixture master release/20260830-1 "${repository}" 2026-08-30T00:00:00Z \
  ffffffffffffffffffffffffffffffffffffffff $'## Release notes\n\n- Note.'
assert_rejected wrong-commit
write_fixture master release/20260830-1 "${repository}" 2026-08-30T00:00:00Z \
  "${commit}" $'## Release notes\n\nN/A'
assert_rejected placeholder-notes
write_fixture master release/20260830-1 "${repository}" 2026-08-30T00:00:00Z \
  "${commit}" $'## Release notes\n\n- Note.'
jq '.[0] as $candidate | . + [$candidate | .number = 43]' \
  "${test_root}/prs.json" > "${test_root}/duplicate-prs.json"
mv "${test_root}/duplicate-prs.json" "${test_root}/prs.json"
assert_rejected multiple-candidates

echo "Runtime release notes tests passed."
