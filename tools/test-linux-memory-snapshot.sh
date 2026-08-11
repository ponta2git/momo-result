#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/momo-memory-snapshot.XXXXXX")"
cleanup() {
  rm -rf "${fixture_root}"
}
trap cleanup EXIT HUP INT TERM

proc_root="${fixture_root}/proc"
cgroup_root="${fixture_root}/cgroup"
mkdir -p "${proc_root}/101" "${cgroup_root}"

cat > "${cgroup_root}/cgroup.procs" <<'EOF'
101
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

output="$(PROC_ROOT="${proc_root}" CGROUP_MEMORY_ROOT="${cgroup_root}" \
  "${script_dir}/linux-memory-snapshot.sh")"

expected_process='process	101	10001	java_worker	900000	400000	410000	24	405000	390000	360000	30000	0	5000	355000	0'
if ! printf '%s\n' "${output}" | grep -F "$(printf '%b' "${expected_process}")" >/dev/null; then
  echo "process memory row did not match the fixture" >&2
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

echo "linux memory snapshot fixture passed"
