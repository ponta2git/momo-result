//go:build linux

package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if readyPath := os.Getenv("MOMO_CGROUP_PROBE_TEST_READY"); readyPath != "" {
		if len(os.Args) > 2 && os.Args[1] == "--mode" && os.Args[2] == modeAllocator {
			ready, err := os.OpenFile(readyPath, os.O_WRONLY, 0)
			if err != nil {
				os.Exit(2)
			}
			_, _ = fmt.Fprintln(ready, os.Getpid(), os.Getppid())
			_ = ready.Close()
			// This child deliberately outlives its parent unless the cancellation kills the group.
			time.Sleep(time.Hour)
			os.Exit(0)
		}
		os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
	}
	os.Exit(m.Run())
}

func TestAllocatorRequiresExplicitAttachmentRelease(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		release []byte
		wantErr bool
	}{
		{name: "launcher closed before attachment", wantErr: true},
		{name: "invalid release", release: []byte{0}, wantErr: true},
		{name: "attached", release: []byte{allocatorStart}},
	} {
		t.Run(test.name, func(t *testing.T) {
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
			fd, err := syscall.Dup(int(reader.Fd()))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := writer.Write(test.release); err != nil {
				t.Fatal(err)
			}
			_ = writer.Close()
			err = runAllocator(options{startFD: fd, allocationBytes: 8192})
			if (err != nil) != test.wantErr {
				t.Fatalf("allocator error = %v, want error = %v", err, test.wantErr)
			}
		})
	}
}

func TestLauncherCompletionStopsAllocator(t *testing.T) {
	for _, cause := range []string{"cancellation", "launcher exit"} {
		t.Run(cause, func(t *testing.T) {
			// Uses an ordinary directory, never a real cgroup; the helper child allocates no memory.
			root := t.TempDir()
			readyPath := filepath.Join(root, "ready")
			if err := os.WriteFile(filepath.Join(root, "cgroup.procs"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := syscall.Mkfifo(readyPath, 0o600); err != nil {
				t.Fatal(err)
			}
			ready, err := os.OpenFile(readyPath, os.O_RDWR|syscall.O_NONBLOCK, 0)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = ready.Close() })
			if err := ready.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			t.Setenv("MOMO_CGROUP_PROBE_TEST_READY", readyPath)
			ctx, cancel := context.WithCancel(context.Background())
			completed := make(chan error, 1)
			t.Cleanup(func() {
				cancel()
				select {
				case <-completed:
				case <-time.After(5 * time.Second):
					t.Error("launcher cleanup did not finish")
				}
			})
			go func() {
				defer close(completed)
				_, err := executeLauncher(ctx, options{
					workerUID: uint(os.Getuid()), workerGID: uint(os.Getgid()),
					limitBytes: 4096, allocationBytes: 8192,
				}, root)
				completed <- err
			}()
			line, err := bufio.NewReader(ready).ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			var pid, launcherPID int
			if _, err := fmt.Sscanf(line, "%d %d", &pid, &launcherPID); err != nil {
				t.Fatal(err)
			}
			allocator, err := os.FindProcess(pid)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = allocator.Kill(); _ = allocator.Release() })
			select {
			case err := <-completed:
				t.Fatalf("launcher exited before the test interruption: %v", err)
			default:
			}
			if cause == "cancellation" {
				cancel()
			} else if err := syscall.Kill(launcherPID, syscall.SIGKILL); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-completed:
				if err == nil {
					t.Fatal("interrupted experiment must not report success")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("launcher did not stop after interruption")
			}
			// A killed orphan may remain a zombie until init reaps it; it must stop running.
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			tick := time.NewTicker(time.Millisecond)
			defer tick.Stop()
			for {
				status, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
				if os.IsNotExist(err) || (err == nil && (strings.Contains(string(status), "State:\tZ") || strings.Contains(string(status), "State:\tX"))) {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				select {
				case <-deadline.C:
					t.Fatalf("allocator %d survived launcher %s", pid, cause)
				case <-tick.C:
				}
			}
		})
	}
}

func TestMemoryControllerRejectsOrdinaryDirectory(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "memory.limit_in_bytes"), []byte("4096\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := requireMemoryController(root); err == nil {
		t.Fatal("ordinary files must not be accepted as a memory controller")
	}
}

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
