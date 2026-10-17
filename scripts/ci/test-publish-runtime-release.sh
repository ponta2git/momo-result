#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{publish-runtime-release,runtime-release-notes,extract-release-notes}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}" GITHUB_REPOSITORY=fixture/repository
export RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
export RUN_URL=https://github.com/fixture/repository/actions/runs/654321
cat > "${task_tmp}/scripts/ci/maintenance-control.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${TEST_STATE}/permissions"
test ! -f "${TEST_STATE}/held"
MOCK
cat > "${task_tmp}/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  'api -H Accept: application/vnd.github+json repos/fixture/repository/commits/'*'/pulls') cat "${TEST_STATE}/pulls.json" ;;
  'api repos/fixture/repository/commits/'*)
    [[ ! -f "${TEST_STATE}/close-during-prepare" ]] || touch "${TEST_STATE}/held"
    echo 2026-10-18T00:00:00Z
    ;;
  'api repos/fixture/repository/git/ref/tags/'*) exit 1 ;;
  'release view '*) exit 1 ;;
  'release create '*) printf '%s\n' "$*" > "${TEST_STATE}/created" ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/gh" "${task_tmp}/scripts/ci/maintenance-control.sh"
cd "${task_tmp}"
jq -n --arg commit "${RELEASE_SHA}" '[{number:42,merged_at:"2026-10-18T00:00:00Z",merge_commit_sha:$commit,
  base:{ref:"master"},head:{ref:"release/fixture",repo:{full_name:"fixture/repository"}},body:"## Release notes\n\n- Fixture release."}]' > pulls.json
for mode in normal maintenance; do
  rm -f created permissions
  scripts/ci/publish-runtime-release.sh "${mode}" receipt.json
  grep -qF -- "--target ${RELEASE_SHA}" created
  grep -qF -- "${RUN_URL}" runtime-release-notes.md
  if [[ "${mode}" == normal ]]; then
    test "$(grep -c '^normal-guard$' permissions)" = 2
  else
    test "$(grep -c '^maintenance-guard publish receipt.json$' permissions)" = 2
  fi
done
rm created
touch held
if scripts/ci/publish-runtime-release.sh normal > output 2>&1; then exit 1; fi
test ! -f created
rm held
touch close-during-prepare
if scripts/ci/publish-runtime-release.sh maintenance receipt.json > output 2>&1; then exit 1; fi
test ! -f created
echo 'Release publication rechecks permission at the mutation boundary.'
