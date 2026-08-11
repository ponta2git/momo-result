//go:build !linux

package main

import "errors"

func runCoordinator(opts options) probeReport {
	return probeReport{
		SchemaVersion:       1,
		Hierarchy:           "unsupported",
		AttachmentInterface: "unsupported",
		LimitBytesRequested: opts.limitBytes,
		AllocationBytes:     opts.allocationBytes,
		Failure:             "linux_required",
	}
}

func runLauncher(options) (launcherResult, error) {
	return launcherResult{}, errors.New("Linux is required")
}

func runAllocator(options) error {
	return errors.New("Linux is required")
}
