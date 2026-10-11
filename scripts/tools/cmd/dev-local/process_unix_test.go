//go:build unix

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestStopReapsChildAndTerminatesDescendants(t *testing.T) {
	dir := t.TempDir()
	// The background process ignores TERM, so stopping only its shell parent
	// would leave it running. The readiness file prevents a startup race.
	c, err := start("sh", []string{"-c", `(trap '' TERM; while :; do sleep 10; done) & echo $! > child.pid; wait`}, dir, os.Environ())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { signalProcess(c.cmd, syscall.SIGKILL) })
	var pid int
	deadline := time.After(3 * time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for pid == 0 {
		if data, err := os.ReadFile(filepath.Join(dir, "child.pid")); err == nil {
			pid, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		}
		select {
		case <-deadline:
			t.Fatal("child did not start")
		case <-ticker.C:
		}
	}
	stop(c)
	select {
	case <-c.done:
	default:
		t.Fatal("child not reaped")
	}
	// kill(0) can still see a short-lived zombie until the OS adopts/reaps it.
	deadline = time.After(3 * time.Second)
	for syscall.Kill(pid, 0) == nil {
		select {
		case <-deadline:
			t.Fatal("descendant survived shutdown")
		case <-ticker.C:
		}
	}
}
