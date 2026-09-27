//go:build !darwin && !linux

package main

import "os/exec"

func isolatePilot(command *exec.Cmd) func() {
	return func() {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
	}
}
