#!/usr/bin/env bash
# Runs only on the deployed generation; the workflow supplies the approval and lock.
set -euo pipefail
operation="${1:-auto}"
[[ "$#" -le 1 ]] || exit 2
case "${operation}" in auto|promote|backfill|check) ;; *) echo 'Use auto, promote, backfill, or check.' >&2; exit 2 ;; esac
: "${ANALYSIS_APP:=momo-result-analysis}"
: "${ANALYSIS_WAIT_SECONDS:=1800}"
: "${ANALYSIS_POLL_SECONDS:=15}"
[[ "${ANALYSIS_WAIT_SECONDS}" =~ ^[0-9]+$ && "${ANALYSIS_POLL_SECONDS}" =~ ^[1-9][0-9]*$ ]] || exit 2
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
    jq -er 'select(length == 1 and .[0].state == "started" and
      .[0].config.env.MOMO_ANALYSIS_PUBLICATION_MODE == "enabled" and
      .[0].config.env.MOMO_OCR_V2_CONSUMER_MODE == "enabled") | .[0] |
      [.id, .config.image, .config.env.MOMO_ANALYSIS_CONFIG_VERSION] | @tsv'
}
identity="$(read_machine)" || fail 'Worker identity is unavailable; verify the deployment before retrying.'
IFS=$'\t' read -r machine_id image_ref config_version <<< "${identity}"
[[ "${machine_id}" =~ ^[a-z0-9]+$ && "${image_ref}" =~ ^registry\.fly\.io/momo-result-analysis@sha256:[0-9a-f]{64}$ ]] || fail 'Worker does not have a verified immutable deployment identity.'
release_id="${config_version#series-analysis-v1-}"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]] || fail 'Worker release generation is unavailable.'
GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags origin refs/heads/master
master_sha="$(git rev-parse FETCH_HEAD)"
git merge-base --is-ancestor "${release_id}" "${master_sha}" || fail 'Worker generation is outside current master history.'
scope="$(scripts/ci/classify-git-range.sh "${release_id}" "${master_sha}")"
[[ "$(sed -n 's/^analysis_image=//p' <<< "${scope}")" == false ]] || fail 'A newer worker release must be deployed before maintenance.'

requested_operation="${operation}"
[[ "${operation}" != check ]] || requested_operation=auto
command="env MOMO_LOG_FORMAT=json /usr/local/bin/momo-analysis bootstrap -- release-reconcile --operation ${requested_operation} --release-id ${release_id}"
invoke() {
  local current_identity exit_status=0
  current_identity="$(read_machine)" || fail 'Worker identity could not be rechecked.'
  [[ "${current_identity}" == "${identity}" ]] || fail 'Worker changed during maintenance; check the current deployment and retry.'
  flyctl ssh console --app "${ANALYSIS_APP}" --machine "${machine_id}" --pty=false --quiet \
    --command "${command}$1" > "${task_tmp}/raw.json" 2> "${task_tmp}/error" || exit_status=$?
  # The CLI also emits structured diagnostics on stdout. Select exactly one
  # report, then sanitize; a diagnostic must neither mask nor duplicate it.
  jq -es '[.[] | select(has("schemaVersion") and has("planDigest"))] |
    select(length == 1) | .[0]' "${task_tmp}/raw.json" > "${task_tmp}/report.json" \
    || fail 'Analysis inspection returned no unique maintenance report.'
  "${script_dir}/../ci/sanitize-analysis-report.sh" "${task_tmp}/report.json" \
    "${report_dir}/operation-report.json" || fail 'Analysis inspection failed; no valid maintenance report was returned.'
  status="$(jq -r '.status' "${report_dir}/operation-report.json")"
  [[ "${exit_status}" == 0 || "${status}" == attention_required ]] || fail 'Analysis command failed; inspect deployment health before retrying.'
  cat "${report_dir}/operation-report.json"
}
invoke ''
if [[ "${operation}" == check ]]; then
  [[ "${status}" != attention_required ]] || exit 1
  exit 0
fi
if [[ "${status}" == planned ]]; then
  plan="$(jq -er '.planDigest | select(test("^sha256:[0-9a-f]{64}$"))' "${report_dir}/operation-report.json")"
  invoke " --apply --expected-plan ${plan}"
elif [[ "${status}" == running ]]; then
  invoke ' --apply'
fi
deadline=$((SECONDS + ANALYSIS_WAIT_SECONDS))
while [[ "${status}" == running ]]; do
  if (( SECONDS >= deadline )); then
    fail 'Analysis is still running. Run Analysis production operation (auto) to resume checking; do not create another campaign.'
  fi
  sleep "${ANALYSIS_POLL_SECONDS}"
  invoke ''
done
case "${status}" in
  not_needed|complete) ;;
  attention_required) fail 'Analysis needs attention. Review operation-report.json and run Analysis production operation after resolving its reason.' ;;
  *) fail 'Analysis returned an unexpected state.' ;;
esac
