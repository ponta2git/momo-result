//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

func configureProcess(cmd *exec.Cmd)                     { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func signalProcess(cmd *exec.Cmd, signal syscall.Signal) { _ = syscall.Kill(-cmd.Process.Pid, signal) }
