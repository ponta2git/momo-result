#!/usr/bin/env bash
set -euo pipefail

# These fixtures cover the CI collector's Docker lifecycle decisions, not container behavior.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d)"
cleanup() {
  local status=$?
  if (( status != 0 )); then
    cat "${test_dir}/output" >&2 || true
  fi
  rm -rf "${test_dir}"
  return "${status}"
}
trap cleanup EXIT
mkdir "${test_dir}/bin"

cat >"${test_dir}/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >>"${TEST_CALLS}"
case "$1" in
  run)
    if [[ "${*: -1}" == "summarize-logs" ]]; then
      cat
    fi
    ;;
  inspect)
    if [[ "$*" == *'{{.State.Running}}'* ]]; then
      if [[ "${TEST_SCENARIO}" == "stopped" || -f "${TEST_CALLS}.invalid-edge" ]]; then
        printf 'false\n'
      else
        printf 'true\n'
      fi
    else
      printf '%s\n' "${TEST_EXIT_CODE:-0}"
    fi
    ;;
  exec)
    [[ " $* " == *' -e MOMO_POSTDEPLOY_PUBLIC_EDGE=deferred '* ]] || {
      echo "Startup probe attempted to use the deployed public edge." >&2
      touch "${TEST_CALLS}.invalid-edge"
      exit 1
    }
    if [[ "${TEST_SCENARIO}" == "retry" && ! -f "${TEST_CALLS}.retried" ]]; then
      touch "${TEST_CALLS}.retried"
      exit 1
    fi
    ;;
  logs)
    printf '%s\n' '{"message":"momo_result_api_stopping"}'
    if [[ "${TEST_SCENARIO}" == "supervisor-failure" ]]; then
      printf '%s\n' '{"event":"runtime_serve","status":"failed"}'
    fi
    ;;
  stop) ;;
  *) exit 2 ;;
esac
EOF
cat >"${test_dir}/bin/sleep" <<'EOF'
#!/usr/bin/env bash
printf 'sleep\n' >>"${TEST_CALLS}"
EOF
chmod +x "${test_dir}/bin/docker" "${test_dir}/bin/sleep"

export PATH="${test_dir}/bin:${PATH}"
export TEST_CALLS="${test_dir}/calls"
export IMAGE_REF=ci-runtime-test
export DATABASE_URL=ci-database DEV_MEMBER_IDS=ci-member REDIS_URL=ci-redis
export MOMO_ORIGIN_LOCK_TOKEN=ci-token

run_probe() {
  : >"${TEST_CALLS}"
  "$@" >"${test_dir}/output" 2>&1
}

assert_rejected() {
  local reason="$1"
  shift
  if run_probe "$@"; then
    echo "Runtime lifecycle collector accepted ${reason}." >&2
    exit 1
  fi
}

TEST_SCENARIO=retry run_probe "${repo_root}/scripts/ci/start-runtime-container.sh"
grep -Fxq sleep "${TEST_CALLS}"

TEST_SCENARIO=stopped assert_rejected "an exited startup container" \
  "${repo_root}/scripts/ci/start-runtime-container.sh"
if grep -Eq '^(exec|sleep)$' "${TEST_CALLS}"; then
  echo "Startup collector kept retrying an exited container." >&2
  exit 1
fi
grep -Fxq logs "${TEST_CALLS}"

TEST_SCENARIO=running run_probe "${repo_root}/scripts/ci/runtime-shutdown-smoke.sh"
TEST_SCENARIO=stopped assert_rejected "an already stopped container" \
  "${repo_root}/scripts/ci/runtime-shutdown-smoke.sh"
if grep -Fxq stop "${TEST_CALLS}"; then
  echo "Shutdown collector attempted to stop an inactive container." >&2
  exit 1
fi
TEST_SCENARIO=running TEST_EXIT_CODE=137 assert_rejected "a killed container" \
  "${repo_root}/scripts/ci/runtime-shutdown-smoke.sh"
TEST_SCENARIO=supervisor-failure assert_rejected "a failed supervisor shutdown" \
  "${repo_root}/scripts/ci/runtime-shutdown-smoke.sh"

echo "Runtime lifecycle collector tests passed."
