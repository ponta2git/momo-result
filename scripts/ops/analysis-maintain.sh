#!/usr/bin/env bash
# Runs only on the deployed generation; the workflow supplies the approval and lock.
set -euo pipefail
operation="${1:-auto}"
[[ "$#" -le 1 ]] || exit 2
case "${operation}" in auto|promote|backfill|check) ;; *) echo 'Use auto, promote, backfill, or check.' >&2; exit 2 ;; esac
: "${ANALYSIS_APP:=momo-result-analysis}"
: "${RUNTIME_APP:=momo-result}"
: "${RUNTIME_FLY_API_TOKEN:?The runtime machine must be attested before release inspection.}"
: "${ANALYSIS_WAIT_SECONDS:=1800}"
: "${ANALYSIS_POLL_SECONDS:=15}"
# Bash arithmetic treats leading zeroes as octal. Reject them before inspection
# or apply so an invalid timeout cannot fail only after maintenance has started.
[[ "${ANALYSIS_WAIT_SECONDS}" =~ ^(0|[1-9][0-9]*)$ && "${ANALYSIS_POLL_SECONDS}" =~ ^[1-9][0-9]*$ ]] || exit 2
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"
report_dir=analysis-production-artifact
mkdir -p "${report_dir}"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT

# Keep provider responses and stderr private. Only the allowlisted report is evidence.
fail() { echo "::error::$1" >&2; exit 1; }
read_machine() {
  flyctl machine list --app "${ANALYSIS_APP}" --json 2> "${task_tmp}/error" |
    "${script_dir}/../ci/ci-tool.sh" analysis-machine-identity
}
read_reader_machine() {
  local state image id
  state="$(FLY_API_TOKEN="${RUNTIME_FLY_API_TOKEN}" flyctl machine list --app "${RUNTIME_APP}" --json 2> "${task_tmp}/error")" || return 1
  image="$(jq -er 'if length == 1 then .[0].config.image else empty end' <<< "${state}")" || return 1
  id="$(scripts/ci/ci-tool.sh runtime-machine-id "${image}" <<< "${state}")" || return 1
  printf '%s\t%s\n' "${id}" "${image}"
}
reader_identity="$(read_reader_machine)" || fail 'Exactly one started immutable API reader is required.'
IFS=$'\t' read -r reader_machine _ <<< "${reader_identity}"
identity="$(read_machine)" || fail 'Worker identity is unavailable; verify the deployment before retrying.'
IFS=$'\t' read -r machine_id image_ref config_version <<< "${identity}"
release_id="${config_version#series-analysis-v1-}"
GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags origin refs/heads/master
master_sha="$(git rev-parse FETCH_HEAD)"
git merge-base --is-ancestor "${release_id}" "${master_sha}" || fail 'Worker generation is outside current master history.'
scope="$(scripts/ci/classify-git-range.sh "${release_id}" "${master_sha}")"
[[ "$(sed -n 's/^analysis_image=//p' <<< "${scope}")" == false ]] || fail 'A newer worker release must be deployed before maintenance.'

requested_operation="${operation}"
[[ "${operation}" != check ]] || requested_operation=auto
attest_fleet() {
  local observed_worker observed_reader mode="${1:-}"
  observed_worker="$(read_machine)" || fail 'Worker identity could not be rechecked.'
  observed_reader="$(read_reader_machine)" || fail 'API reader identity could not be rechecked.'
  [[ "${observed_worker}" == "${identity}" && "${observed_reader}" == "${reader_identity}" ]] || fail 'The serving fleet changed during maintenance.'
  reader_proof="$(FLY_API_TOKEN="${RUNTIME_FLY_API_TOKEN}" flyctl ssh console --app "${RUNTIME_APP}" --machine "${reader_machine}" --pty=false --quiet \
    --command "/opt/momo-result/bin/momo-runtime-tool analysis-attest${mode:+ ${mode}}" 2> "${task_tmp}/error")" || fail 'The resident API failed to attest.'
  worker_proof="$(flyctl ssh console --app "${ANALYSIS_APP}" --machine "${machine_id}" --pty=false --quiet \
    --command "/usr/local/bin/momo-analysis release-attest${mode:+ ${mode}}" 2> "${task_tmp}/error")" || fail 'The resident worker failed to attest.'
  [[ "${reader_proof}" =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ && "${worker_proof}" =~ ^[a-zA-Z0-9@._-]{1,255}$ ]] || fail 'Invalid fleet attestation.'
}
invoke() {
  local exit_status=0 command
  attest_fleet
  command="env MOMO_LOG_FORMAT=json MOMO_RELEASE_READER_ATTESTATION=${reader_proof} MOMO_RELEASE_WORKER_ATTESTATION=${worker_proof} /usr/local/bin/momo-analysis bootstrap -- release-reconcile --operation ${requested_operation} --release-id ${release_id}"
  flyctl ssh console --app "${ANALYSIS_APP}" --machine "${machine_id}" --pty=false --quiet \
    --command "${command}$1" > "${task_tmp}/raw.json" 2> "${task_tmp}/error" || exit_status=$?
  "${script_dir}/../ci/ci-tool.sh" analysis-report --from-log "${task_tmp}/raw.json" \
    "${report_dir}/operation-report.json" || fail 'Analysis inspection failed; no valid maintenance report was returned.'
  local report_state
  report_state="$("${script_dir}/../ci/ci-tool.sh" analysis-report-state "${report_dir}/operation-report.json")"
  IFS=$'\t' read -r status plan <<< "${report_state}"
  [[ "${exit_status}" == 0 || "${status}" == attention_required ]] || fail 'Analysis command failed; inspect deployment health before retrying.'
  cat "${report_dir}/operation-report.json"
}
invoke ''
if [[ "${operation}" == check ]]; then
  [[ "${status}" != attention_required ]] || exit 1
  exit 0
fi
if [[ "${status}" == planned ]]; then
  invoke " --apply --expected-plan ${plan}"
elif [[ "${status}" == running ]]; then
  invoke ' --apply'
fi
# Wake newly admitted processing before waiting for campaign targets.
if [[ "${status}" == running ]]; then attest_fleet --active; fi
deadline=$((SECONDS + ANALYSIS_WAIT_SECONDS))
while [[ "${status}" == running ]]; do
  if (( SECONDS >= deadline )); then
    fail 'Analysis is still running. Run Analysis production operation (auto) to resume checking; do not create another campaign.'
  fi
  sleep "${ANALYSIS_POLL_SECONDS}"
  invoke ''
done
case "${status}" in
  not_needed|complete) attest_fleet --active ;;
  attention_required) fail 'Analysis needs attention. Review operation-report.json and run Analysis production operation after resolving its reason.' ;;
  *) fail 'Analysis returned an unexpected state.' ;;
esac
