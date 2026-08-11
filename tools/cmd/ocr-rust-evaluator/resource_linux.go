//go:build linux

package main

import (
	"math"
	"os"
	"syscall"
)

func maximumResidentBytes(state *os.ProcessState) *uint64 {
	if state == nil {
		return nil
	}
	usage, ok := state.SysUsage().(*syscall.Rusage)
	if !ok || usage.Maxrss < 0 || uint64(usage.Maxrss) > math.MaxUint64/1024 {
		return nil
	}
	value := uint64(usage.Maxrss) * 1024
	return &value
}
