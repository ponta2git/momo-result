#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
extractor="${repo_root}/scripts/ci/extract-release-notes.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

assert_rejected() {
  local name="$1"
  local body="$2"
  printf '%s' "${body}" > "${test_root}/body.md"
  if "${extractor}" "${test_root}/body.md" "${test_root}/notes.md" >/dev/null 2>&1; then
    echo "Expected release notes fixture to be rejected: ${name}" >&2
    exit 1
  fi
}

cat > "${test_root}/body.md" <<'EOF'
## Summary

Ship the approved changes.

## Release notes

- Add the first visible improvement.
- Fix the second visible problem.

## Verification

- CI passed.
EOF
"${extractor}" "${test_root}/body.md" "${test_root}/notes.md"
expected=$'- Add the first visible improvement.\n- Fix the second visible problem.'
actual="$(< "${test_root}/notes.md")"
if [[ "${actual}" != "${expected}" ]]; then
  echo "Release notes were not extracted exactly." >&2
  diff -u <(printf '%s\n' "${expected}") <(printf '%s\n' "${actual}") >&2 || true
  exit 1
fi

assert_rejected missing $'## Summary\n\nNo release section.\n'
assert_rejected empty $'## Release notes\n\n## Verification\n\nPassed.\n'
assert_rejected placeholder $'## Release notes\n\nN/A\n'
assert_rejected formatted-placeholder $'## Release notes\n\n- **N/A**\n- `None`\n'
assert_rejected hidden-description $'## Release notes\n\n<!--\nWrite visible release notes here.\n-->\n'
assert_rejected placeholder-with-comment $'## Release notes\n\n<!-- Replace the placeholder. -->\nN/A\n'
assert_rejected duplicate $'## Release notes\n\nFirst.\n\n## Release notes\n\nSecond.\n'

cat > "${test_root}/body.md" <<'EOF'
<!--
## Release notes

Editing instructions do not define the published section.
-->

## Release notes

- Keep visible text <!-- even around --> between <!-- multiple --> comments.

# Verification

This is outside the release notes.
EOF
"${extractor}" "${test_root}/body.md" "${test_root}/notes.md"
expected='- Keep visible text <!-- even around --> between <!-- multiple --> comments.'
[[ "$(< "${test_root}/notes.md")" == "${expected}" ]] || {
  echo "Release notes must retain the original Markdown of the visible section." >&2
  exit 1
}

echo "Release notes extractor tests passed."
