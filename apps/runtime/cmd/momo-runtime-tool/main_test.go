package main

import (
	"bytes"
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestPreflightRejectsMissingRequiredColumn(t *testing.T) {
	databaseURL, _, _ := startProbeDatabasePeer(t, false)
	contractPath := filepath.Join(t.TempDir(), "contract.json")
	if err := os.WriteFile(contractPath, []byte(`{"schemaVersion":1,"columns":["ocr_jobs.status"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", databaseURL)
	t.Setenv("MOMO_RUNTIME_DB_CONTRACT_PATH", contractPath)
	var stdout, stderr bytes.Buffer
	if code := runCLI(t.Context(), []string{"preflight"}, &stdout, &stderr); code != 1 || stdout.Len() != 0 {
		t.Fatalf("preflight with a missing column returned %d with %d bytes of success output", code, stdout.Len())
	}
	var result commandResult
	if err := json.Unmarshal(stderr.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"columns": 1, "tables": 0, "indexes": 0, "functions": 0, "seedMembers": 0}
	if result.Status != "failed" || !maps.Equal(result.MissingCounts, want) {
		t.Fatalf("status %q, missing counts %v", result.Status, result.MissingCounts)
	}
}

func TestSmokeRecognizesTheAPIProcess(t *testing.T) {
	t.Parallel()
	api := "/opt/java/openjdk/bin/java -cp /opt/momo-result/api/lib/app.jar momo.api.Main"
	if missing := missingRuntimeProcesses([]string{api}); len(missing) != 0 {
		t.Fatalf("running API reported missing: %v", missing)
	}
	if missing := missingRuntimeProcesses([]string{"/bin/sh"}); !slices.Equal(missing, []string{"api"}) {
		t.Fatalf("missing processes = %v", missing)
	}
}

func TestSmokeReportsTheChecksForItsMode(t *testing.T) {
	t.Parallel()
	local := []string{"database", "http", "http2", "processes"}
	for mode, expected := range map[string][]string{"deferred": local, "required": append(local, "publicEdge")} {
		if checks := localSmokeChecks(mode); !slices.Equal(checks, expected) {
			t.Errorf("%s checks = %v, want %v", mode, checks, expected)
		}
	}
}

func TestHealthPayloadRequiresOneBoundedHealthyResponse(t *testing.T) {
	t.Parallel()
	payload := `{"status":"ok"}`
	atLimit := payload + strings.Repeat(" ", 4096-len(payload))
	if !decodeValidHealthPayload(strings.NewReader(atLimit)) {
		t.Fatal("complete health payload at the byte limit was rejected")
	}
	for name, input := range map[string]string{
		"degraded": `{"status":"degraded"}`, "non-object": `["ok"]`,
		"trailing object": payload + payload, "trailing data beyond limit": atLimit + payload,
	} {
		if decodeValidHealthPayload(strings.NewReader(input)) {
			t.Errorf("%s health payload was accepted", name)
		}
	}
}

func TestPreflightFailureDoesNotLeakDatabaseURL(t *testing.T) {
	secretURL := "postgresql://sensitive-user:sensitive-password@example.invalid/database"
	t.Setenv("DATABASE_URL", secretURL)
	t.Setenv("MOMO_RUNTIME_DB_CONTRACT_PATH", filepath.Join(t.TempDir(), "missing.json"))
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runPreflight(context.Background(), &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("exit code = %d, want 1", exitCode)
	}
	combined := stdout.String() + stderr.String()
	if strings.Contains(combined, secretURL) || strings.Contains(combined, "sensitive-password") {
		t.Fatal("database URL leaked to command output")
	}
	if !strings.Contains(combined, `"errorClass":"ContractLoadError"`) {
		t.Fatalf("unexpected failure output: %s", combined)
	}
}

func TestInvalidArgumentsReturnOneJSONResult(t *testing.T) {
	t.Parallel()
	for _, command := range []string{"unknown", "serve", "render-caddy"} {
		t.Run(command, func(t *testing.T) {
			var stdout bytes.Buffer
			var stderr bytes.Buffer
			if exitCode := runCLI(context.Background(), []string{command}, &stdout, &stderr); exitCode != 2 {
				t.Fatalf("exit code = %d, want 2", exitCode)
			}
			if stdout.Len() != 0 {
				t.Fatalf("unexpected stdout: %s", stdout.String())
			}
			var result commandResult
			if err := json.Unmarshal(stderr.Bytes(), &result); err != nil {
				t.Fatalf("decode JSON result: %v", err)
			}
			if result.Status != "failed" || result.ErrorClass != "InvalidArguments" {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}
