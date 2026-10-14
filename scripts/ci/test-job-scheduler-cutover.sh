#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "${fixture}"' EXIT
mkdir -p "${fixture}/bin"
cat > "${fixture}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
app=''
for (( i=1; i<=$#; i++ )); do
  if [[ "${!i}" == --app ]]; then j=$((i+1)); app="${!j}"; fi
done
case "$1 $2" in
  'machine list')
    if [[ -e "${TEST_STATE}/${app}" ]]; then
      echo '[{"id":"abc123","state":"stopped","config":{"restart":{"policy":"no"},"services":[{"autostart":false}]}}]'
    else
      echo '[{"id":"abc123","state":"started","config":{"restart":{"policy":"on-failure"},"services":[{"autostart":true}]}}]'
    fi ;;
  'machine update')
    [[ "$*" == *'--autostart=false --restart=no --skip-start --yes'* ]]
    echo "update ${app}" >> "${TEST_STATE}/calls" ;;
  'machine stop')
    echo "stop ${app}" >> "${TEST_STATE}/calls"
    [[ "${TEST_STOP_FAIL:-}" != "${app}" ]] || exit 1
    touch "${TEST_STATE}/${app}" ;;
  *) exit 1 ;;
esac
MOCK
cat > "${fixture}/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
sha="$(cat .momo-db-ref)"
[[ "${TEST_WRONG_SHA:-}" != true ]] || sha=0000000000000000000000000000000000000000
if [[ -e "${TEST_STATE}/momo-result" && -e "${TEST_STATE}/momo-result-analysis" ]]; then
  echo migration >> "${TEST_STATE}/calls"
  conclusion="${TEST_DB_CONCLUSION:-success}"
  printf '{"headSha":"%s","headBranch":"master","event":"push","workflowName":"CI","status":"completed","conclusion":"%s","jobs":[{"name":"Migrate Neon","conclusion":"%s"}]}\n' "${sha}" "${conclusion}" "${conclusion}"
else
  printf '{"headSha":"%s","headBranch":"master","event":"push","workflowName":"CI","status":"waiting","conclusion":"","jobs":[]}\n' "${sha}"
fi
MOCK
chmod +x "${fixture}/bin/"*
export PATH="${fixture}/bin:${PATH}" TEST_STATE="${fixture}"
export JOBS_CUTOVER_DB_RUN_ID=123 GITHUB_REPOSITORY_OWNER=fixture
export RUNTIME_FLY_API_TOKEN=fixture WORKER_FLY_API_TOKEN=fixture
unset JOBS_CUTOVER_COMPLETE
cd "${repo_root}"
script=scripts/ci/job-scheduler-cutover.sh
bash "${script}" > /dev/null
printf '%s\n' 'update momo-result' 'stop momo-result' 'update momo-result-analysis' 'stop momo-result-analysis' migration > "${fixture}/expected"
cmp "${fixture}/calls" "${fixture}/expected"
# A retry after a successful migration still enforces both stop boundaries.
bash "${script}" > /dev/null
rm "${fixture}/momo-result" "${fixture}/momo-result-analysis" "${fixture}/calls"
if TEST_WRONG_SHA=true bash "${script}" > /dev/null 2>&1; then exit 1; fi
[[ ! -e "${fixture}/calls" ]]
if TEST_STOP_FAIL=momo-result-analysis bash "${script}" > /dev/null 2>&1; then exit 1; fi
! grep -qx migration "${fixture}/calls"
if TEST_DB_CONCLUSION=failure bash "${script}" > /dev/null 2>&1; then exit 1; fi
[[ -e "${fixture}/momo-result" && -e "${fixture}/momo-result-analysis" ]]
# Ordinary releases after the one-off verification require no migration inputs.
JOBS_CUTOVER_COMPLETE=true JOBS_CUTOVER_DB_RUN_ID='' bash "${script}"
echo 'DB-job cutover contract passed.'
