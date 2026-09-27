//go:build !darwin && !linux

package main

import "os"

func maximumResidentBytes(_ *os.ProcessState) *uint64 {
	return nil
}
