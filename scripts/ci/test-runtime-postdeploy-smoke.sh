#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{runtime-postdeploy-smoke,ci-tool}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}"
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'ssh console --app momo-result --pty=false --quiet --command /opt/momo-result/bin/momo-runtime-tool smoke local' ]]
attempt=$(cat "${TEST_STATE}/attempt")
printf '%s\n' "$((attempt + 1))" > "${TEST_STATE}/attempt"
if [[ "${TEST_SCENARIO}" == failure || ( "${TEST_SCENARIO}" == transient && "${attempt}" == 0 ) ]]; then
  echo 'incomplete attempt output'
  echo '{"event":"runtime_postdeploy_smoke","status":"failed","errorClass":"HealthContractError"}' >&2
  exit 1
fi
checks='["database","http","http2","processes","publicEdge","web"]'
if [[ "${TEST_SCENARIO}" == missing-edge ]]; then checks='["database","http","http2","processes","web"]'; fi
printf '{"event":"runtime_postdeploy_smoke","schemaVersion":1,"status":"ok","checks":%s}\n' "${checks}"
MOCK
chmod +x "${task_tmp}/bin/flyctl"
# Exercise the production SECONDS deadline without waiting in real time.
sleep() {
  [[ "$1" == 2 ]]
  if [[ "${TEST_SCENARIO}" == failure ]]; then SECONDS=$((SECONDS + 120)); fi
}
export -f sleep
cd "${task_tmp}"
for TEST_SCENARIO in transient failure missing-edge; do
  export TEST_SCENARIO
  rm -rf runtime-production-evidence
  mkdir runtime-production-evidence
  echo '{"schemaVersion":1,"status":"ok"}' > runtime-production-evidence/postdeploy-smoke.json
  echo '{"schemaVersion":1,"status":"ok"}' > runtime-production-evidence/public-health.json
  echo 'candidate identity evidence' > runtime-production-evidence/deployment-state.json
  echo 0 > attempt
  status=0
  scripts/ci/runtime-postdeploy-smoke.sh > output 2> errors || status=$?
  test ! -s output
  if [[ "${TEST_SCENARIO}" == transient ]]; then
    test "${status}" = 0
    test "$(cat attempt)" = 2
    jq -e '.status == "ok" and (.checks | length) == 6' runtime-production-evidence/postdeploy-smoke.json > /dev/null
    jq -e '. == {schemaVersion:1,status:"ok"}' runtime-production-evidence/public-health.json > /dev/null
  else
    test "${status}" != 0
    test ! -f runtime-production-evidence/postdeploy-smoke.json
    test ! -f runtime-production-evidence/public-health.json
    if [[ "${TEST_SCENARIO}" == failure ]]; then
      test "$(cat attempt)" = 2
      grep -q HealthContractError errors
      grep -q 'readiness deadline' errors
    else
      test "$(cat attempt)" = 1
      grep -q MissingRequiredChecks errors
    fi
  fi
  test ! -f runtime-production-evidence/postdeploy-smoke.pending.json
  test ! -f runtime-production-evidence/public-health.pending.json
  test "$(cat runtime-production-evidence/deployment-state.json)" = 'candidate identity evidence'
done
echo 'Runtime post-deploy readiness contracts passed.'
