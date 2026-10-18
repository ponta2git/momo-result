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
[[ "$1 $2" == 'maintenance-guard analysis' ]]
MOCK
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'machine list') cat "${TEST_STATE}/machine.json" ;;
  'ssh console')
    if [[ "$*" == *'--apply --expected-plan '* ]]; then
      printf '%s\n' "$*" > "${TEST_STATE}/applied"
      jq '.status = "complete" | .completedCount = .targetCount' "${TEST_STATE}/plan.json"
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
  scope:{operationId:"operation-fixture",campaignId:"campaign-fixture",planDigest:$digest}}' > receipt.json
jq -n --arg sha "${sha}" --arg digest "${digest}" '[{id:"a123",state:"started",config:{image:("registry.fly.io/momo-result-analysis@"+$digest),
  guest:{cpu_kind:"shared",cpus:1,memory_mb:256},env:{MOMO_MAINTENANCE_MODE:"frozen",MOMO_ANALYSIS_CONFIG_VERSION:("series-analysis-v1-"+$sha),
  MOMO_ANALYSIS_PUBLICATION_MODE:"enabled",MOMO_OCR_V2_CONSUMER_MODE:"enabled"}}}]' > machine.json
jq -n --arg digest "${digest}" '{schemaVersion:1,cutoverId:"fixture",stopEpoch:4,operationId:"operation-fixture",campaignId:"campaign-fixture",
  planDigest:$digest,status:"planned",targetCount:2,completedCount:1,failedCount:0}' > plan.json
scripts/ci/continue-maintenance-analysis.sh receipt.json
grep -qF -- '--operation-id operation-fixture --campaign-id campaign-fixture --apply --expected-plan' applied
jq -e '.status == "complete" and .completedCount == .targetCount' analysis-maintenance-evidence/completion.json > /dev/null
rm applied
cp plan.json planned.json
jq '.status = "complete" | .completedCount = .targetCount' plan.json > complete.json
mv complete.json plan.json
scripts/ci/continue-maintenance-analysis.sh receipt.json
test ! -f applied
mv planned.json plan.json
touch fail-apply
if scripts/ci/continue-maintenance-analysis.sh receipt.json > output 2>&1; then exit 1; fi
test -f applied
test ! -f analysis-maintenance-evidence/completion.json
rm fail-apply applied
jq '.planDigest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"' plan.json > stale.json
mv stale.json plan.json
if scripts/ci/continue-maintenance-analysis.sh receipt.json > output 2>&1; then exit 1; fi
test ! -f applied
echo 'Analysis continuation rejects an unreviewed plan before apply.'
