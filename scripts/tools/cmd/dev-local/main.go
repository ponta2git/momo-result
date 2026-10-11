package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() { os.Exit(run(os.Args[1:])) }

func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "apps/api/build.sbt")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("run dev-local from the repository")
		}
		dir = parent
	}
}

type child struct {
	cmd  *exec.Cmd
	done chan struct{}
	err  error // read only after done is closed
}

func start(command string, args []string, cwd string, env []string) (*child, error) {
	cmd := exec.Command(command, args...)
	cmd.Dir, cmd.Env = cwd, env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("%s could not start: %w", command, err)
	}
	c := &child{cmd: cmd, done: make(chan struct{})}
	go func() { c.err = cmd.Wait(); close(c.done) }()
	return c, nil
}

func stop(children ...*child) {
	// Kill the entire group even when its leader has already exited: sbt and pnpm
	// can leave descendants behind. Bound shutdown for children ignoring SIGTERM.
	for _, c := range children {
		signalProcess(c.cmd, syscall.SIGTERM)
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for _, c := range children {
		select {
		case <-c.done:
		case <-timer.C:
			for _, c := range children {
				signalProcess(c.cmd, syscall.SIGKILL)
			}
			for _, c := range children {
				<-c.done
			}
			return
		}
	}
	for _, c := range children {
		signalProcess(c.cmd, syscall.SIGKILL)
	}
}

func waitForAPI(ctx context.Context, api *child, url string, client *http.Client) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-api.done:
			return errors.New("API exited before becoming ready. Run `pnpm --dir ../momo-db db:migrate` and inspect the API log above.")
		default:
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		response, err := client.Do(request)
		if err == nil {
			var health struct {
				Database string `json:"database"`
			}
			decodeErr := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&health)
			response.Body.Close()
			if decodeErr == nil {
				switch health.Database {
				case "ok":
					if response.StatusCode == http.StatusOK {
						return nil
					}
				case "disabled":
					return errors.New("API started without persistent database access. Stop any existing API and rerun pnpm dev.")
				case "unavailable":
					return errors.New("API cannot reach the configured database. Run `pnpm --dir ../momo-db db:up` and `pnpm --dir ../momo-db db:migrate`, or verify DATABASE_URL.")
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-api.done:
			return errors.New("API exited before becoming ready. Run `pnpm --dir ../momo-db db:migrate` and inspect the API log above.")
		case <-ticker.C:
		}
	}
}

func run(args []string) int {
	const usage = "Usage: dev-local\nStarts the local API and web development servers. Run from the repository."
	if len(args) == 1 && (args[0] == "-h" || args[0] == "--help") {
		fmt.Fprintln(os.Stdout, usage)
		return 0
	}
	if len(args) != 0 {
		fmt.Fprintln(os.Stderr, "dev-local accepts no arguments.\n"+usage)
		return 2
	}
	root, err := repoRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	env, err := resolveEnvironment(root, os.Environ())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	port := "8080"
	for _, entry := range env {
		if value, ok := strings.CutPrefix(entry, "HTTP_PORT="); ok && strings.TrimSpace(value) != "" {
			port = strings.TrimSpace(value)
		}
	}
	address := net.JoinHostPort("127.0.0.1", port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		fmt.Fprintln(os.Stderr, "API port is unavailable; stop the existing API or set HTTP_PORT.")
		return 1
	}
	listener.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	signalCode := make(chan int, 1)
	go func() {
		select {
		case s := <-signals:
			code := 143
			if s == os.Interrupt {
				code = 130
			}
			signalCode <- code
			cancel()
		case <-ctx.Done():
		}
	}()
	exitCode := func(err error) int {
		select {
		case code := <-signalCode:
			return code
		default:
		}
		if err == nil {
			return 0
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() > 0 {
			return exit.ExitCode()
		}
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	api, err := start("sbt", []string{"--server", "run"}, filepath.Join(root, "apps/api"), env)
	if err != nil {
		return exitCode(err)
	}
	children := []*child{api}
	defer func() { stop(children...) }()
	readyCtx, readyCancel := context.WithTimeout(ctx, 240*time.Second)
	err = waitForAPI(readyCtx, api, "http://"+address+"/healthz/details", &http.Client{Timeout: 2 * time.Second})
	readyCancel()
	if err != nil {
		return exitCode(err)
	}
	if ctx.Err() != nil {
		return exitCode(ctx.Err())
	}
	web, err := start("pnpm", []string{"--filter", "web", "dev"}, root, env)
	if err != nil {
		return exitCode(err)
	}
	children = append(children, web)
	select {
	case <-ctx.Done():
		return exitCode(ctx.Err())
	case <-api.done:
		return exitCode(api.err)
	case <-web.done:
		return exitCode(web.err)
	}
}
