#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:?analysis worker image reference is required}"
runtime_memory_limit="256m"
child_memory_limit_bytes="134217728"
probe_allocation_bytes="402653184"
maximum_unpacked_image_bytes="100663296"

unpacked_image_bytes="$(docker history --no-trunc --format '{{.Size}}' "${image_ref}" | awk '
  function multiplier(unit) {
    if (unit == "B") return 1
    if (unit == "kB") return 1000
    if (unit == "MB") return 1000000
    if (unit == "GB") return 1000000000
    return 0
  }
  {
    unit = $0
    gsub(/[0-9.]/, "", unit)
    value = $0
    sub(/[[:alpha:]]+$/, "", value)
    factor = multiplier(unit)
    if (factor == 0 || value !~ /^[0-9]+([.][0-9]+)?$/) {
      invalid = 1
      next
    }
    total += value * factor
  }
  END {
    if (invalid) exit 2
    printf "%.0f\n", total
  }
')"
if [[ ! "${unpacked_image_bytes}" =~ ^[0-9]+$ \
  || "${unpacked_image_bytes}" -gt "${maximum_unpacked_image_bytes}" ]]
then
  echo "analysis worker image exceeds the bounded unpacked layer budget" >&2
  exit 1
fi

docker run --rm --entrypoint /usr/local/bin/momo-analysis "${image_ref}" --version

configured_user="$(docker inspect --format '{{.Config.User}}' "${image_ref}")"
if [[ "${configured_user}" != "10001:10001" ]]; then
  echo "analysis worker image must run as 10001:10001" >&2
  exit 1
fi

exposed_ports="$(docker inspect --format '{{json .Config.ExposedPorts}}' "${image_ref}")"
if [[ "${exposed_ports}" != "null" ]]; then
  echo "analysis worker image must not expose a network service" >&2
  exit 1
fi

docker run --rm --entrypoint sh "${image_ref}" -c '
  set -eu
  test "$(id -u)" = 10001
  test "$(id -g)" = 10001
  test -r /etc/ssl/certs/ca-certificates.crt
  test -w /var/lib/momo-analysis
  test "$(stat -c %a /var/lib/momo-analysis)" = 700

  for tool in \
    sh ps free pgrep top pmap ip netstat nc getent openssl \
    df du find stat cat grep sed awk tail head date sha256sum
  do
    command -v "${tool}" >/dev/null
  done

  for excluded in \
    apt apt-get apk dpkg psql redis-cli strace tcpdump gdb \
    ash bash busybox chmod chown cp curl install ln mkdir mknod mount mv rm rmdir tar wget
  do
    if command -v "${excluded}" >/dev/null 2>&1; then
      echo "unexpected runtime tool: ${excluded}" >&2
      exit 1
    fi
  done

  test "$(stat -c %i /momo-toolbox/sh)" != "$(stat -c %i /momo-toolbox/.momo-tool)"
  if /momo-toolbox/.momo-tool dpkg >/dev/null 2>&1; then
    hidden_applet_status=0
  else
    hidden_applet_status=$?
  fi
  if test "${hidden_applet_status}" != 127; then
    echo "hidden toolbox executable dispatched an unsupported applet" >&2
    exit 1
  fi
  if sh -c "exec -a busybox /momo-toolbox/.momo-tool dpkg" >/dev/null 2>&1; then
    argv_override_status=0
  else
    argv_override_status=$?
  fi
  if test "${argv_override_status}" != 127; then
    echo "runtime shell can bypass the supported toolbox inventory" >&2
    exit 1
  fi

  getent hosts localhost >/dev/null
  openssl version >/dev/null
  ps -o pid,ppid,rss,vsz,stat,comm,args >/dev/null
  free >/dev/null
  top -b -n 1 >/dev/null
  pmap $$ >/dev/null
  ip addr show >/dev/null
  ip route show >/dev/null
  netstat -lnt >/dev/null
  df -P /var/lib/momo-analysis >/dev/null
  du -s /var/lib/momo-analysis >/dev/null
  test -r /proc/1/status
  test -r /proc/1/limits
  if test -r /sys/fs/cgroup/memory.current; then
    cat /sys/fs/cgroup/memory.current >/dev/null
    cat /sys/fs/cgroup/memory.events >/dev/null
  elif test -r /sys/fs/cgroup/memory/memory.usage_in_bytes; then
    cat /sys/fs/cgroup/memory/memory.usage_in_bytes >/dev/null
  else
    echo "container memory accounting is unavailable" >&2
    exit 1
  fi
'

special_mode_files="$(docker run --rm --user 0:0 --entrypoint sh "${image_ref}" -c '
  find / -xdev -type f -perm /6000 -print 2>/dev/null
')"
if [[ -n "${special_mode_files}" ]]; then
  echo "analysis worker image contains setuid or setgid executables" >&2
  exit 1
fi

if docker run --rm \
  --env MOMO_ANALYSIS_PUBLICATION_MODE=enabled \
  "${image_ref}"; then
  echo "publication must fail closed when bounded runtime settings are incomplete" >&2
  exit 1
fi

docker run --rm --memory "${runtime_memory_limit}" --memory-swap "${runtime_memory_limit}" \
  --entrypoint /usr/local/bin/momo-analysis \
  "${image_ref}" \
  probe-hard-limit \
  --limit-bytes "${child_memory_limit_bytes}" \
  --allocation-bytes "${probe_allocation_bytes}" \
  --timeout-ms 10000

docker run --rm --entrypoint sh "${image_ref}" -c '
  set -eu
  child_file=/tmp/analysis-child-pid
  /usr/local/bin/momo-analysis probe-parent-death >"${child_file}" &
  parent_pid=$!
  attempts=0
  while [ ! -s "${child_file}" ] && [ "${attempts}" -lt 100 ]; do
    attempts=$((attempts + 1))
    sleep 0.05
  done
  child_pid="$(sed -n "1p" "${child_file}")"
  test -n "${child_pid}"
  kill -KILL "${parent_pid}"
  wait "${parent_pid}" 2>/dev/null || true
  attempts=0
  while [ "${attempts}" -lt 100 ]; do
    if [ ! -e "/proc/${child_pid}/stat" ]; then
      exit 0
    fi
    child_state="$(awk "{print \$3}" "/proc/${child_pid}/stat")"
    if [ "${child_state}" = Z ]; then
      exit 0
    fi
    attempts=$((attempts + 1))
    sleep 0.05
  done
  echo "analysis child remained alive after its parent was killed" >&2
  exit 1
'
