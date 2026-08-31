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

git -C "${fixture_repo}" checkout --quiet --detach "${develop_head}"
git -C "${fixture_repo}" merge --quiet --no-ff "${released_master}" -m sync-current-master
synchronized_release="$(git -C "${fixture_repo}" rev-parse HEAD)"
run_checker master release/20260830-2 ponta2git/momo-result ponta2git/momo-result \
  "${released_master}" "${synchronized_release}" "${develop_head}" >/dev/null

git -C "${fixture_repo}" checkout --quiet master
git -C "${fixture_repo}" merge --quiet --no-ff "${synchronized_release}" -m release-synchronized
master_after_synchronized_release="$(git -C "${fixture_repo}" rev-parse HEAD)"
git -C "${fixture_repo}" checkout --quiet develop
printf '%s\n' third >> "${fixture_repo}/state.txt"
git -C "${fixture_repo}" commit --quiet -am third
next_develop_head="$(git -C "${fixture_repo}" rev-parse HEAD)"
run_checker master release/20260830-3 ponta2git/momo-result ponta2git/momo-result \
  "${master_after_synchronized_release}" "${next_develop_head}" "${next_develop_head}" >/dev/null
git -C "${fixture_repo}" checkout --quiet --detach "${next_develop_head}"
git -C "${fixture_repo}" merge --quiet --no-ff "${master_after_synchronized_release}" \
  -m sync-current-master-again
next_synchronized_release="$(git -C "${fixture_repo}" rev-parse HEAD)"
run_checker master release/20260830-3 ponta2git/momo-result ponta2git/momo-result \
  "${master_after_synchronized_release}" "${next_synchronized_release}" \
  "${next_develop_head}" >/dev/null

git -C "${fixture_repo}" checkout --quiet master
git -C "${fixture_repo}" commit --quiet --allow-empty -m advance-master
advanced_master="$(git -C "${fixture_repo}" rev-parse HEAD)"
assert_rejected stale-master-sync master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${advanced_master}" "${synchronized_release}" "${develop_head}"

git -C "${fixture_repo}" checkout --quiet --detach "${synchronized_release}"
printf '%s\n' release-only >> "${fixture_repo}/state.txt"
git -C "${fixture_repo}" commit --quiet --amend -am changed-sync
changed_sync="$(git -C "${fixture_repo}" rev-parse HEAD)"
assert_rejected changed-sync master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${changed_sync}" "${develop_head}"

git -C "${fixture_repo}" checkout --quiet --detach "${develop_head}"
printf '%s\n' release-only >> "${fixture_repo}/state.txt"
git -C "${fixture_repo}" commit --quiet -am release-only-parent
release_only_parent="$(git -C "${fixture_repo}" rev-parse HEAD)"
git -C "${fixture_repo}" merge --quiet --no-ff "${released_master}" -m sync-from-release-only-parent
non_develop_sync="$(git -C "${fixture_repo}" rev-parse HEAD)"
assert_rejected non-develop-sync master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${non_develop_sync}" "${develop_head}"

develop_tree="$(git -C "${fixture_repo}" rev-parse "${develop_head}^{tree}")"
octopus_sync="$({
  printf '%s\n' sync-with-extra-parent
} | git -C "${fixture_repo}" commit-tree "${develop_tree}" \
  -p "${develop_head}" -p "${released_master}" -p "${master_base}")"
assert_rejected extra-parent-sync master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${octopus_sync}" "${develop_head}"

assert_rejected rollback-after-release master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${master_base}" "${develop_head}"

printf '%s\n' '## Release notes' '' 'N/A' > "${test_root}/body.md"
assert_rejected empty-release-notes master release/20260830-2 ponta2git/momo-result \
  ponta2git/momo-result "${released_master}" "${develop_head}" "${develop_head}"

echo "PR branch policy checker tests passed."
