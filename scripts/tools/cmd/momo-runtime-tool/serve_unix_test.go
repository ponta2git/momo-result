//go:build unix

package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestSupervisorReapsStubbornProcessOnShutdown(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready, finished, output := startTestSupervisor(t, ctx, "stubborn")
	pid := awaitChildReady(t, ready, "stubborn")
	cancel()
	awaitSupervisorExit(t, finished, 1)
	if !strings.Contains(output.String(), `"errorClass":"ShutdownTimeout"`) {
		t.Fatalf("missing shutdown failure: %s", output.String())
	}
	if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("child was not reaped: %v", err)
	}
}

func TestSupervisorStopsDescendantsOfExitedLeader(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready, finished, output := startTestSupervisor(t, ctx, "parent")
	parent := awaitChildReady(t, ready, "parent")
	descendant := awaitChildReady(t, ready, "stubborn")
	if err := syscall.Kill(parent, syscall.SIGUSR1); err != nil {
		t.Fatal(err)
	}
	awaitSupervisorExit(t, finished, 1)
	if !strings.Contains(output.String(), `"errorClass":"ChildExited"`) {
		t.Fatalf("missing child failure: %s", output.String())
	}
	// An orphan may briefly be a zombie until the OS's adopter reaps it.
	deadline := time.Now().Add(5 * time.Second)
	for {
		if errors.Is(syscall.Kill(descendant, 0), syscall.ESRCH) {
			break
		}
		status, err := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(descendant)).Output()
		if err == nil && strings.HasPrefix(strings.TrimSpace(string(status)), "Z") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("descendant outlived the exited leader's process group")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type childReady struct {
	mode string
	pid  int
}

func startTestSupervisor(t *testing.T, ctx context.Context, mode string) (<-chan childReady, <-chan int, *bytes.Buffer) {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	t.Cleanup(func() { _ = writer.Close() })
	ready := make(chan childReady, 2)
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var child childReady
			if _, err := fmt.Sscanf(scanner.Text(), "ready %s %d", &child.mode, &child.pid); err == nil {
				ready <- child
			}
		}
	}()
	var stderr bytes.Buffer
	finished := make(chan int, 1)
	go func() {
		finished <- superviseChildren(ctx, []childSpec{{
			Name: "test-child", Command: os.Args[0], Arguments: runtimeChildArguments(mode),
		}}, 100*time.Millisecond, writer, &stderr)
		close(finished)
	}()
	t.Cleanup(func() {
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("supervisor did not finish during test cleanup")
		}
	})
	return ready, finished, &stderr
}

func awaitChildReady(t *testing.T, ready <-chan childReady, mode string) int {
	t.Helper()
	select {
	case child := <-ready:
		if child.mode != mode {
			t.Fatalf("child mode=%q, want %q", child.mode, mode)
		}
		t.Cleanup(func() { _ = syscall.Kill(child.pid, syscall.SIGKILL) })
		return child.pid
	case <-time.After(5 * time.Second):
		t.Fatal("child did not become ready")
		return 0
	}
}

func awaitSupervisorExit(t *testing.T, finished <-chan int, expected int) {
	t.Helper()
	select {
	case actual := <-finished:
		if actual != expected {
			t.Fatalf("supervisor exit=%d, want %d", actual, expected)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("supervisor did not finish")
	}
}

func runtimeChildArguments(mode string) []string {
	return []string{"-test.run=^TestRuntimeChildProcess$", "--", mode}
}

func TestRuntimeChildProcess(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "--" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	if mode == "stubborn" {
		signal.Ignore(syscall.SIGTERM)
		fmt.Printf("ready stubborn %d\n", os.Getpid())
		time.Sleep(time.Hour)
		os.Exit(0)
	}
	if mode == "parent" {
		exit := make(chan os.Signal, 1)
		signal.Notify(exit, syscall.SIGUSR1)
		fmt.Printf("ready parent %d\n", os.Getpid())
		child := exec.Command(os.Args[0], runtimeChildArguments("stubborn")...)
		child.Stdout = os.Stdout
		child.Stderr = os.Stderr
		if err := child.Start(); err != nil {
			os.Exit(2)
		}
		<-exit
		os.Exit(0)
	}
	os.Exit(2)
}
