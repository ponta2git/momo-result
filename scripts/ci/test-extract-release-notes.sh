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
assert_rejected duplicate $'## Release notes\n\nFirst.\n\n## Release notes\n\nSecond.\n'

echo "Release notes extractor tests passed."
