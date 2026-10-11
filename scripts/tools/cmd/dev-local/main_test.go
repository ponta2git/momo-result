package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestArgumentsBeforeStartup(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, tc := range []struct {
		args []string
		want int
	}{
		{[]string{"-h"}, 0},
		{[]string{"--help"}, 0},
		{[]string{"--unknown"}, 2},
		{[]string{"extra"}, 2},
		{[]string{"--help", "extra"}, 2},
	} {
		if got := run(tc.args); got != tc.want {
			t.Errorf("run(%q) = %d, want %d", tc.args, got, tc.want)
		}
	}
}

func TestEnvironment(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "momo-result")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(parent, "momo-db"), 0700); err != nil {
		t.Fatal(err)
	}
	write := func(path, content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, ".env.example"), "APP_ENV=dev\nREDIS_URL=redis://example\n")
	write(filepath.Join(parent, "momo-db/.env.local"), "DIRECT_URL=postgres://shared\n")
	for _, tc := range []struct{ name, local, process, database string }{
		{"shared", "", "", "postgres://shared"},
		{"local", "DATABASE_URL=postgres://local", "DATABASE_URL=   ", "postgres://local"},
		{"process", "DATABASE_URL=postgres://local", "DATABASE_URL=postgres://explicit", "postgres://explicit"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			write(filepath.Join(root, ".env"), tc.local)
			env, err := resolveEnvironment(root, []string{"PATH=/bin", tc.process})
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{"DATABASE_URL=" + tc.database, "PATH=/bin", "APP_ENV=dev", "MOMO_LOG_FORMAT=text", "REDIS_URL=redis://example"} {
				found := false
				for _, entry := range env {
					if entry == want {
						found = true
					}
				}
				if !found {
					t.Errorf("missing %s", want)
				}
			}
		})
	}
	write(filepath.Join(root, ".env"), "")
	write(filepath.Join(parent, "momo-db/.env.local"), "")
	if _, err := resolveEnvironment(root, nil); err == nil {
		t.Fatal("missing database accepted")
	}
}

func TestDotEnvQuotesAndNoExpansion(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "export A=plain # comment\nB='literal $A # hash'\nC=\"first\nsecond\"\nD=\"escaped\\nline\"\nE=`backtick`\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	env, err := readEnv(path)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"A": "plain", "B": "literal $A # hash", "C": "first\nsecond", "D": "escaped\nline", "E": "backtick"} {
		if env[key] != want {
			t.Errorf("%s=%q, want %q", key, env[key], want)
		}
	}
}

func TestReadiness(t *testing.T) {
	for _, tc := range []struct {
		status              int
		database, wantError string
	}{
		{200, "ok", ""}, {200, "disabled", "without persistent"}, {503, "unavailable", "db:migrate"},
	} {
		t.Run(tc.database, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/healthz/details" {
					t.Errorf("unexpected path %s", r.URL.Path)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(`{"database":"` + tc.database + `"}`))
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			err := waitForAPI(ctx, &child{done: make(chan struct{})}, server.URL+"/healthz/details", server.Client())
			if tc.wantError == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("got %v, want %s", err, tc.wantError)
			}
		})
	}
}

func TestReadinessStopsOnExitOrCancellation(t *testing.T) {
	done := make(chan struct{})
	close(done)
	if err := waitForAPI(context.Background(), &child{done: done}, "http://unused", http.DefaultClient); err == nil || !strings.Contains(err.Error(), "db:migrate") {
		t.Fatalf("unexpected error %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitForAPI(ctx, &child{done: make(chan struct{})}, "http://unused", http.DefaultClient); err != context.Canceled {
		t.Fatalf("unexpected error %v", err)
	}
}
