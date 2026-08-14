#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:?analysis worker image reference is required}"
primary_binary="/usr/local/bin/momo-processing-worker"
compatibility_binary="/usr/local/bin/momo-analysis"
runtime_memory_limit="256m"
child_memory_limit_bytes="134217728"
probe_allocation_bytes="268435456"
maximum_unpacked_image_bytes="150994944"

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

docker run --rm --entrypoint "${primary_binary}" "${image_ref}" --version
docker run --rm --entrypoint "${compatibility_binary}" "${image_ref}" --version

if ! docker run --rm --entrypoint sh "${image_ref}" -c \
  'test -L /usr/local/bin/momo-analysis'
then
  echo "analysis worker compatibility path must be a symbolic link" >&2
  exit 1
fi
compatibility_target="$(
  docker run --rm --entrypoint /momo-toolbox/readlink \
    "${image_ref}" "${compatibility_binary}"
)"
if [[ "${compatibility_target}" != "momo-processing-worker" ]]; then
  echo "analysis worker compatibility link must use the relative primary binary target" >&2
  exit 1
fi
resolved_compatibility_target="$(
  docker run --rm --entrypoint /momo-toolbox/readlink \
    "${image_ref}" -f "${compatibility_binary}"
)"
if [[ "${resolved_compatibility_target}" != "${primary_binary}" ]]; then
  echo "analysis worker compatibility link does not resolve to the primary binary" >&2
  exit 1
fi

configured_user="$(docker inspect --format '{{.Config.User}}' "${image_ref}")"
if [[ "${configured_user}" != "0:0" ]]; then
  echo "analysis worker image must enter through the fixed root cgroup bootstrap" >&2
  exit 1
fi

configured_command="$(docker inspect --format '{{json .Config.Cmd}}' "${image_ref}")"
expected_command='["/usr/local/bin/momo-processing-worker","bootstrap","--","worker"]'
if [[ "${configured_command}" != "${expected_command}" ]]; then
  echo "analysis worker image must drop privileges through the fixed worker bootstrap" >&2
  exit 1
fi

configured_working_directory="$(docker inspect --format '{{.Config.WorkingDir}}' "${image_ref}")"
if [[ "${configured_working_directory}" != "/var/lib/momo-analysis" ]]; then
  echo "analysis worker image must start in its private state directory" >&2
  exit 1
fi

exposed_ports="$(docker inspect --format '{{json .Config.ExposedPorts}}' "${image_ref}")"
if [[ "${exposed_ports}" != "null" ]]; then
  echo "analysis worker image must not expose a network service" >&2
  exit 1
fi

docker run --rm --user 10001:10001 --entrypoint sh "${image_ref}" -c '
  set -eu

  fail() {
    echo "analysis worker runtime probe failed: $1" >&2
    exit 1
  }

  test "$(id -u)" = 10001 || fail "unexpected uid"
  test "$(id -g)" = 10001 || fail "unexpected gid"
  test "$(id -un)" = momo || fail "unexpected user name"
  test "$(id -gn)" = momo || fail "unexpected group name"
  test "$(pwd)" = /var/lib/momo-analysis || fail "unexpected working directory"
  test "$(getent passwd 10001)" = "momo:x:10001:10001::/nonexistent:/sbin/nologin" \
    || fail "service passwd entry is missing or malformed"
  test "$(getent group 10001)" = "momo:x:10001:" \
    || fail "service group entry is missing or malformed"
  getent passwd nonroot >/dev/null || fail "base nonroot passwd entry is missing"
  getent group nonroot >/dev/null || fail "base nonroot group entry is missing"
  test -r /etc/ssl/certs/ca-certificates.crt || fail "CA bundle is unreadable"
  test -w /var/lib/momo-analysis || fail "state directory is not writable"
  state_directory_mode="$(stat -c %a /var/lib/momo-analysis)"
  test "${state_directory_mode}" = 700 \
    || fail "state directory permissions are ${state_directory_mode}; expected 0700"

  for tool in \
    sh ps free pgrep top pmap ip netstat nc getent openssl \
    df du find stat cat grep sed awk tail head date sha256sum
  do
    command -v "${tool}" >/dev/null || fail "required tool is missing: ${tool}"
  done

  for excluded in \
    apt apt-get apk dpkg psql redis-cli strace tcpdump gdb \
    ash bash busybox chmod chown cp curl install ln mkdir mknod mount mv rm rmdir tar wget \
    python python3 pip pip3 uv
  do
    if command -v "${excluded}" >/dev/null 2>&1; then
      echo "unexpected runtime tool: ${excluded}" >&2
      exit 1
    fi
  done

  shell_checksum="$(sha256sum /momo-toolbox/sh | awk "{print \$1}")"
  toolbox_checksum="$(sha256sum /momo-toolbox/.momo-tool | awk "{print \$1}")"
  test "${shell_checksum}" != "${toolbox_checksum}" \
    || fail "runtime shell must be distinct from the BusyBox toolbox"
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

  getent hosts localhost >/dev/null || fail "localhost lookup failed"
  openssl version >/dev/null || fail "OpenSSL probe failed"
  ps -o pid,ppid,rss,vsz,stat,comm,args >/dev/null || fail "ps probe failed"
  free >/dev/null || fail "free probe failed"
  top -b -n 1 >/dev/null || fail "top probe failed"
  pmap $$ >/dev/null || fail "pmap probe failed"
  ip addr show >/dev/null || fail "IP address probe failed"
  ip route show >/dev/null || fail "IP route probe failed"
  netstat -lnt >/dev/null || fail "socket probe failed"
  df -P /var/lib/momo-analysis >/dev/null || fail "filesystem probe failed"
  du -s /var/lib/momo-analysis >/dev/null || fail "disk usage probe failed"
  test -r /proc/1/status || fail "/proc/1/status is unreadable"
  test -r /proc/1/limits || fail "/proc/1/limits is unreadable"
  if test -r /sys/fs/cgroup/memory.current; then
    cat /sys/fs/cgroup/memory.current >/dev/null || fail "memory.current is unreadable"
    cat /sys/fs/cgroup/memory.events >/dev/null || fail "memory.events is unreadable"
  elif test -r /sys/fs/cgroup/memory/memory.usage_in_bytes; then
    cat /sys/fs/cgroup/memory/memory.usage_in_bytes >/dev/null \
      || fail "memory.usage_in_bytes is unreadable"
  else
    echo "container memory accounting is unavailable" >&2
    exit 1
  fi
'

docker run --rm --user 10002:10002 --entrypoint sh "${image_ref}" -c '
  set -eu
  test ! -r /var/lib/momo-analysis
  test ! -w /var/lib/momo-analysis
  test ! -x /var/lib/momo-analysis
'

if ! special_mode_files="$(docker run --rm --user 0:0 --entrypoint sh "${image_ref}" -c '
  find / -xdev -type f -perm /6000 -print 2>/dev/null
')"; then
  echo "analysis worker special-mode file scan failed" >&2
  exit 1
fi
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

docker run --rm --privileged --cgroupns private \
  --memory "${runtime_memory_limit}" --memory-swap "${runtime_memory_limit}" \
  --env "MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES=${child_memory_limit_bytes}" \
  --env MOMO_HEAVY_CGROUP_V2_VALIDATED=true \
  "${image_ref}" \
  "${primary_binary}" bootstrap -- probe-cgroup-limit \
  --allocation-bytes "${probe_allocation_bytes}" \
  --timeout-ms 10000

docker run --rm --privileged --cgroupns private \
  --memory "${runtime_memory_limit}" --memory-swap "${runtime_memory_limit}" \
  --env "MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES=${child_memory_limit_bytes}" \
  --env MOMO_HEAVY_CGROUP_V2_VALIDATED=true \
  "${image_ref}" \
  "${primary_binary}" bootstrap -- probe-ocr-child-lifecycle \
  --timeout-ms 10000 \
  --stop-grace-ms 1000

docker run --rm --user 10001:10001 --entrypoint sh "${image_ref}" -c '
  set -eu
  child_file=/tmp/analysis-child-pid
  /usr/local/bin/momo-processing-worker probe-parent-death >"${child_file}" &
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
