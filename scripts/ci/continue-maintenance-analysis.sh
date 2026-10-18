#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 2 ]] || exit 2
receipt="$1"
phase="$2"
case "${phase}" in initialize|continue) ;; *) exit 2 ;; esac
: "${RUNNER_TEMP:?required}"
task_tmp="$(mktemp -d "${RUNNER_TEMP}/momo-maintenance-analysis.XXXXXX")"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p analysis-maintenance-evidence
rm -f analysis-maintenance-evidence/plan.json analysis-maintenance-evidence/completion.json
guard() {
  if [[ "${phase}" == initialize ]]; then
    scripts/ci/maintenance-control.sh status > "${task_tmp}/status.json"
    scripts/ci/maintenance-control.sh maintenance-guard analysis "${receipt}" |
      scripts/ci/ci-tool.sh maintenance-initialization-guard "${receipt}" "${task_tmp}/status.json"
  else
    scripts/ci/maintenance-control.sh maintenance-guard analysis "${receipt}"
  fi
}
guard
scope="$(scripts/ci/ci-tool.sh maintenance-operation-scope "${receipt}" analysis)"
cutover_id="$(sed -n 's/^cutover_id=//p' <<< "${scope}")"
stop_epoch="$(sed -n 's/^stop_epoch=//p' <<< "${scope}")"
operation_id="$(sed -n 's/^operation_id=//p' <<< "${scope}")"
campaign_id="$(sed -n 's/^campaign_id=//p' <<< "${scope}")"
plan_digest="$(sed -n 's/^plan_digest=//p' <<< "${scope}")"
release_sha="$(sed -n 's/^release_sha=//p' <<< "${scope}")"
readiness_digest="$(sed -n 's/^readiness_digest=//p' <<< "${scope}")"
machine_state="$(flyctl machine list --app momo-result-analysis --json)"
identity="$(scripts/ci/ci-tool.sh analysis-machine-identity <<< "${machine_state}")"
IFS=$'\t' read -r machine_id image_ref config_version <<< "${identity}"
[[ "${config_version}" == "series-analysis-v1-${release_sha}" ]] || exit 1
verified_id="$(scripts/ci/ci-tool.sh frozen-machine-id analysis "${image_ref}" <<< "${machine_state}")"
[[ "${machine_id}" == "${verified_id}" ]] || exit 1
# Every argument comes from the validated bounded scope and explicit phase.
# Initializing never consumes the resulting continuation plan without a new receipt.
command="/usr/local/bin/momo-processing-worker bootstrap -- maintenance-analysis --phase ${phase} --cutover-id ${cutover_id} --stop-epoch ${stop_epoch} --operation-id ${operation_id} --campaign-id ${campaign_id}"
preview_command="${command}"
if [[ "${phase}" == initialize ]]; then
  command+=" --candidate-release ${release_sha} --readiness-digest ${readiness_digest}"
  preview_command="${command} --expected-plan ${plan_digest}"
fi
flyctl ssh console --app momo-result-analysis --machine "${machine_id}" --pty=false --command "${preview_command}" |
  scripts/ci/ci-tool.sh maintenance-analysis-evidence "${receipt}" "${phase}" plan > "${task_tmp}/plan.json"
mv "${task_tmp}/plan.json" analysis-maintenance-evidence/plan.json
current_id="$(flyctl machine list --app momo-result-analysis --json |
  scripts/ci/ci-tool.sh frozen-machine-id analysis "${image_ref}")"
[[ "${machine_id}" == "${current_id}" ]] || exit 1
guard
if [[ "$(jq -r '.status' analysis-maintenance-evidence/plan.json)" =~ ^(complete|initialized)$ ]]; then
  cp analysis-maintenance-evidence/plan.json analysis-maintenance-evidence/completion.json
  exit 0
fi
flyctl ssh console --app momo-result-analysis --machine "${machine_id}" --pty=false \
  --command "${command} --apply --expected-plan ${plan_digest}" |
  scripts/ci/ci-tool.sh maintenance-analysis-evidence "${receipt}" "${phase}" complete > "${task_tmp}/completion.json"
mv "${task_tmp}/completion.json" analysis-maintenance-evidence/completion.json
