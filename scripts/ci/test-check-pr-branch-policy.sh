#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="${repo_root}/scripts/ci/check-pr-branch-policy.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

cat > "${test_root}/body.md" <<'BODY'
## Release notes

- Restore the previous release behavior.
BODY

run_checker() {
  (
    # Branch policy needs PR metadata only, including for release-only fixes
    # and reverts. It must not depend on a develop checkout or Git history.
    cd "${test_root}"
    "${checker}" "$@" "${test_root}/body.md"
  )
}

run_checker develop feat/example ponta2git/momo-result ponta2git/momo-result >/dev/null
run_checker develop feat/example contributor/momo-result ponta2git/momo-result >/dev/null
run_checker master release/20261018-1 ponta2git/momo-result ponta2git/momo-result >/dev/null
run_checker master release/revert-previous-release ponta2git/momo-result ponta2git/momo-result >/dev/null

assert_rejected() {
  local name="$1"
  shift
  if run_checker "$@" >/dev/null 2>&1; then
    echo "Expected PR branch policy fixture to be rejected: ${name}" >&2
    exit 1
  fi
}

assert_rejected wrong-base staging feat/example ponta2git/momo-result ponta2git/momo-result
assert_rejected wrong-head master feat/example ponta2git/momo-result ponta2git/momo-result
assert_rejected empty-release-name master release/ ponta2git/momo-result ponta2git/momo-result
assert_rejected fork-release master release/20261018-1 contributor/momo-result ponta2git/momo-result

printf '%s\n' '## Release notes' '' 'N/A' > "${test_root}/body.md"
assert_rejected empty-release-notes master release/20261018-1 ponta2git/momo-result ponta2git/momo-result
run_checker develop feat/example ponta2git/momo-result ponta2git/momo-result >/dev/null

if "${checker}" master release/20261018-1 >/dev/null 2>&1; then
  echo "Expected checker to reject missing PR metadata arguments." >&2
  exit 1
fi

echo "PR branch policy checker tests passed."
