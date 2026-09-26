//go:build darwin

package main

import (
	"os"
	"syscall"
)

func maximumResidentBytes(state *os.ProcessState) *uint64 {
	if state == nil {
		return nil
	}
	usage, ok := state.SysUsage().(*syscall.Rusage)
	if !ok || usage.Maxrss < 0 {
		return nil
	}
	value := uint64(usage.Maxrss)
	return &value
}
