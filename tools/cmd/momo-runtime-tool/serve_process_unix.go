//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

func configureChildProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func signalChildProcessGroup(command *exec.Cmd, signal syscall.Signal) error {
	if command.Process == nil {
		return nil
	}
	return syscall.Kill(-command.Process.Pid, signal)
}
