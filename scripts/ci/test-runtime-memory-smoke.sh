#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
probe="${repo_root}/scripts/ci/runtime-memory-smoke.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

mkdir -p "${test_dir}/bin"

cat >"${test_dir}/bin/curl" <<'EOF'
#!/usr/bin/env bash
exit "${FAKE_CURL_EXIT:-0}"
EOF

cat >"${test_dir}/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

path="${*: -1}"
case "${path}" in
  *memory.max_usage_in_bytes)
    printf '%s\n' "${FAKE_MEMORY_PEAK:-300000000}"
    ;;
  *memory.limit_in_bytes | *memory.max)
    printf '%s\n' "${FAKE_MEMORY_LIMIT:-536870912}"
    ;;
  *memory.peak)
    printf '%s\n' "${FAKE_MEMORY_PEAK:-300000000}"
    ;;
  *memory.failcnt)
    printf '%s\n' "${FAKE_MEMORY_EVENTS:-0}"
    ;;
  *memory.events)
    printf '%s\n' "${FAKE_MEMORY_EVENTS:-0}"
    ;;
  *)
    printf '%s' "${FAKE_CGROUP_VERSION:-2}"
    ;;
esac
EOF

chmod +x "${test_dir}/bin/curl" "${test_dir}/bin/docker"

run_probe() {
  PATH="${test_dir}/bin:${PATH}" \
    MOMO_ORIGIN_LOCK_TOKEN=test-token \
    RUNTIME_MEMORY_REQUEST_COUNT=2 \
    RUNTIME_MEMORY_CONCURRENCY=2 \
    "${probe}" >/dev/null 2>&1
}

FAKE_CGROUP_VERSION=2 run_probe
FAKE_CGROUP_VERSION=1 run_probe

assert_rejected() {
  local name="$1"
  shift
  if env "$@" bash -c "$(declare -f run_probe); run_probe" >/dev/null 2>&1; then
    echo "Runtime memory smoke accepted an invalid case: ${name}" >&2
    exit 1
  fi
}

export test_dir PATH probe
assert_rejected unexpected-limit FAKE_MEMORY_LIMIT=268435456
assert_rejected headroom-exhausted FAKE_MEMORY_PEAK=402653185
assert_rejected cgroup-limit-event FAKE_MEMORY_EVENTS=1
assert_rejected request-failure FAKE_CURL_EXIT=1

echo "Runtime memory smoke tests passed."
