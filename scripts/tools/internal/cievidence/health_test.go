package cievidence

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPostdeployBaselineAndLegacyVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "evidence.json")
	data := fixture(t, "postdeploy.json")
	for _, contents := range [][]byte{data, mutated(t, data, func(o object) { delete(o, "schemaVersion") })} {
		writeFile(t, path, contents)
		code, out, stderr := run(t, "postdeploy-evidence", []string{path, "--require-check", "publicEdge"}, "")
		if code != 0 || out != "{\"schemaVersion\":1,\"status\":\"ok\"}\n" || stderr != "" {
			t.Fatalf("%d %q %q", code, out, stderr)
		}
	}
	// The existing report contract permits extra evidence and future check names.
	writeFile(t, path, mutated(t, data, func(o object) { o["extra"] = true; o["checks"] = append(o["checks"].([]any), "futureCheck") }))
	if code, _, stderr := run(t, "postdeploy-evidence", []string{path}, ""); code != 0 {
		t.Fatal(stderr)
	}
}

func TestPostdeployFailureClassesAndOutputIsolation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "evidence.json")
	data := fixture(t, "postdeploy.json")
	tests := []struct {
		name, kind string
		data       []byte
	}{
		{"missing-check", "MissingRequiredChecks", mutated(t, data, func(o object) { o["checks"] = []string{"database", "http", "processes", "web"} })},
		{"duplicate", "DuplicateChecks", mutated(t, data, func(o object) { o["checks"] = append(o["checks"].([]any), "http") })},
		{"newline", "InvalidChecks", mutated(t, data, func(o object) { o["checks"] = append(o["checks"].([]any), "bad\n") })},
		{"wrong-check-type", "InvalidChecks", mutated(t, data, func(o object) { o["checks"] = append(o["checks"].([]any), nil) })},
		{"version", "UnsupportedSchemaVersion", mutated(t, data, func(o object) { o["schemaVersion"] = 2 })},
		{"null-version", "UnsupportedSchemaVersion", mutated(t, data, func(o object) { o["schemaVersion"] = nil })},
		{"status", "UnhealthyStatus", mutated(t, data, func(o object) { o["status"] = "failed" })},
		{"checks-object", "InvalidChecks", mutated(t, data, func(o object) { o["checks"] = object{} })},
		{"event", "InvalidEvent", mutated(t, data, func(o object) { o["event"] = "private-input-marker" })},
		{"payload", "InvalidPayload", []byte("[]")},
		{"multiple", "JSONDecodeError", append(append([]byte{}, data...), data...)},
		{"malformed", "JSONDecodeError", []byte("private-input-marker")},
		{"oversize-suffix", "JSONDecodeError", append(append([]byte{}, data...), []byte(strings.Repeat(" ", 1048577))...)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			writeFile(t, path, tc.data)
			code, out, stderr := run(t, "postdeploy-evidence", []string{path}, "")
			expected := "{\"event\":\"runtime_postdeploy_evidence_validation\",\"status\":\"failed\",\"errorKind\":\"" + tc.kind + "\"}\n"
			if code != 1 || out != "" || stderr != expected {
				t.Fatalf("%d %q %q", code, out, stderr)
			}
		})
	}
	for _, args := range [][]string{nil, {path, "--require-check"}, {path, "--unexpected", "x"}, {path, "--require-check", "bad-check"}} {
		code, out, _ := run(t, "postdeploy-evidence", args, "")
		if code != 2 || out != "" {
			t.Fatalf("invalid args accepted: %v", args)
		}
	}
	writeFile(t, path, data)
	rejected(t, "postdeploy-evidence", []string{path, "--require-check", "absent"}, "")
}

func TestWorkerReadinessProviderWireAndLastOccurrence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "provider.jsonl")
	data := fixture(t, "worker-readiness.jsonl")
	// Last occurrence means input order, not chronological order.
	extra := []byte(`{"instance":"machine-current","timestamp":"2026-08-24T11:00:00Z","meta":{"Event":{"Provider":"app"}},"message":"{\"fields\":{\"event\":\"analysis_worker_ready\",\"worker_id\":\"analysis-current\"}}"}` + "\n")
	writeFile(t, path, append(append([]byte{}, data...), extra...))
	args := []string{path, "machine-current", "analysis-current", "ocr-current"}
	code, out, stderr := run(t, "worker-readiness", args, "")
	if code != 0 || stderr != "" {
		t.Fatalf("%d %q", code, stderr)
	}
	var result struct {
		SchemaVersion                            int
		MachineID, AnalysisWorkerID, OCRWorkerID string
		Checks                                   []readinessCheck
	}
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatal(err)
	}
	if result.SchemaVersion != 1 || result.MachineID != args[1] || result.AnalysisWorkerID != args[2] || result.OCRWorkerID != args[3] || len(result.Checks) != 4 {
		t.Fatalf("unexpected readiness: %s", out)
	}
	want := []string{"analysis_worker_ready", "ocr_rust_v2_worker_ready", "processing_jobs_notification_route_ready", "processing_scheduler_ready"}
	for index, event := range want {
		if result.Checks[index].Event != event {
			t.Fatal("wrong check order")
		}
	}
	if result.Checks[0].Timestamp != "2026-08-24T11:00:00Z" {
		t.Fatal("did not select last occurrence")
	}
	for index := 1; index < 4; index++ {
		wrong := append([]string{}, args...)
		wrong[index] = "old-generation"
		rejected(t, "worker-readiness", wrong, "")
	}
	for _, missing := range want {
		lines := strings.Split(string(data), "\n")
		filtered := make([]string, 0, len(lines))
		for _, line := range lines {
			if !strings.Contains(line, missing) {
				filtered = append(filtered, line)
			}
		}
		writeFile(t, path, []byte(strings.Join(filtered, "\n")))
		rejected(t, "worker-readiness", args, "")
	}
	for _, suffix := range []string{"private-input-marker", "[]", "42", `{"instance":"machine-current","meta":[]}`} {
		writeFile(t, path, append(append([]byte{}, data...), []byte(suffix)...))
		rejected(t, "worker-readiness", args, "")
	}
}

func TestArchiveSelectionDigestAndImageCommands(t *testing.T) {
	for _, digest := range []string{fixtureSHA, "sha256:" + fixtureSHA} {
		code, out, stderr := run(t, "artifact-digest", []string{digest}, "")
		if code != 0 || out != "sha256:"+fixtureSHA+"\n" || stderr != "" {
			t.Fatalf("%d %q %q", code, out, stderr)
		}
	}
	for _, digest := range []string{strings.ToUpper(fixtureSHA), fixtureSHA + "\n", "sha512:" + fixtureSHA, "sha256-" + fixtureSHA, fixtureSHA[:63]} {
		rejected(t, "artifact-digest", []string{digest}, "")
	}
	args := []string{"123456", fixtureCommit, "2", "runtime-image-123456-2", "789012", fixtureSHA, "registry.fly.io/momo-result:" + fixtureCommit + "-123456-2"}
	code, out, stderr := run(t, "runtime-release-selection", args, "")
	if code != 0 || out != "artifact_id=789012\nartifact_name=runtime-image-123456-2\ncandidate_run_attempt=2\nimage_ref="+args[6]+"\n" || stderr != "" {
		t.Fatalf("%d %q %q", code, out, stderr)
	}
	for index := range args {
		bad := append([]string{}, args...)
		bad[index] = "private-input-marker"
		rejected(t, "runtime-release-selection", bad, "")
	}
	workerArgs := []string{"123456", "2", "analysis-candidate-metadata-123456-2", "789012", fixtureSHA}
	if code, out, stderr := run(t, "analysis-release-selection", workerArgs, ""); code != 0 || out != "" || stderr != "" {
		t.Fatalf("%d %q %q", code, out, stderr)
	}
	for index := range workerArgs {
		bad := append([]string{}, workerArgs...)
		bad[index] = "private-input-marker"
		rejected(t, "analysis-release-selection", bad, "")
	}
	dir, _ := archiveFixture(t, false)
	archiveArgs := []string{dir, "registry.fly.io/momo-result-analysis:" + fixtureCommit + "-123456-2", fixtureTarSHA}
	if code, out, stderr := run(t, "analysis-archive", archiveArgs, ""); code != 0 || out != "sha256:"+fixtureSHA+"\n" || stderr != "" {
		t.Fatalf("%d %q %q", code, out, stderr)
	}
	for _, name := range []string{"analysis-worker-image.tar.gz", "image-id.txt", "image-ref.txt", "image-tar.sha256"} {
		dir, _ := archiveFixture(t, false)
		bad := append([]string{}, archiveArgs...)
		bad[0] = dir
		writeFile(t, filepath.Join(dir, name), []byte("private-input-marker"))
		rejected(t, "analysis-archive", bad, "")
	}
	for _, name := range []string{"analysis-worker-image.tar.gz", "image-id.txt", "image-ref.txt", "image-tar.sha256"} {
		dir, _ := archiveFixture(t, false)
		bad := append([]string{}, archiveArgs...)
		bad[0] = dir
		path := filepath.Join(dir, name)
		if err := os.Rename(path, path+".real"); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(path+".real", path); err != nil {
			t.Fatal(err)
		}
		rejected(t, "analysis-archive", bad, "")
	}
	for _, command := range []string{"image-id-match", "file-digest-match"} {
		valid := []string{"sha256:" + fixtureSHA, "sha256:" + fixtureSHA}
		if command == "file-digest-match" {
			valid = []string{filepath.Join("testdata", "fly.toml"), fixtureConfigSHA}
		}
		if code, out, stderr := run(t, command, valid, ""); code != 0 || out != "" || stderr != "" {
			t.Fatalf("%d %q %q", code, out, stderr)
		}
		valid[1] = "sha256:" + strings.Repeat("b", 64)
		if command == "file-digest-match" {
			valid[1] = strings.Repeat("b", 64)
		}
		rejected(t, command, valid, "")
	}
}

func TestCommandUsageAndHelp(t *testing.T) {
	for command := range usages {
		code, out, stderr := run(t, command, []string{"--help"}, "")
		if code != 0 || !strings.Contains(out, "Usage: ci-tool "+command) || stderr != "" {
			t.Fatalf("help %s: %d %q %q", command, code, out, stderr)
		}
		code, out, _ = run(t, command, nil, "")
		expectedCode := 2
		if command == "analysis-machine-identity" || command == "canonical-json" || command == "public-edge-evidence" {
			expectedCode = 1
		}
		if code != expectedCode || out != "" {
			t.Fatalf("missing args %s: %d %q", command, code, out)
		}
	}
	for _, command := range []string{"analysis-candidate", "runtime-deployment"} {
		code, out, _ := run(t, command, []string{"file", "run", "attempt", "commit", "--wrong", "path"}, "")
		if code != 2 || out != "" {
			t.Fatalf("invalid optional arg: %s", command)
		}
	}
}

func TestReadinessRejectsUnstructuredTimestamp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "readiness.jsonl")
	baseline := fixture(t, "worker-readiness.jsonl")
	for _, timestamp := range []any{nil, map[string]any{"token": "private-input-marker"}, "private-input-marker", 123} {
		lines := strings.Split(strings.TrimSpace(string(baseline)), "\n")
		for index, line := range lines {
			if strings.Contains(line, "analysis_worker_ready") && strings.Contains(line, "machine-current") {
				lines[index] = string(mutated(t, []byte(line), func(o object) { o["timestamp"] = timestamp }))
			}
		}
		writeFile(t, path, []byte(strings.Join(lines, "\n")))
		rejected(t, "worker-readiness", []string{path, "machine-current", "analysis-current", "ocr-current"}, "")
	}
}
