//go:build !unix

package main

import (
	"os/exec"
	"syscall"
)

func configureChildProcess(command *exec.Cmd) {}

func signalChildProcessGroup(command *exec.Cmd, signal syscall.Signal) error {
	if command.Process == nil {
		return nil
	}
	return command.Process.Signal(signal)
}
