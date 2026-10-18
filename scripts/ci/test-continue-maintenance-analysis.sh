#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{continue-maintenance-analysis,ci-tool}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}" RUNNER_TEMP="${task_tmp}"
cat > "${task_tmp}/scripts/ci/maintenance-control.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  status) cat "${TEST_STATE}/status.json" ;;
  maintenance-guard)
    [[ "$2" == analysis ]]
    cat "${TEST_STATE}/guard.json"
    ;;
  *) exit 2 ;;
esac
MOCK
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'machine list') cat "${TEST_STATE}/machine.json" ;;
  'ssh console')
    printf '%s\n' "$*" >> "${TEST_STATE}/commands"
    if [[ "$*" == *'--apply --expected-plan '* ]]; then
      printf '%s\n' "$*" > "${TEST_STATE}/applied"
      if [[ "$*" == *'--phase initialize'* ]]; then
        jq '.status="initialized" | .continuationPlanDigest="sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"' "${TEST_STATE}/plan.json"
      else
        jq '.status = "complete" | .completedCount = .targetCount' "${TEST_STATE}/plan.json"
      fi
      [[ ! -f "${TEST_STATE}/fail-apply" ]] || exit 7
    else
      cat "${TEST_STATE}/plan.json"
    fi
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/flyctl" "${task_tmp}/scripts/ci/maintenance-control.sh"
cd "${task_tmp}"
sha=0123456789abcdef0123456789abcdef01234567
digest="sha256:$(printf '%064d' 1)"
jq -n --arg sha "${sha}" --arg digest "${digest}" '{formatVersion:1,operation:"analysis",cutoverId:"fixture",stopEpoch:4,candidates:{result:$sha},
  evidence:{previousStage:("c" * 64)},
  scope:{operationId:"operation-fixture",campaignId:"campaign-fixture",planDigest:$digest}}' > receipt.json
jq -n --arg sha "${sha}" '{head:$sha,stateVersion:8,cutoverId:"fixture",stopEpoch:4,phase:"CONSUMERS_STAGED"}' > status.json
jq -n --arg sha "${sha}" '{controlHead:$sha,stateVersion:8,cutoverId:"fixture",stopEpoch:4,receiptDigest:("e" * 64)}' > guard.json
jq -n --arg sha "${sha}" --arg digest "${digest}" '[{id:"a123",state:"started",config:{image:("registry.fly.io/momo-result-analysis@"+$digest),
  guest:{cpu_kind:"shared",cpus:1,memory_mb:256},env:{MOMO_MAINTENANCE_MODE:"frozen",MOMO_ANALYSIS_CONFIG_VERSION:("series-analysis-v1-"+$sha),
  MOMO_ANALYSIS_PUBLICATION_MODE:"enabled",MOMO_OCR_V2_CONSUMER_MODE:"enabled"}}}]' > machine.json
jq -n --arg digest "${digest}" '{schemaVersion:2,kind:"continue",cutoverId:"fixture",stopEpoch:4,operationId:"operation-fixture",campaignId:"campaign-fixture",
  planDigest:$digest,status:"planned",targetCount:2,completedCount:1,failedCount:0}' > plan.json
scripts/ci/continue-maintenance-analysis.sh receipt.json continue
grep -qF -- '--operation-id operation-fixture --campaign-id campaign-fixture --apply --expected-plan' applied
jq -e '.status == "complete" and .completedCount == .targetCount' analysis-maintenance-evidence/completion.json > /dev/null
rm applied
cp plan.json planned.json
jq '.status = "complete" | .completedCount = .targetCount' plan.json > complete.json
mv complete.json plan.json
scripts/ci/continue-maintenance-analysis.sh receipt.json continue
test ! -f applied
mv planned.json plan.json
touch fail-apply
if scripts/ci/continue-maintenance-analysis.sh receipt.json continue > output 2>&1; then exit 1; fi
test -f applied
test ! -f analysis-maintenance-evidence/completion.json
rm fail-apply applied
jq '.planDigest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"' plan.json > stale.json
mv stale.json plan.json
if scripts/ci/continue-maintenance-analysis.sh receipt.json continue > output 2>&1; then exit 1; fi
test ! -f applied
# Initialization is an explicit, separately guarded phase. Neither phase may
# consume the other phase's preview even when IDs and the claimed digest match.
jq --arg sha "${sha}" --arg digest "${digest}" '.kind="initialize" | .status="planned" | .planDigest=$digest | .completedCount=0 |
  .candidateRelease=$sha | .readinessDigest=("sha256:" + ("c" * 64))' plan.json > initialize.json
mv initialize.json plan.json
if scripts/ci/continue-maintenance-analysis.sh receipt.json continue > output 2>&1; then exit 1; fi
test ! -f applied
scripts/ci/continue-maintenance-analysis.sh receipt.json initialize
grep -qF -- '--phase initialize' applied
grep -qF -- "--candidate-release ${sha} --readiness-digest sha256:" applied
jq -e '.kind == "initialize" and .status == "initialized" and .continuationPlanDigest != .planDigest' analysis-maintenance-evidence/completion.json > /dev/null
test "$(grep -cF -- '--apply --expected-plan' commands)" -ge 1
cp analysis-maintenance-evidence/completion.json plan.json
rm applied commands
scripts/ci/continue-maintenance-analysis.sh receipt.json initialize
test ! -f applied
test "$(wc -l < commands | tr -d ' ')" == 1
grep -qF -- "--expected-plan ${digest}" commands
for change in '.phase="READY_TO_RESUME"' '.head="ffffffffffffffffffffffffffffffffffffffff"' '.stateVersion=9'; do
  cp status.json correct-status.json
  jq "${change}" status.json > changed-status.json
  mv changed-status.json status.json
  rm -f commands
  if scripts/ci/continue-maintenance-analysis.sh receipt.json initialize > output 2>&1; then exit 1; fi
  test ! -f commands
  test ! -f applied
  mv correct-status.json status.json
done
echo 'Frozen analysis binds phase, live control head, candidate readiness, and the reviewed plan before apply.'
