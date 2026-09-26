//go:build linux

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	cgroupNamePrefix = "momo-cgroup-probe-"
	probeTimeout     = 30 * time.Second
	allocatorStart   = byte(1)
)

func runCoordinator(opts options) (report probeReport) {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	report = probeReport{
		SchemaVersion:       1,
		Hierarchy:           "cgroup_v1_memory",
		AttachmentInterface: "cgroup.procs",
		LimitBytesRequested: opts.limitBytes,
		AllocationBytes:     opts.allocationBytes,
	}
	if os.Geteuid() != 0 {
		report.Failure = "coordinator_requires_root"
		return report
	}
	if err := requireMemoryController(opts.cgroupRoot); err != nil {
		report.Failure = "cgroup_v1_memory_controller_unavailable"
		return report
	}

	cgroupPath := filepath.Join(opts.cgroupRoot, cgroupNamePrefix+strconv.Itoa(os.Getpid()))
	created := false
	defer func() {
		if !created {
			return
		}
		switch ctx.Err() {
		case context.DeadlineExceeded:
			report.Failure = "probe_timed_out"
		case context.Canceled:
			report.Failure = "probe_interrupted"
		}
		if err := os.Remove(cgroupPath); err != nil {
			report.CleanupSucceeded = false
			if report.Failure == "" {
				report.Failure = "cgroup_cleanup_failed"
			}
			return
		}
		report.CleanupSucceeded = true
		report.Passed = report.Failure == "" && report.LimitBytesReadBack > 0 &&
			report.LimitBytesReadBack <= opts.limitBytes &&
			report.DelegationWritable &&
			report.ChildAttached &&
			report.ParentSurvived &&
			report.ChildSignal != nil && *report.ChildSignal == int(syscall.SIGKILL) &&
			report.LimitFailureCountDelta > 0 &&
			report.OOMKillCountDelta > 0
		if !report.Passed && report.Failure == "" {
			report.Failure = "hard_limit_evidence_incomplete"
		}
	}()

	if err := os.Mkdir(cgroupPath, 0o755); err != nil {
		report.Failure = "cgroup_create_failed"
		return report
	}
	created = true
	if err := writeControllerValue(filepath.Join(cgroupPath, "memory.limit_in_bytes"), opts.limitBytes); err != nil {
		report.Failure = "cgroup_limit_write_failed"
		return report
	}
	limitReadBack, err := readUintFile(filepath.Join(cgroupPath, "memory.limit_in_bytes"))
	if err != nil {
		report.Failure = "cgroup_limit_readback_failed"
		return report
	}
	report.LimitBytesReadBack = limitReadBack
	// Reject an ineffective or rounded-up limit before exposing the host to the allocation.
	if limitReadBack == 0 || limitReadBack > opts.limitBytes {
		report.Failure = "cgroup_limit_not_enforced"
		return report
	}

	failCountBefore, err := readUintFile(filepath.Join(cgroupPath, "memory.failcnt"))
	if err != nil {
		report.Failure = "cgroup_fail_count_read_failed"
		return report
	}
	oomKillsBefore, err := readOOMKillCount(filepath.Join(cgroupPath, "memory.oom_control"))
	if err != nil {
		report.Failure = "cgroup_oom_count_read_failed"
		return report
	}

	processesPath := filepath.Join(cgroupPath, "cgroup.procs")
	if err := os.Chown(processesPath, int(opts.workerUID), int(opts.workerGID)); err != nil {
		report.Failure = "cgroup_delegation_failed"
		return report
	}

	launcher, err := executeLauncher(ctx, opts, cgroupPath)
	if err != nil {
		report.Failure = "non_root_launcher_failed"
		return report
	}
	report.DelegationWritable = launcher.DelegationWritable
	report.ChildAttached = launcher.ChildAttached
	report.ChildExitCode = launcher.ChildExitCode
	report.ChildSignal = launcher.ChildSignal
	report.ParentSurvived = launcher.ParentSurvived

	failCountAfter, err := readUintFile(filepath.Join(cgroupPath, "memory.failcnt"))
	if err != nil {
		report.Failure = "cgroup_fail_count_read_failed"
		return report
	}
	oomKillsAfter, err := readOOMKillCount(filepath.Join(cgroupPath, "memory.oom_control"))
	if err != nil {
		report.Failure = "cgroup_oom_count_read_failed"
		return report
	}
	maximumUsage, err := readUintFile(filepath.Join(cgroupPath, "memory.max_usage_in_bytes"))
	if err != nil {
		report.Failure = "cgroup_maximum_usage_read_failed"
		return report
	}
	report.LimitFailureCountDelta = saturatingDelta(failCountAfter, failCountBefore)
	report.OOMKillCountDelta = saturatingDelta(oomKillsAfter, oomKillsBefore)
	report.MaximumUsageBytes = maximumUsage
	return report
}

func executeLauncher(ctx context.Context, opts options, cgroupPath string) (launcherResult, error) {
	executable, err := os.Executable()
	if err != nil {
		return launcherResult{}, fmt.Errorf("resolve executable: %w", err)
	}
	command := exec.CommandContext(
		ctx,
		executable,
		"--mode", modeLauncher,
		"--cgroup-path", cgroupPath,
		"--limit-bytes", strconv.FormatUint(opts.limitBytes, 10),
		"--allocation-bytes", strconv.FormatUint(opts.allocationBytes, 10),
	)
	command.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
		Credential: &syscall.Credential{
			Uid: uint32(opts.workerUID),
			Gid: uint32(opts.workerGID),
		},
	}
	// The allocator inherits this dedicated process group. Killing only the launcher on a
	// deadline or signal would leave its allocation running and prevent cgroup removal.
	command.Cancel = func() error {
		err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	defer func() {
		// The launcher can fail before the context does. Run returning is not evidence that
		// its allocator exited, so retire the owned group on every completion path.
		if command.Process != nil {
			_ = command.Cancel()
		}
	}()
	command.WaitDelay = time.Second
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return launcherResult{}, fmt.Errorf("run delegated launcher: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	var result launcherResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return launcherResult{}, fmt.Errorf("decode launcher report: %w", err)
	}
	return result, nil
}

func runLauncher(opts options) (launcherResult, error) {
	result := launcherResult{}
	executable, err := os.Executable()
	if err != nil {
		return result, fmt.Errorf("resolve executable: %w", err)
	}
	startReader, startWriter, err := os.Pipe()
	if err != nil {
		return result, fmt.Errorf("create synchronization pipe: %w", err)
	}
	defer startWriter.Close()

	command := exec.Command(
		executable,
		"--mode", modeAllocator,
		"--limit-bytes", strconv.FormatUint(opts.limitBytes, 10),
		"--allocation-bytes", strconv.FormatUint(opts.allocationBytes, 10),
		"--start-fd", "3",
	)
	command.ExtraFiles = []*os.File{startReader}
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		startReader.Close()
		return result, fmt.Errorf("start allocator: %w", err)
	}
	startReader.Close()
	reaped := false
	defer func() {
		if reaped {
			return
		}
		_ = command.Process.Kill()
		_ = command.Wait()
	}()

	// cgroup.procs moves the complete thread group. Writing only to the v1 `tasks` file would
	// constrain one thread and can produce a false pass for a multithreaded native workload.
	processesPath := filepath.Join(opts.cgroupPath, "cgroup.procs")
	if err := os.WriteFile(processesPath, []byte(strconv.Itoa(command.Process.Pid)), 0o200); err != nil {
		return result, fmt.Errorf("attach allocator to delegated cgroup: %w", err)
	}
	result.DelegationWritable = true
	attached, err := fileContainsPID(processesPath, command.Process.Pid)
	if err != nil {
		return result, fmt.Errorf("verify allocator attachment: %w", err)
	}
	result.ChildAttached = attached
	if !attached {
		return result, errors.New("allocator was not present in delegated cgroup")
	}
	if _, err := startWriter.Write([]byte{allocatorStart}); err != nil {
		return result, fmt.Errorf("release allocator: %w", err)
	}

	waitErr := command.Wait()
	reaped = true
	result.ParentSurvived = true
	waitStatus, ok := command.ProcessState.Sys().(syscall.WaitStatus)
	if !ok {
		return result, errors.New("allocator wait status was unavailable")
	}
	if waitStatus.Signaled() {
		signal := int(waitStatus.Signal())
		result.ChildSignal = &signal
		return result, nil
	}
	exitCode := command.ProcessState.ExitCode()
	result.ChildExitCode = &exitCode
	if waitErr != nil {
		return result, fmt.Errorf("allocator exited unexpectedly: %w", waitErr)
	}
	return result, nil
}

func runAllocator(opts options) error {
	start := os.NewFile(uintptr(opts.startFD), "probe-start")
	if start == nil {
		return errors.New("synchronization descriptor was unavailable")
	}
	defer start.Close()
	var signal [1]byte
	if _, err := io.ReadFull(start, signal[:]); err != nil {
		return fmt.Errorf("wait for cgroup attachment: %w", err)
	}
	if signal[0] != allocatorStart {
		return errors.New("allocator was not released by the launcher")
	}
	length, err := strconv.Atoi(strconv.FormatUint(opts.allocationBytes, 10))
	if err != nil {
		return fmt.Errorf("allocation exceeds addressable memory: %w", err)
	}
	memory := make([]byte, length)
	pageSize := os.Getpagesize()
	for offset := 0; offset < len(memory); offset += pageSize {
		memory[offset] = 1
	}
	runtime.KeepAlive(memory)
	return nil
}

func requireMemoryController(root string) error {
	var filesystem syscall.Statfs_t
	if err := syscall.Statfs(root, &filesystem); err != nil {
		return err
	}
	// CGROUP_SUPER_MAGIC from Linux uapi/linux/magic.h; excludes v2 and ordinary directories.
	if filesystem.Type != 0x27e0eb {
		return errors.New("controller path is not on a cgroup v1 filesystem")
	}
	info, err := os.Stat(filepath.Join(root, "memory.limit_in_bytes"))
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("controller path is not a regular virtual file")
	}
	return nil
}

func writeControllerValue(path string, value uint64) error {
	return os.WriteFile(path, []byte(strconv.FormatUint(value, 10)), 0o600)
}

func readUintFile(path string) (uint64, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64)
}

func readOOMKillCount(path string) (uint64, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "oom_kill" {
			return strconv.ParseUint(fields[1], 10, 64)
		}
	}
	return 0, errors.New("oom_kill counter was absent")
}

func fileContainsPID(path string, pid int) (bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	wanted := strconv.Itoa(pid)
	for _, field := range strings.Fields(string(raw)) {
		if field == wanted {
			return true, nil
		}
	}
	return false, nil
}

func saturatingDelta(after, before uint64) uint64 {
	if after < before {
		return 0
	}
	return after - before
}
