#!/usr/bin/env sh
set -eu

# A zero-install Linux collector for short-lived production diagnostics. Values from /proc are KiB;
# cgroup controller values are bytes. Command lines and process environments are never read.
proc_root="${PROC_ROOT:-/proc}"
cgroup_root="${CGROUP_MEMORY_ROOT:-/sys/fs/cgroup/memory}"

for required in \
  "${cgroup_root}/cgroup.procs" \
  "${cgroup_root}/memory.limit_in_bytes" \
  "${cgroup_root}/memory.stat" \
  "${cgroup_root}/memory.usage_in_bytes"
do
  if [ ! -r "${required}" ]; then
    echo "required cgroup v1 file is unreadable" >&2
    exit 1
  fi
done

read_number() {
  awk 'NR == 1 { print $1; exit }' "$1"
}

started_epoch="$(date -u +%s)"
printf 'meta\tschema_version\t1\n'
printf 'meta\tstarted_at_utc\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'cgroup\tusage_begin_bytes\t%s\n' \
  "$(read_number "${cgroup_root}/memory.usage_in_bytes")"
printf 'cgroup\tlimit_bytes\t%s\n' \
  "$(read_number "${cgroup_root}/memory.limit_in_bytes")"

for optional_name in memory.max_usage_in_bytes memory.failcnt
do
  optional_path="${cgroup_root}/${optional_name}"
  if [ -r "${optional_path}" ]; then
    key="$(printf '%s' "${optional_name}" | tr . _)"
    printf 'cgroup\t%s\t%s\n' "${key}" "$(read_number "${optional_path}")"
  fi
done

awk '
  NF == 2 && $2 ~ /^[0-9]+$/ { printf "cgroup_stat\t%s\t%s\n", $1, $2 }
' "${cgroup_root}/memory.stat"

printf 'process_header\tpid\tuid\tcomm\tvm_size_kib\tvm_rss_kib\tvm_hwm_kib\tthreads\trss_kib\tpss_kib\tpss_anon_kib\tpss_file_kib\tpss_shmem_kib\tprivate_clean_kib\tprivate_dirty_kib\tswap_kib\n'

sort -n "${cgroup_root}/cgroup.procs" | while IFS= read -r pid
do
  case "${pid}" in
    ''|*[!0-9]*) continue ;;
  esac
  status_path="${proc_root}/${pid}/status"
  comm_path="${proc_root}/${pid}/comm"
  rollup_path="${proc_root}/${pid}/smaps_rollup"
  if [ ! -r "${status_path}" ] || [ ! -r "${comm_path}" ]; then
    continue
  fi
  IFS= read -r comm < "${comm_path}" || continue
  rollup_input=/dev/null
  if [ -r "${rollup_path}" ]; then
    rollup_input="${rollup_path}"
  fi
  # Processes used by the SSH diagnostic can exit between the readability check and awk opening
  # the files. Skip only that vanished PID; a /proc race must not discard the cgroup snapshot.
  awk -v pid="${pid}" -v comm="${comm}" -v status_path="${status_path}" '
    function numeric_value(raw) {
      gsub(/[^0-9]/, "", raw)
      return raw == "" ? 0 : raw
    }
    FILENAME == status_path && $1 == "Uid:" { uid = $2; next }
    FILENAME == status_path && $1 == "VmSize:" { vm_size = numeric_value($2); next }
    FILENAME == status_path && $1 == "VmRSS:" { vm_rss = numeric_value($2); next }
    FILENAME == status_path && $1 == "VmHWM:" { vm_hwm = numeric_value($2); next }
    FILENAME == status_path && $1 == "Threads:" { threads = numeric_value($2); next }
    FILENAME != status_path && $1 == "Rss:" { rss = numeric_value($2); next }
    FILENAME != status_path && $1 == "Pss:" { pss = numeric_value($2); next }
    FILENAME != status_path && $1 == "Pss_Anon:" { pss_anon = numeric_value($2); next }
    FILENAME != status_path && $1 == "Pss_File:" { pss_file = numeric_value($2); next }
    FILENAME != status_path && $1 == "Pss_Shmem:" { pss_shmem = numeric_value($2); next }
    FILENAME != status_path && $1 == "Private_Clean:" { private_clean = numeric_value($2); next }
    FILENAME != status_path && $1 == "Private_Dirty:" { private_dirty = numeric_value($2); next }
    FILENAME != status_path && $1 == "Swap:" { swap = numeric_value($2); next }
    END {
      gsub(/[[:space:]]+/, "_", comm)
      printf "process\t%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n", \
        pid, uid, comm, vm_size, vm_rss, vm_hwm, threads, rss, pss, pss_anon, \
        pss_file, pss_shmem, private_clean, private_dirty, swap
    }
  ' "${status_path}" "${rollup_input}" 2>/dev/null || continue
done

printf 'cgroup\tusage_end_bytes\t%s\n' \
  "$(read_number "${cgroup_root}/memory.usage_in_bytes")"
finished_epoch="$(date -u +%s)"
printf 'meta\tduration_seconds\t%s\n' "$((finished_epoch - started_epoch))"
