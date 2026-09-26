//go:build linux

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOOMKillCount(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "memory.oom_control")
	if err := os.WriteFile(path, []byte("oom_kill_disable 0\nunder_oom 0\noom_kill 7\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	count, err := readOOMKillCount(path)
	if err != nil {
		t.Fatalf("readOOMKillCount returned an error: %v", err)
	}
	if count != 7 {
		t.Fatalf("unexpected OOM count: got %d want 7", count)
	}
}

func TestFileContainsPIDMatchesWholeLines(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "cgroup.procs")
	if err := os.WriteFile(path, []byte("12\n312\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	present, err := fileContainsPID(path, 12)
	if err != nil {
		t.Fatalf("fileContainsPID returned an error: %v", err)
	}
	if !present {
		t.Fatal("expected exact PID to be present")
	}
	present, err = fileContainsPID(path, 2)
	if err != nil {
		t.Fatalf("fileContainsPID returned an error: %v", err)
	}
	if present {
		t.Fatal("PID substring must not be treated as a match")
	}
}

func TestSaturatingDelta(t *testing.T) {
	t.Parallel()
	if got := saturatingDelta(9, 4); got != 5 {
		t.Fatalf("unexpected delta: got %d want 5", got)
	}
	if got := saturatingDelta(4, 9); got != 0 {
		t.Fatalf("counter reset must saturate at zero: got %d", got)
	}
}
