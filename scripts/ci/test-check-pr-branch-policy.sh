#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="${repo_root}/scripts/ci/check-pr-branch-policy.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

fixture_repo="${test_root}/repo"
git init --quiet --initial-branch=master "${fixture_repo}"
git -C "${fixture_repo}" config user.email fixture@example.invalid
git -C "${fixture_repo}" config user.name Fixture
printf '%s\n' base > "${fixture_repo}/state.txt"
git -C "${fixture_repo}" add .
git -C "${fixture_repo}" commit --quiet -m base
master_base="$(git -C "${fixture_repo}" rev-parse HEAD)"

git -C "${fixture_repo}" checkout --quiet -b develop
printf '%s\n' first >> "${fixture_repo}/state.txt"
git -C "${fixture_repo}" commit --quiet -am first
first_snapshot="$(git -C "${fixture_repo}" rev-parse HEAD)"
printf '%s\n' second >> "${fixture_repo}/state.txt"
git -C "${fixture_repo}" commit --quiet -am second
develop_head="$(git -C "${fixture_repo}" rev-parse HEAD)"

cat > "${test_root}/body.md" <<'EOF'
## Release notes

- Ship the first snapshot.
EOF

run_checker() {
  (
    cd "${fixture_repo}"
    "${checker}" "$@" "${test_root}/body.md"
  )
}

run_checker develop feat/example ponta2git/momo-result ponta2git/momo-result \
  "${master_base}" "${develop_head}" "" >/dev/null
run_checker master release/20260830-1 ponta2git/momo-result ponta2git/momo-result \
  "${master_base}" "${first_snapshot}" "${develop_head}" >/dev/null

assert_rejected() {
  local name="$1"
  shift
  if run_checker "$@" >/dev/null 2>&1; then
    echo "Expected PR branch policy fixture to be rejected: ${name}" >&2
    exit 1
  fi
}

assert_rejected wrong-base staging feat/example ponta2git/momo-result ponta2git/momo-result \
  "${master_base}" "${develop_head}" ""
assert_rejected wrong-head master feat/example ponta2git/momo-result ponta2git/momo-result \
  "${master_base}" "${first_snapshot}" "${develop_head}"
assert_rejected fork-release master release/20260830-1 contributor/momo-result ponta2git/momo-result \
  "${master_base}" "${first_snapshot}" "${develop_head}"

git -C "${fixture_repo}" checkout --quiet --detach "${first_snapshot}"
printf '%s\n' release-only >> "${fixture_repo}/state.txt"
git -C "${fixture_repo}" commit --quiet -am release-only
release_only="$(git -C "${fixture_repo}" rev-parse HEAD)"
assert_rejected release-only-commit master release/20260830-1 ponta2git/momo-result \
  ponta2git/momo-result "${master_base}" "${release_only}" "${develop_head}"

git -C "${fixture_repo}" checkout --quiet master
git -C "${fixture_repo}" merge --quiet --no-ff "${first_snapshot}" -m release-first
released_master="$(git -C "${fixture_repo}" rev-parse HEAD)"
run_checker master release/20260830-2 ponta2git/momo-result ponta2git/momo-result \
  "${released_master}" "${develop_head}" "${develop_head}" >/dev/null
assert_rejected rollback-after-release master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${master_base}" "${develop_head}"

printf '%s\n' '## Release notes' '' 'N/A' > "${test_root}/body.md"
assert_rejected empty-release-notes master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${develop_head}" "${develop_head}"

echo "PR branch policy checker tests passed."
