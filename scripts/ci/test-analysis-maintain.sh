#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/repo/scripts/ci" "${task_tmp}/repo/scripts/ops"
cp "${repo_root}/scripts/ops/analysis-maintain.sh" "${task_tmp}/repo/scripts/ops/"
cp "${repo_root}/scripts/ci/"{classify-git-range,classify-changes,sanitize-analysis-report}.sh "${task_tmp}/repo/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}"
export ANALYSIS_WAIT_SECONDS=3 ANALYSIS_POLL_SECONDS=1
cat > "${task_tmp}/bin/git" <<'MOCK'
#!/usr/bin/env bash
case "$1" in rev-parse) printf '%040d\n' 1 ;; diff) [[ ! -f "${TEST_STATE}/newer" ]] || printf 'apps/processing-worker/src/cli.rs\0' ;; esac
exit 0
MOCK
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'machine list')
    machine_id=abc123
    [[ ! -f "${TEST_STATE}/changed" || ! -f "${TEST_STATE}/calls" ]] || machine_id=def456
    printf '{"id":"%s","state":"started","config":{"image":"registry.fly.io/momo-result-analysis@sha256:%064d","env":{"MOMO_ANALYSIS_CONFIG_VERSION":"series-analysis-v1-%040d","MOMO_ANALYSIS_PUBLICATION_MODE":"enabled","MOMO_OCR_V2_CONSUMER_MODE":"enabled"}}}\n' "${machine_id}" 1 1 | jq -s .
    ;;
  'ssh console')
    printf '%s\n' "$*" >> "${TEST_STATE}/calls"
    count="$(wc -l < "${TEST_STATE}/calls" | tr -d ' ')"
    cat "${TEST_STATE}/response-${count}"
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/"*
report() {
  jq -n --arg status "$2" --arg reason "${3:-already_current}" \
    '{schemaVersion:1,status:$status,action:"none",reason:$reason,
      planDigest:("sha256:" + ("a" * 64)),targetCount:1,completedCount:0,failedCount:0,
      privateData:"must-not-appear"}' > "${task_tmp}/response-$1"
}
reset_case() { rm -f "${task_tmp}/calls" "${task_tmp}/changed" "${task_tmp}/newer"; }
run_case() { "${task_tmp}/repo/scripts/ops/analysis-maintain.sh" "$@" > "${task_tmp}/output" 2>&1; }
expect_calls() { test "$(wc -l < "${task_tmp}/calls" | tr -d ' ')" = "$1"; }
report 1 not_needed
run_case auto
expect_calls 1
! rg -q must-not-appear "${task_tmp}/output"
reset_case
report 1 planned
run_case check
expect_calls 1
! rg -q -- --apply "${task_tmp}/calls"
reset_case
report 1 planned
report 2 running operation_accepted
report 3 complete
run_case auto
expect_calls 3
rg -q -- '--apply --expected-plan sha256:a{64}' "${task_tmp}/calls"
reset_case
report 1 planned
report 2 attention_required plan_changed_run_check_again
printf '%s\n' '{"timestamp":"fixture","fields":{"event":"analysis_command_failed"}}' >> "${task_tmp}/response-2"
if run_case auto; then echo 'A changed plan must fail.' >&2; exit 1; fi
expect_calls 2
rg -q plan_changed_run_check_again "${task_tmp}/repo/analysis-production-artifact/operation-report.json"
! rg -q analysis_command_failed "${task_tmp}/repo/analysis-production-artifact/operation-report.json"
reset_case
report 1 running
report 2 running
if ANALYSIS_WAIT_SECONDS=0 run_case auto; then echo 'Pending work must not pass the release gate.' >&2; exit 1; fi
expect_calls 2
rg -q 'still running' "${task_tmp}/output"
reset_case
report 1 planned
: > "${task_tmp}/changed"
if run_case auto; then echo 'A changed machine must fail before apply.' >&2; exit 1; fi
expect_calls 1
reset_case
: > "${task_tmp}/newer"
if run_case auto; then echo 'An outdated worker must not promote.' >&2; exit 1; fi
test ! -f "${task_tmp}/calls"
reset_case
report 1 not_needed
cat "${task_tmp}/response-1" >> "${task_tmp}/response-2"
cp "${task_tmp}/response-2" "${task_tmp}/response-1"
if run_case auto; then echo 'Multiple reports must not pass.' >&2; exit 1; fi
reset_case
printf 'not JSON\n' > "${task_tmp}/response-1"
if run_case auto; then echo 'Malformed reports must fail.' >&2; exit 1; fi
expect_calls 1
printf 'Analysis maintenance orchestration tests passed.\n'
