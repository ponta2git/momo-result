#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 1 ]] || exit 2
receipt="$1"
: "${RUNNER_TEMP:?required}"
task_tmp="$(mktemp -d "${RUNNER_TEMP}/momo-maintenance-analysis.XXXXXX")"
trap 'rm -rf "${task_tmp}"' EXIT
scripts/ci/maintenance-control.sh maintenance-guard analysis "${receipt}"
scope="$(scripts/ci/ci-tool.sh maintenance-operation-scope "${receipt}" analysis)"
cutover_id="$(sed -n 's/^cutover_id=//p' <<< "${scope}")"
stop_epoch="$(sed -n 's/^stop_epoch=//p' <<< "${scope}")"
operation_id="$(sed -n 's/^operation_id=//p' <<< "${scope}")"
campaign_id="$(sed -n 's/^campaign_id=//p' <<< "${scope}")"
plan_digest="$(sed -n 's/^plan_digest=//p' <<< "${scope}")"
release_sha="$(sed -n 's/^release_sha=//p' <<< "${scope}")"
machine_state="$(flyctl machine list --app momo-result-analysis --json)"
identity="$(scripts/ci/ci-tool.sh analysis-machine-identity <<< "${machine_state}")"
IFS=$'\t' read -r machine_id image_ref config_version <<< "${identity}"
[[ "${config_version}" == "series-analysis-v1-${release_sha}" ]] || exit 1
verified_id="$(scripts/ci/ci-tool.sh frozen-machine-id analysis "${image_ref}" <<< "${machine_state}")"
[[ "${machine_id}" == "${verified_id}" ]] || exit 1
mkdir -p analysis-maintenance-evidence
rm -f analysis-maintenance-evidence/plan.json analysis-maintenance-evidence/completion.json
# Every argument comes from the validated bounded scope; no free-form command,
# new operation, or new campaign can be supplied to this continuation.
command="/usr/local/bin/momo-processing-worker bootstrap -- maintenance-analysis --cutover-id ${cutover_id} --stop-epoch ${stop_epoch} --operation-id ${operation_id} --campaign-id ${campaign_id}"
flyctl ssh console --app momo-result-analysis --machine "${machine_id}" --pty=false --command "${command}" |
  scripts/ci/ci-tool.sh maintenance-analysis-evidence "${receipt}" plan > "${task_tmp}/plan.json"
mv "${task_tmp}/plan.json" analysis-maintenance-evidence/plan.json
current_id="$(flyctl machine list --app momo-result-analysis --json |
  scripts/ci/ci-tool.sh frozen-machine-id analysis "${image_ref}")"
[[ "${machine_id}" == "${current_id}" ]] || exit 1
scripts/ci/maintenance-control.sh maintenance-guard analysis "${receipt}"
if [[ "$(jq -r '.status' analysis-maintenance-evidence/plan.json)" == complete ]]; then
  cp analysis-maintenance-evidence/plan.json analysis-maintenance-evidence/completion.json
  exit 0
fi
flyctl ssh console --app momo-result-analysis --machine "${machine_id}" --pty=false \
  --command "${command} --apply --expected-plan ${plan_digest}" |
  scripts/ci/ci-tool.sh maintenance-analysis-evidence "${receipt}" complete > "${task_tmp}/completion.json"
mv "${task_tmp}/completion.json" analysis-maintenance-evidence/completion.json
