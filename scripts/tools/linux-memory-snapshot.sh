#!/usr/bin/env sh
set -eu

# A zero-install cgroup v1 collector. Memory fields from /proc are KiB; memory.stat keeps the
# kernel's per-key units (bytes or counters). See linux-memory-snapshot.md for measurement limits.
# Command lines and process environments are never read.
export LC_ALL=C
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
  awk '
    NR == 1 && NF == 1 && $1 ~ /^[0-9]+$/ { value = $1; next }
    { invalid = 1 }
    END {
      if (invalid || value == "") exit 1
      print value
    }
  ' "$1"
}

started_epoch="$(date -u +%s)"
# Keep required reads outside printf: a failed command substitution must fail the collector.
usage_begin="$(read_number "${cgroup_root}/memory.usage_in_bytes")"
limit="$(read_number "${cgroup_root}/memory.limit_in_bytes")"
pids="$(sort -nu "${cgroup_root}/cgroup.procs")"
printf 'meta\tschema_version\t2\n'
printf 'meta\tstarted_at_utc\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'cgroup\tusage_begin_bytes\t%s\n' "${usage_begin}"
printf 'cgroup\tlimit_bytes\t%s\n' "${limit}"

for optional_name in memory.max_usage_in_bytes memory.failcnt
do
  optional_path="${cgroup_root}/${optional_name}"
  if [ -r "${optional_path}" ]; then
    key="$(printf '%s' "${optional_name}" | tr . _)"
    value="$(read_number "${optional_path}")"
    printf 'cgroup\t%s\t%s\n' "${key}" "${value}"
  fi
done

awk '
  NF == 2 && $2 ~ /^[0-9]+$/ { printf "cgroup_stat\t%s\t%s\n", $1, $2 }
' "${cgroup_root}/memory.stat"

printf 'process_header\tpid\tuid\tcomm\tvm_size_kib\tvm_rss_kib\tvm_hwm_kib\tthreads\trss_kib\tpss_kib\tpss_anon_kib\tpss_file_kib\tpss_shmem_kib\tprivate_clean_kib\tprivate_dirty_kib\tswap_kib\n'

printf '%s\n' "${pids}" | while IFS= read -r pid
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
  # Buffer the row: awk may run END even after a file-read failure. Such partial output must
  # never escape as a measurement. An unavailable smaps_rollup is distinct from measured zero.
  row="$(PROCESS_COMM="${comm}" awk -v pid="${pid}" -v status_path="${status_path}" '
    BEGIN {
      uid = vm_size = vm_rss = vm_hwm = threads = "NA"
      rss = pss = pss_anon = pss_file = pss_shmem = private_clean = private_dirty = swap = "NA"
      comm = ENVIRON["PROCESS_COMM"]
    }
    function numeric_value(raw, unit) {
      return raw ~ /^[0-9]+$/ && (unit == "" || unit == "kB") ? raw : "NA"
    }
    FILENAME == status_path && $1 == "Uid:" { uid = numeric_value($2); next }
    FILENAME == status_path && $1 == "VmSize:" { vm_size = numeric_value($2, $3); next }
    FILENAME == status_path && $1 == "VmRSS:" { vm_rss = numeric_value($2, $3); next }
    FILENAME == status_path && $1 == "VmHWM:" { vm_hwm = numeric_value($2, $3); next }
    FILENAME == status_path && $1 == "Threads:" { threads = numeric_value($2); next }
    FILENAME != status_path && $1 == "Rss:" { rss = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Pss:" { pss = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Pss_Anon:" { pss_anon = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Pss_File:" { pss_file = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Pss_Shmem:" { pss_shmem = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Private_Clean:" { private_clean = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Private_Dirty:" { private_dirty = numeric_value($2, $3); next }
    FILENAME != status_path && $1 == "Swap:" { swap = numeric_value($2, $3); next }
    END {
      if (uid == "NA") exit 1
      gsub(/[[:space:]]+/, "_", comm)
      printf "process\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", \
        pid, uid, comm, vm_size, vm_rss, vm_hwm, threads, rss, pss, pss_anon, \
        pss_file, pss_shmem, private_clean, private_dirty, swap
    }
  ' "${status_path}" "${rollup_input}" 2>/dev/null)" || continue
  printf '%s\n' "${row}"
done

usage_end="$(read_number "${cgroup_root}/memory.usage_in_bytes")"
printf 'cgroup\tusage_end_bytes\t%s\n' "${usage_end}"
finished_epoch="$(date -u +%s)"
printf 'meta\tduration_seconds\t%s\n' "$((finished_epoch - started_epoch))"
