package main

import (
	"bytes"
	"testing"
)

func TestValidateOptionsAcceptsCoordinatorContract(t *testing.T) {
	t.Parallel()
	opts := options{
		mode:            modeCoordinator,
		cgroupRoot:      "/sys/fs/cgroup/memory",
		limitBytes:      64 * 1024 * 1024,
		allocationBytes: 128 * 1024 * 1024,
		workerUID:       10001,
		workerGID:       10001,
	}
	if err := validateOptions(opts); err != nil {
		t.Fatalf("valid coordinator options were rejected: %v", err)
	}
}

func TestValidateOptionsRejectsAllocationAtLimit(t *testing.T) {
	t.Parallel()
	opts := options{
		mode:            modeCoordinator,
		cgroupRoot:      "/sys/fs/cgroup/memory",
		limitBytes:      64 * 1024 * 1024,
		allocationBytes: 64 * 1024 * 1024,
		workerUID:       10001,
		workerGID:       10001,
	}
	if err := validateOptions(opts); err == nil {
		t.Fatal("allocation at the cgroup limit must be rejected")
	}
}

func TestRunRejectsUnknownModeBeforePlatformDispatch(t *testing.T) {
	t.Parallel()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := run([]string{
		"--mode", "unknown",
		"--limit-bytes", "67108864",
		"--allocation-bytes", "134217728",
	}, &stdout, &stderr)
	if exitCode != 2 {
		t.Fatalf("unexpected exit code: got %d want 2", exitCode)
	}
	if stdout.Len() != 0 {
		t.Fatalf("invalid options must not emit a probe report: %q", stdout.String())
	}
}
