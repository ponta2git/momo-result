//go:build !unix

package main

import (
	"os/exec"
	"syscall"
)

func configureProcess(cmd *exec.Cmd) {}
func signalProcess(cmd *exec.Cmd, signal syscall.Signal) {
	if signal == syscall.SIGKILL {
		_ = cmd.Process.Kill()
	} else {
		_ = cmd.Process.Signal(signal)
	}
}
