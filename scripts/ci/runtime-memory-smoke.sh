#!/usr/bin/env bash
set -euo pipefail

container_name="${RUNTIME_CONTAINER_NAME:-momo-result-runtime}"
base_url="${APP_BASE_URL:-http://127.0.0.1:8080}"
canonical_host="${MOMO_CANONICAL_HOST:-momo-result.ponta.me}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"
dev_account="${DEV_ACCOUNT_ID:-account_ponta}"
request_count="${RUNTIME_MEMORY_REQUEST_COUNT:-2400}"
concurrency="${RUNTIME_MEMORY_CONCURRENCY:-12}"
expected_limit_bytes="${RUNTIME_EXPECTED_MEMORY_LIMIT_BYTES:-536870912}"
maximum_peak_bytes="${RUNTIME_MAX_MEMORY_PEAK_BYTES:-402653184}"

for value in \
  "${request_count}" \
  "${concurrency}" \
  "${expected_limit_bytes}" \
  "${maximum_peak_bytes}"; do
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Runtime memory smoke settings must be positive integers." >&2
    exit 1
  fi
done

seq 1 "${request_count}" | xargs -P "${concurrency}" -I __MOMO_REQUEST__ \
  curl -fsS \
    --connect-timeout 2 \
    --max-time 5 \
    -o /dev/null \
    -H "Host: ${canonical_host}" \
    -H "X-Momo-Origin-Lock: ${origin_lock_token}" \
    -H "X-Momo-Account-Id: ${dev_account}" \
    -H "X-Momo-Memory-Probe: __MOMO_REQUEST__" \
    "${base_url}/api/held-events"

cgroup_version="$(
  docker exec "${container_name}" /bin/sh -ec '
    if test -r /sys/fs/cgroup/memory.max && test -r /sys/fs/cgroup/memory.peak; then
      printf "2"
    elif test -r /sys/fs/cgroup/memory/memory.limit_in_bytes &&
      test -r /sys/fs/cgroup/memory/memory.max_usage_in_bytes; then
      printf "1"
    else
      exit 1
    fi
  '
)"

if [[ "${cgroup_version}" == "2" ]]; then
  actual_limit_bytes="$(docker exec "${container_name}" cat /sys/fs/cgroup/memory.max)"
  actual_peak_bytes="$(docker exec "${container_name}" cat /sys/fs/cgroup/memory.peak)"
  limit_event_count="$(
    docker exec "${container_name}" /bin/sh -ec \
      "awk '\$1 == \"max\" || \$1 == \"oom\" || \$1 == \"oom_kill\" { total += \$2 } END { print total + 0 }' /sys/fs/cgroup/memory.events"
  )"
else
  actual_limit_bytes="$(docker exec "${container_name}" cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
  actual_peak_bytes="$(docker exec "${container_name}" cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes)"
  limit_event_count="$(docker exec "${container_name}" cat /sys/fs/cgroup/memory/memory.failcnt)"
fi

for value in "${actual_limit_bytes}" "${actual_peak_bytes}" "${limit_event_count}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
    echo "Runtime cgroup memory counters were not numeric." >&2
    exit 1
  fi
done

if (( actual_limit_bytes != expected_limit_bytes )); then
  echo "Runtime container did not use the expected memory hard limit." >&2
  exit 1
fi
if (( limit_event_count != 0 )); then
  echo "Runtime container reached its cgroup memory limit." >&2
  exit 1
fi
if (( actual_peak_bytes > maximum_peak_bytes )); then
  echo "Runtime container did not retain the required memory headroom." >&2
  exit 1
fi

echo "Runtime memory headroom smoke passed."
