#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{maintenance-candidates,ci-tool}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}" GITHUB_REPOSITORY=fixture/repository
cat > "${task_tmp}/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$2" in
  repos/fixture/repository/actions/artifacts/11) cat "${TEST_STATE}/runtime-name" ;;
  repos/fixture/repository/actions/artifacts/22) echo analysis-candidate-metadata-101-2 ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/gh"
cd "${task_tmp}"
printf '%s\n' runtime-image-101-2 > runtime-name
jq -n --arg sha 0123456789abcdef0123456789abcdef01234567 --arg hash "$(printf '%064d' 1)" \
  '{candidates:{result:$sha},producer:{runId:"101",runAttempt:2,artifacts:[{id:"11",digest:$hash},{id:"22",digest:$hash}]}}' > receipt.json
scripts/ci/maintenance-candidates.sh receipt.json > selection
grep -q '^producer_run_id=101$' selection
grep -q '^runtime_artifact_id=11$' selection
grep -q '^worker_metadata_id=22$' selection
grep -q '^runtime_image_ref=registry.fly.io/momo-result:0123456789abcdef0123456789abcdef01234567-101-2$' selection
printf '%s\n' runtime-image-101-1 > runtime-name
if scripts/ci/maintenance-candidates.sh receipt.json > selection 2> diagnostics; then exit 1; fi
test ! -s selection
echo 'Maintenance candidate selection preserves the fixed producer attempt.'
