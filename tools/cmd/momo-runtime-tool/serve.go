package main

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

const (
	serveEvent               = "runtime_serve"
	defaultAPICommand        = "/opt/java/openjdk/bin/java"
	defaultNginxCommand      = "/usr/sbin/nginx"
	defaultAPIDirectory      = "/opt/momo-result/api"
	defaultStopGrace         = 30 * time.Second
	maximumStopGrace         = 90 * time.Second
	stopGraceEnvironmentName = "MOMO_RUNTIME_STOP_GRACE_SECONDS"
)

var runtimeDirectories = []string{
	"/tmp/momo-result/nginx/client_body",
	"/tmp/momo-result/nginx/fastcgi",
	"/tmp/momo-result/nginx/proxy",
	"/tmp/momo-result/nginx/scgi",
	"/tmp/momo-result/nginx/uwsgi",
	"/tmp/momo-result/uploads",
}

type childSpec struct {
	Name      string
	Command   string
	Arguments []string
	Directory string
}

type runningChild struct {
	Name    string
	Command *exec.Cmd
}

type childExit struct {
	Name string
	Err  error
}

func runServe(ctx context.Context, stdout io.Writer, stderr io.Writer) int {
	if err := ensureRuntimeDirectories(); err != nil {
		writeResult(stderr, failureResult(serveEvent, "RuntimeDirectoryError"))
		return 1
	}
	if runRenderNginx(stdout, stderr) != 0 {
		return 1
	}
	nginxConfig := environmentOrDefault("MOMO_NGINX_OUTPUT_PATH", defaultNginxOutputPath)
	nginxCommand := environmentOrDefault("MOMO_RUNTIME_NGINX_COMMAND", defaultNginxCommand)
	if err := validateNginxCommand(ctx, nginxCommand, nginxConfig); err != nil {
		writeResult(stderr, failureResult(serveEvent, "NginxConfigurationError"))
		return 1
	}
	stopGrace, err := runtimeStopGrace()
	if err != nil {
		writeResult(stderr, failureResult(serveEvent, "InvalidConfiguration"))
		return 1
	}

	specs := []childSpec{
		{
			Name: "api", Command: environmentOrDefault("MOMO_RUNTIME_API_COMMAND", defaultAPICommand),
			Arguments: []string{"-cp", "/opt/momo-result/api/lib/*", "momo.api.Main"},
			Directory: environmentOrDefault("MOMO_RUNTIME_API_DIRECTORY", defaultAPIDirectory),
		},
		{
			Name: "nginx", Command: nginxCommand,
			Arguments: []string{"-c", nginxConfig, "-g", "daemon off;"},
		},
	}

	running := make(map[string]runningChild, len(specs))
	exits := make(chan childExit, len(specs))
	for _, spec := range specs {
		command := exec.Command(spec.Command, spec.Arguments...)
		command.Dir = spec.Directory
		command.Stdout = stdout
		command.Stderr = stderr
		configureChildProcess(command)
		if err := command.Start(); err != nil {
			stopChildren(running, syscall.SIGTERM)
			waitForChildren(running, exits, stopGrace)
			result := failureResult(serveEvent, "ChildStartError")
			result.Component = spec.Name
			writeResult(stderr, result)
			return 1
		}
		child := runningChild{Name: spec.Name, Command: command}
		running[spec.Name] = child
		go func() { exits <- childExit{Name: child.Name, Err: child.Command.Wait()} }()
	}
	writeResult(stdout, successResult(serveEvent))

	signalContext, cancelSignals := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer cancelSignals()
	exitCode := 0
	select {
	case <-signalContext.Done():
	case exited := <-exits:
		delete(running, exited.Name)
		result := failureResult(serveEvent, "ChildExited")
		result.Component = exited.Name
		writeResult(stderr, result)
		exitCode = 1
	}
	stopChildren(running, syscall.SIGTERM)
	if !waitForChildren(running, exits, stopGrace) {
		stopChildren(running, syscall.SIGKILL)
		_ = waitForChildren(running, exits, 5*time.Second)
		if exitCode == 0 {
			writeResult(stderr, failureResult(serveEvent, "ShutdownTimeout"))
			exitCode = 1
		}
	}
	return exitCode
}

func ensureRuntimeDirectories() error {
	directories := append([]string{}, runtimeDirectories...)
	if uploadDirectory := os.Getenv("IMAGE_TMP_DIR"); uploadDirectory != "" {
		directories = append(directories, uploadDirectory)
	}
	for _, directory := range directories {
		if err := os.MkdirAll(filepath.Clean(directory), 0o750); err != nil {
			return err
		}
	}
	return nil
}

func validateNginxCommand(ctx context.Context, commandPath string, configPath string) error {
	command := exec.CommandContext(ctx, commandPath, "-t", "-c", configPath)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Run()
}

func runtimeStopGrace() (time.Duration, error) {
	raw := os.Getenv(stopGraceEnvironmentName)
	if raw == "" {
		return defaultStopGrace, nil
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 1 || time.Duration(seconds)*time.Second > maximumStopGrace {
		return 0, errors.New("invalid runtime stop grace")
	}
	return time.Duration(seconds) * time.Second, nil
}

func stopChildren(running map[string]runningChild, signal syscall.Signal) {
	for _, child := range running {
		_ = signalChildProcessGroup(child.Command, signal)
	}
}

func waitForChildren(
	running map[string]runningChild,
	exits <-chan childExit,
	timeout time.Duration,
) bool {
	if len(running) == 0 {
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for len(running) > 0 {
		select {
		case exited := <-exits:
			delete(running, exited.Name)
		case <-timer.C:
			return false
		}
	}
	return true
}
