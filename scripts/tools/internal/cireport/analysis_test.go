package cireport

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const maintenanceFixture = `{"schemaVersion":1,"status":"attention_required","action":"none","reason":"reader_or_worker_incompatible","planDigest":"","targetCount":0,"completedCount":0,"failedCount":0,"current":{"private":"private-value"}}`

func TestAnalysisReportSanitizationAndState(t *testing.T) {
	dir := t.TempDir()
	input, output := filepath.Join(dir, "input.json"), filepath.Join(dir, "output.json")
	put(t, input, maintenanceFixture)
	code, stdout, stderr := invoke("analysis-report", []string{input, output}, "")
	if code != 0 || stdout != "" || stderr != "" {
		t.Fatalf("%d %s %s", code, stdout, stderr)
	}
	raw := read(t, output)
	report := object(t, raw)
	if len(report) != 9 || report["kind"] != "maintenance" || strings.Contains(raw, "private-value") {
		t.Fatal(raw)
	}
	code, stdout, stderr = invoke("analysis-report-state", []string{output}, "")
	if code != 0 || stdout != "attention_required\t\n" || stderr != "" {
		t.Fatalf("%d %s %s", code, stdout, stderr)
	}
	put(t, input, strings.Replace(maintenanceFixture, `"planDigest":""`, `"planDigest":"sha256:`+strings.Repeat("a", 64)+`"`, 1))
	code, stdout, _ = invoke("analysis-report-state", []string{input}, "")
	if code != 0 || stdout != "attention_required\tsha256:"+strings.Repeat("a", 64)+"\n" {
		t.Fatal(stdout)
	}
}

func TestPlannedStateRequiresDigestBeforeApply(t *testing.T) {
	dir := t.TempDir()
	input, output := filepath.Join(dir, "input.json"), filepath.Join(dir, "output.json")
	put(t, input, strings.Replace(maintenanceFixture, "attention_required", "planned", 1))
	if code, _, _ := invoke("analysis-report", []string{input, output}, ""); code != 0 {
		t.Fatal("The report shape itself allows empty digests.")
	}
	if code, stdout, _ := invoke("analysis-report-state", []string{output}, ""); code != 1 || stdout != "" {
		t.Fatal("Planned work without a digest must not become an actionable state.")
	}
}

func TestAnalysisInvalidReportsClearPreviousEvidence(t *testing.T) {
	invalid := []string{"", `{broken`, `null`, `[]`, `1`, `"report"`, `{"unknown":"private-value"}`, maintenanceFixture + maintenanceFixture, `{}` + maintenanceFixture, maintenanceFixture + `{broken`}
	for _, field := range []string{"status", "reason", "action", "planDigest"} {
		v := object(t, maintenanceFixture)
		v[field] = "private-value"
		data, _ := json.Marshal(v)
		invalid = append(invalid, string(data))
	}
	for _, field := range []string{"targetCount", "completedCount", "failedCount"} {
		for _, value := range []string{"-1", "0.5", "null", `"1"`, `true`, `1.0000000000000001`} {
			v := object(t, maintenanceFixture)
			v[field] = json.RawMessage(value)
			data, _ := json.Marshal(v)
			invalid = append(invalid, string(data))
		}
	}
	v := object(t, maintenanceFixture)
	v["planDigest"] = "sha256:" + strings.Repeat("a", 64) + "\n"
	data, _ := json.Marshal(v)
	invalid = append(invalid, string(data))
	for _, fixture := range invalid {
		t.Run(fixture, func(t *testing.T) {
			dir := t.TempDir()
			input, output := filepath.Join(dir, "input.json"), filepath.Join(dir, "output.json")
			put(t, input, maintenanceFixture)
			if code, _, _ := invoke("analysis-report", []string{input, output}, ""); code != 0 {
				t.Fatal(code)
			}
			put(t, input, fixture)
			code, stdout, stderr := invoke("analysis-report", []string{input, output}, "")
			if code != 1 || stdout != "" || strings.Contains(stderr, "private-value") {
				t.Fatalf("%d %s %s", code, stdout, stderr)
			}
			if info, err := os.Stat(output); err == nil && info.Size() != 0 {
				t.Fatal("stale publishable evidence")
			}
			if code, stdout, _ := invoke("analysis-report-state", []string{input}, ""); code != 1 || stdout != "" {
				t.Fatal("invalid report state was emitted")
			}
		})
	}
}

func TestAnalysisCountsPreserveIntegerPrecision(t *testing.T) {
	dir := t.TempDir()
	input, output := filepath.Join(dir, "input.json"), filepath.Join(dir, "output.json")
	put(t, input, strings.Replace(maintenanceFixture, `"targetCount":0`, `"targetCount":9007199254740993`, 1))
	if code, _, _ := invoke("analysis-report", []string{input, output}, ""); code != 0 {
		t.Fatal(code)
	}
	if object(t, read(t, output))["targetCount"] != json.Number("9007199254740993") {
		t.Fatal("integer rounded")
	}
}

func TestAnalysisLogSelectsExactlyOneCandidate(t *testing.T) {
	diagnostic := `{"timestamp":"private-value","fields":{"event":"analysis_command_failed"}}`
	for _, tc := range []struct {
		input string
		valid bool
	}{
		{diagnostic + "\n" + maintenanceFixture + "\n" + diagnostic, true},
		{maintenanceFixture, true}, {diagnostic, false}, {"", false},
		{maintenanceFixture + maintenanceFixture, false},
		{maintenanceFixture + `{"schemaVersion":2,"planDigest":""}`, false},
		{`{"schemaVersion":2,"planDigest":""}` + maintenanceFixture, false},
		{maintenanceFixture + "\n{broken", false},
		{`null [] 1 ` + maintenanceFixture, true},
	} {
		t.Run(tc.input, func(t *testing.T) {
			dir := t.TempDir()
			input, output := filepath.Join(dir, "input.json"), filepath.Join(dir, "output.json")
			put(t, input, tc.input)
			put(t, output, maintenanceFixture)
			code, stdout, stderr := invoke("analysis-report", []string{"--from-log", input, output}, "")
			if (code == 0) != tc.valid || stdout != "" || strings.Contains(stderr, "private-value") {
				t.Fatalf("%d %s %s", code, stdout, stderr)
			}
			if tc.valid {
				if strings.Contains(read(t, output), "private-value") {
					t.Fatal("raw field leaked")
				}
			} else if info, err := os.Stat(output); err == nil && info.Size() != 0 {
				t.Fatal("stale output")
			}
		})
	}
}

func TestAnalysisFilesMustBeDistinctAndRegular(t *testing.T) {
	dir := t.TempDir()
	input, output := filepath.Join(dir, "input.json"), filepath.Join(dir, "output.json")
	put(t, input, maintenanceFixture)
	if code, _, _ := invoke("analysis-report", []string{input, input}, ""); code != 1 {
		t.Fatal(code)
	}
	if read(t, input) != maintenanceFixture {
		t.Fatal("input was modified")
	}
	if err := os.Symlink(input, output); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := invoke("analysis-report", []string{input, output}, ""); code != 1 {
		t.Fatal(code)
	}
	if code, _, _ := invoke("analysis-report", []string{output, filepath.Join(dir, "safe.json")}, ""); code != 1 {
		t.Fatal(code)
	}
	if err := os.Remove(output); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(input, output); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := invoke("analysis-report", []string{input, output}, ""); code != 1 {
		t.Fatal(code)
	}
	if read(t, input) != maintenanceFixture {
		t.Fatal("hardlinked input was modified")
	}
	if err := os.Remove(output); err != nil {
		t.Fatal(err)
	}
	put(t, output, maintenanceFixture)
	if code, _, _ := invoke("analysis-report", []string{filepath.Join(dir, "missing"), output}, ""); code != 1 {
		t.Fatal(code)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("missing input left evidence")
	}
}

func TestAnalysisSummary(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.json")
	for _, state := range []string{"complete", "planned", "running"} {
		put(t, path, strings.Replace(maintenanceFixture, "attention_required", state, 1))
		code, out, stderr := invoke("analysis-summary", []string{path, "success"}, "")
		if code != 0 || stderr != "" || !strings.Contains(out, "| "+state+" | none | 0 | 0 | 0 |") || strings.Contains(out, "private-value") {
			t.Fatalf("%d %s %s", code, out, stderr)
		}
		if strings.Contains(out, "確認のみ") != (state == "planned" || state == "running") {
			t.Fatal(out)
		}
	}
	for _, result := range []string{"failure", "cancelled", "skipped"} {
		code, out, stderr := invoke("analysis-summary", []string{path, result}, "")
		if code != 0 || !strings.Contains(out, "Release follow-up required") || !strings.Contains(stderr, "::error::") {
			t.Fatalf("%d %s %s", code, out, stderr)
		}
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	code, out, stderr := invoke("analysis-summary", []string{path, "success"}, "")
	if code != 0 || out != "" || stderr != "" {
		t.Fatalf("%d %s %s", code, out, stderr)
	}
	code, out, stderr = invoke("analysis-summary", []string{path, "failure"}, "")
	if code != 0 || !strings.Contains(out, "Release follow-up required") || !strings.Contains(stderr, "::error::") {
		t.Fatal(out)
	}
	put(t, path, `{"status":"private-value"}`)
	code, out, stderr = invoke("analysis-summary", []string{path, "failure"}, "")
	if code != 1 || strings.Contains(out+stderr, "private-value") || !strings.Contains(out, "Release follow-up required") {
		t.Fatalf("%d %s %s", code, out, stderr)
	}
}
