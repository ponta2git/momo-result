// cgroup-memory-probe verifies delegated cgroup memory isolation without placing the
// coordinating process inside the constrained cgroup.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
)

const (
	modeCoordinator = "coordinator"
	modeLauncher    = "launcher"
	modeAllocator   = "allocator"
)

type options struct {
	mode            string
	cgroupRoot      string
	cgroupPath      string
	limitBytes      uint64
	allocationBytes uint64
	workerUID       uint
	workerGID       uint
	startFD         int
}

type launcherResult struct {
	DelegationWritable bool `json:"delegationWritable"`
	ChildAttached      bool `json:"childAttached"`
	ChildExitCode      *int `json:"childExitCode"`
	ChildSignal        *int `json:"childSignal"`
	ParentSurvived     bool `json:"parentSurvived"`
}

type probeReport struct {
	SchemaVersion          int    `json:"schemaVersion"`
	Hierarchy              string `json:"hierarchy"`
	AttachmentInterface    string `json:"attachmentInterface"`
	LimitBytesRequested    uint64 `json:"limitBytesRequested"`
	LimitBytesReadBack     uint64 `json:"limitBytesReadBack"`
	AllocationBytes        uint64 `json:"allocationBytes"`
	DelegationWritable     bool   `json:"delegationWritable"`
	ChildAttached          bool   `json:"childAttached"`
	ChildExitCode          *int   `json:"childExitCode"`
	ChildSignal            *int   `json:"childSignal"`
	ParentSurvived         bool   `json:"parentSurvived"`
	LimitFailureCountDelta uint64 `json:"limitFailureCountDelta"`
	OOMKillCountDelta      uint64 `json:"oomKillCountDelta"`
	MaximumUsageBytes      uint64 `json:"maximumUsageBytes"`
	CleanupSucceeded       bool   `json:"cleanupSucceeded"`
	Passed                 bool   `json:"passed"`
	Failure                string `json:"failure,omitempty"`
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	opts, err := parseOptions(args, stderr)
	if err != nil {
		return 2
	}
	if err := validateOptions(opts); err != nil {
		_, _ = fmt.Fprintf(stderr, "invalid probe configuration: %v\n", err)
		return 2
	}

	switch opts.mode {
	case modeCoordinator:
		report := runCoordinator(opts)
		if err := json.NewEncoder(stdout).Encode(report); err != nil {
			_, _ = fmt.Fprintf(stderr, "failed to encode probe report: %v\n", err)
			return 1
		}
		if report.Passed {
			return 0
		}
		return 1
	case modeLauncher:
		result, err := runLauncher(opts)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "launcher failed: %v\n", err)
			return 1
		}
		if err := json.NewEncoder(stdout).Encode(result); err != nil {
			_, _ = fmt.Fprintf(stderr, "failed to encode launcher report: %v\n", err)
			return 1
		}
		return 0
	case modeAllocator:
		if err := runAllocator(opts); err != nil {
			_, _ = fmt.Fprintf(stderr, "allocator failed: %v\n", err)
			return 1
		}
		return 0
	default:
		_, _ = fmt.Fprintf(stderr, "unsupported probe mode: %s\n", opts.mode)
		return 2
	}
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	var opts options
	flags := flag.NewFlagSet("cgroup-memory-probe", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&opts.mode, "mode", modeCoordinator, "probe mode")
	flags.StringVar(
		&opts.cgroupRoot,
		"cgroup-root",
		"/sys/fs/cgroup/memory",
		"cgroup v1 memory-controller mount",
	)
	flags.StringVar(&opts.cgroupPath, "cgroup-path", "", "internal delegated cgroup path")
	flags.Uint64Var(&opts.limitBytes, "limit-bytes", 0, "child cgroup hard limit")
	flags.Uint64Var(&opts.allocationBytes, "allocation-bytes", 0, "bytes touched by the child")
	flags.UintVar(&opts.workerUID, "worker-uid", 0, "non-root launcher UID")
	flags.UintVar(&opts.workerGID, "worker-gid", 0, "non-root launcher GID")
	flags.IntVar(&opts.startFD, "start-fd", -1, "internal allocator synchronization FD")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	if flags.NArg() != 0 {
		return options{}, errors.New("positional arguments are not supported")
	}
	return opts, nil
}

func validateOptions(opts options) error {
	if opts.limitBytes == 0 {
		return errors.New("limit-bytes must be positive")
	}
	if opts.allocationBytes <= opts.limitBytes {
		return errors.New("allocation-bytes must exceed limit-bytes")
	}
	switch opts.mode {
	case modeCoordinator:
		if opts.workerUID == 0 || opts.workerGID == 0 {
			return errors.New("worker UID and GID must be non-zero")
		}
		if uint64(opts.workerUID) > uint64(^uint32(0)) ||
			uint64(opts.workerGID) > uint64(^uint32(0)) {
			return errors.New("worker UID and GID must fit Linux credentials")
		}
		if opts.cgroupRoot == "" {
			return errors.New("cgroup-root must not be empty")
		}
	case modeLauncher:
		if opts.cgroupPath == "" {
			return errors.New("cgroup-path must not be empty in launcher mode")
		}
	case modeAllocator:
		if opts.startFD < 3 {
			return errors.New("start-fd must be an inherited descriptor")
		}
	default:
		return errors.New("mode must be coordinator, launcher, or allocator")
	}
	return nil
}
