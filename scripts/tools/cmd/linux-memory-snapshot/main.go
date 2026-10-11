// linux-memory-snapshot collects cgroup v1 and process memory counters without
// reading command lines or process environments. Build a static Linux binary
// for hosts without Go installed; see ../../linux-memory-snapshot.md.
package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

func main() {
	proc, cgroup := os.Getenv("PROC_ROOT"), os.Getenv("CGROUP_MEMORY_ROOT")
	if proc == "" {
		proc = "/proc"
	}
	if cgroup == "" {
		cgroup = "/sys/fs/cgroup/memory"
	}
	if err := snapshot(os.Stdout, proc, cgroup); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func digits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func number(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(data))
	if !digits(value) {
		return "", fmt.Errorf("invalid cgroup counter: %s", filepath.Base(path))
	}
	return value, nil
}

func snapshot(out io.Writer, proc, cgroup string) error {
	started := time.Now()
	// Buffer until every required read succeeds. A failed snapshot must not look
	// like a successful partial measurement to downstream consumers.
	var result bytes.Buffer
	row := func(kind, key, value string) { fmt.Fprintf(&result, "%s\t%s\t%s\n", kind, key, value) }
	row("meta", "schema_version", "2")
	row("meta", "started_at_utc", started.UTC().Format(time.RFC3339))
	for _, field := range []struct{ file, key string }{
		{"memory.usage_in_bytes", "usage_begin_bytes"}, {"memory.limit_in_bytes", "limit_bytes"},
		{"memory.max_usage_in_bytes", "memory_max_usage_in_bytes"}, {"memory.failcnt", "memory_failcnt"},
	} {
		value, err := number(filepath.Join(cgroup, field.file))
		if err != nil {
			if (field.file == "memory.max_usage_in_bytes" || field.file == "memory.failcnt") && (os.IsNotExist(err) || os.IsPermission(err)) {
				continue
			}
			return err
		}
		row("cgroup", field.key, value)
	}
	stat, err := os.ReadFile(filepath.Join(cgroup, "memory.stat"))
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(stat), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && digits(fields[1]) {
			row("cgroup_stat", fields[0], fields[1])
		}
	}
	pidData, err := os.ReadFile(filepath.Join(cgroup, "cgroup.procs"))
	if err != nil {
		return err
	}
	pids := map[int]bool{}
	for _, line := range strings.Fields(string(pidData)) {
		pid, err := strconv.Atoi(line)
		if err == nil && pid > 0 {
			pids[pid] = true
		}
	}
	ordered := make([]int, 0, len(pids))
	for pid := range pids {
		ordered = append(ordered, pid)
	}
	sort.Ints(ordered)
	fmt.Fprintln(&result, "process_header\tpid\tuid\tcomm\tvm_size_kib\tvm_rss_kib\tvm_hwm_kib\tthreads\trss_kib\tpss_kib\tpss_anon_kib\tpss_file_kib\tpss_shmem_kib\tprivate_clean_kib\tprivate_dirty_kib\tswap_kib")
	for _, pid := range ordered {
		if values := processRow(filepath.Join(proc, strconv.Itoa(pid)), pid); values != nil {
			fmt.Fprintln(&result, strings.Join(values, "\t"))
		}
	}
	end, err := number(filepath.Join(cgroup, "memory.usage_in_bytes"))
	if err != nil {
		return err
	}
	row("cgroup", "usage_end_bytes", end)
	row("meta", "duration_seconds", strconv.FormatInt(int64(time.Since(started)/time.Second), 10))
	_, err = out.Write(result.Bytes())
	return err
}

func processRow(dir string, pid int) []string {
	status, err := os.ReadFile(filepath.Join(dir, "status"))
	if err != nil {
		return nil
	}
	comm, err := os.ReadFile(filepath.Join(dir, "comm"))
	if err != nil {
		return nil
	}
	rollup, err := os.ReadFile(filepath.Join(dir, "smaps_rollup"))
	if err != nil && !os.IsNotExist(err) && !os.IsPermission(err) {
		return nil
	}
	fields := func(data []byte) map[string][]string {
		result := map[string][]string{}
		for _, line := range strings.Split(string(data), "\n") {
			key, value, found := strings.Cut(line, ":")
			if found {
				result[key] = strings.Fields(value)
			}
		}
		return result
	}
	statusFields, rollupFields := fields(status), fields(rollup)
	value := func(fields map[string][]string, key string, memory bool) string {
		parts := fields[key]
		if len(parts) == 0 || !digits(parts[0]) {
			return "NA"
		}
		if memory && (len(parts) != 2 || parts[1] != "kB") {
			return "NA"
		}
		return parts[0]
	}
	uid := value(statusFields, "Uid", false)
	if uid == "NA" {
		return nil
	}
	values := []string{"process", strconv.Itoa(pid), uid, strings.Join(strings.Fields(string(comm)), "_")}
	for _, key := range []string{"VmSize", "VmRSS", "VmHWM", "Threads"} {
		values = append(values, value(statusFields, key, key != "Threads"))
	}
	for _, key := range []string{"Rss", "Pss", "Pss_Anon", "Pss_File", "Pss_Shmem", "Private_Clean", "Private_Dirty", "Swap"} {
		values = append(values, value(rollupFields, key, true))
	}
	return values
}
