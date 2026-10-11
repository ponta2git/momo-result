package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSnapshot(t *testing.T) {
	root := t.TempDir()
	write := func(name, value string) {
		t.Helper()
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("cgroup/cgroup.procs", "101\n101\n102\n103\n999\n")
	write("cgroup/memory.limit_in_bytes", "1073741824\n")
	write("cgroup/memory.usage_in_bytes", "524288000\n")
	write("cgroup/memory.stat", "cache 104857600\nrss 419430400\n")
	write("cgroup/memory.failcnt", "0\n")
	write("proc/101/comm", "java worker\n")
	write("proc/101/status", "Uid:\t10001\t10001\t10001\t10001\nVmSize: 900000 kB\nVmRSS: 400000 kB\nVmHWM: 410000 kB\nThreads: 24\n")
	write("proc/101/smaps_rollup", "Rss: 405000 kB\nPss: 390000 kB\nPss_Anon: 360000 kB\nPss_File: 30000 kB\nPss_Shmem: 0 kB\nPrivate_Clean: 5000 kB\nPrivate_Dirty: 355000 kB\nSwap: 0 kB\n")
	write("proc/101/cmdline", "must-not-appear-secret-token")
	write("proc/102/comm", "large\\worker\n")
	write("proc/102/status", "Uid: 10002\nVmSize: 4294967296 kB\nVmRSS: invalid kB\nThreads: 2\n")
	write("proc/103/comm", "broken\n")
	write("proc/103/status", "Uid: 10003\n")
	if err := os.Mkdir(filepath.Join(root, "proc/103/smaps_rollup"), 0700); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := snapshot(&out, filepath.Join(root, "proc"), filepath.Join(root, "cgroup")); err != nil {
		t.Fatal(err)
	}
	output := out.String()
	for _, want := range []string{
		"meta\tschema_version\t2\n", "cgroup\tusage_begin_bytes\t524288000\n", "cgroup\tmemory_failcnt\t0\n",
		"process\t101\t10001\tjava_worker\t900000\t400000\t410000\t24\t405000\t390000\t360000\t30000\t0\t5000\t355000\t0\n",
		"process\t102\t10002\tlarge\\worker\t4294967296\tNA\tNA\t2\tNA\tNA\tNA\tNA\tNA\tNA\tNA\tNA\n",
	} {
		if strings.Count(output, want) != 1 {
			t.Errorf("expected one %q in %s", want, output)
		}
	}
	for _, forbidden := range []string{"process\t103\t", "process\t999\t", "must-not-appear-secret-token"} {
		if strings.Contains(output, forbidden) {
			t.Errorf("unexpected %q", forbidden)
		}
	}
	write("cgroup/memory.usage_in_bytes", "invalid\n")
	out.Reset()
	if err := snapshot(&out, filepath.Join(root, "proc"), filepath.Join(root, "cgroup")); err == nil || out.Len() != 0 {
		t.Fatalf("invalid required counter produced err=%v output=%q", err, out.String())
	}
}
