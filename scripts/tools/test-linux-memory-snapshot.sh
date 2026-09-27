#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/momo-memory-snapshot.XXXXXX")"
cleanup() {
  rm -rf "${fixture_root}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

proc_root="${fixture_root}/proc"
cgroup_root="${fixture_root}/cgroup"
mkdir -p "${proc_root}/101" "${proc_root}/102" "${proc_root}/103" "${cgroup_root}" "${fixture_root}/bin"

cat > "${cgroup_root}/cgroup.procs" <<'EOF'
101
101
102
103
999
EOF
cat > "${cgroup_root}/memory.limit_in_bytes" <<'EOF'
1073741824
EOF
cat > "${cgroup_root}/memory.usage_in_bytes" <<'EOF'
524288000
EOF
cat > "${cgroup_root}/memory.max_usage_in_bytes" <<'EOF'
734003200
EOF
cat > "${cgroup_root}/memory.failcnt" <<'EOF'
0
EOF
cat > "${cgroup_root}/memory.stat" <<'EOF'
cache 104857600
rss 419430400
EOF
cat > "${proc_root}/101/comm" <<'EOF'
java worker
EOF
cat > "${proc_root}/101/status" <<'EOF'
Name:	java
Uid:	10001	10001	10001	10001
VmSize:	900000 kB
VmHWM:	410000 kB
VmRSS:	400000 kB
Threads:	24
EOF
cat > "${proc_root}/101/smaps_rollup" <<'EOF'
Rss:              405000 kB
Pss:              390000 kB
Pss_Anon:         360000 kB
Pss_File:          30000 kB
Pss_Shmem:             0 kB
Private_Clean:      5000 kB
Private_Dirty:    355000 kB
Swap:                  0 kB
EOF
cat > "${proc_root}/101/cmdline" <<'EOF'
must-not-appear-secret-token
EOF
cat > "${proc_root}/102/comm" <<'EOF'
large\worker
EOF
cat > "${proc_root}/102/status" <<'EOF'
Uid:	10002	10002	10002	10002
VmSize:	4294967296 kB
VmRSS:	invalid kB
Threads:	2
EOF
cp "${proc_root}/101/comm" "${proc_root}/103/comm"
cp "${proc_root}/101/status" "${proc_root}/103/status"
cp "${proc_root}/101/smaps_rollup" "${proc_root}/103/smaps_rollup"
# Remove one process file after the collector checks readability, before the real awk opens it.
cat > "${fixture_root}/bin/awk" <<'EOF'
#!/usr/bin/env sh
for arg do
  if [ "${arg}" = "${SNAPSHOT_TEST_ROLLUP}" ]; then
    rm -f "${arg}"
  fi
done
exec "${SNAPSHOT_TEST_AWK}" "$@"
EOF
chmod +x "${fixture_root}/bin/awk"

output="$(SNAPSHOT_TEST_AWK="$(command -v awk)" SNAPSHOT_TEST_ROLLUP="${proc_root}/103/smaps_rollup" \
  PATH="${fixture_root}/bin:${PATH}" PROC_ROOT="${proc_root}" CGROUP_MEMORY_ROOT="${cgroup_root}" \
  "${script_dir}/linux-memory-snapshot.sh")"

expected_process='process	101	10001	java_worker	900000	400000	410000	24	405000	390000	360000	30000	0	5000	355000	0'
if [ "$(printf '%s\n' "${output}" | grep -Fxc "${expected_process}")" != 1 ]; then
  echo "process memory row did not match the fixture" >&2
  exit 1
fi
expected_unavailable='process	102	10002	large\worker	4294967296	NA	NA	2	NA	NA	NA	NA	NA	NA	NA	NA'
if ! printf '%s\n' "${output}" | grep -Fx "${expected_unavailable}" >/dev/null; then
  echo "missing measurements or large memory values were misreported" >&2
  exit 1
fi
if printf '%s\n' "${output}" | grep -F "$(printf 'process\t103\t')" >/dev/null; then
  echo "collector emitted a partial row after a process file read failed" >&2
  exit 1
fi
if ! printf '%s\n' "${output}" | grep -Fx "$(printf 'meta\tschema_version\t2')" >/dev/null; then
  echo "collector did not identify the missing-value-aware schema" >&2
  exit 1
fi
if ! printf '%s\n' "${output}" | grep -F "$(printf 'cgroup\tusage_begin_bytes\t524288000')" >/dev/null; then
  echo "cgroup usage was not captured" >&2
  exit 1
fi
if printf '%s\n' "${output}" | grep -F 'must-not-appear-secret-token' >/dev/null; then
  echo "collector leaked process command-line content" >&2
  exit 1
fi
if printf '%s\n' "${output}" | grep -F "$(printf 'process\t999\t')" >/dev/null; then
  echo "collector emitted a process that vanished during the snapshot" >&2
  exit 1
fi

printf 'invalid\n' > "${cgroup_root}/memory.usage_in_bytes"
if PROC_ROOT="${proc_root}" CGROUP_MEMORY_ROOT="${cgroup_root}" \
  "${script_dir}/linux-memory-snapshot.sh" > /dev/null 2>&1; then
  echo "collector accepted a missing required cgroup measurement" >&2
  exit 1
fi

echo "linux memory snapshot fixture passed"
