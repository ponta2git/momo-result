package cievidence

import (
	"encoding/json"
	"strings"
	"testing"
)

func machineFixture() map[string]any {
	return map[string]any{"id": "a123", "state": "started", "private": "never-print", "config": map[string]any{"image": workerRef, "guest": map[string]any{"cpu_kind": "shared", "cpus": 1, "memory_mb": 256}, "env": map[string]any{"MOMO_ANALYSIS_CONFIG_VERSION": "series-analysis-v1-" + testCommit, "MOMO_ANALYSIS_PUBLICATION_MODE": "enabled", "MOMO_OCR_V2_CONSUMER_MODE": "enabled", "MOMO_ANALYSIS_WORKER_ID": "worker-123-2", "MOMO_OCR_V2_WORKER_ID": "ocr-123-2"}}}
}
func TestMachineIdentityAndEvidence(t *testing.T) {
	m := machineFixture()
	data, _ := json.Marshal([]any{m})
	code, out, _ := call(t, "analysis-machine-identity", nil, string(data), "")
	if code != 0 || out != "a123\t"+workerRef+"\tseries-analysis-v1-"+testCommit+"\n" {
		t.Fatal(code, out)
	}
	args := []string{workerRef, testCommit, "worker-123-2", "ocr-123-2"}
	code, out, _ = call(t, "analysis-machine-evidence", args, string(data), "")
	if code != 0 || strings.Contains(out, "never-print") {
		t.Fatal(code, out)
	}
	for _, mutate := range []func(map[string]any){
		func(m map[string]any) { m["state"] = "stopped" },
		func(m map[string]any) { objectMap(field(m, "config", "env"))["MOMO_OCR_V2_CONSUMER_MODE"] = "disabled" },
		func(m map[string]any) { objectMap(field(m, "config", "guest"))["memory_mb"] = 512 },
		func(m map[string]any) {
			objectMap(field(m, "config", "env"))["MOMO_ANALYSIS_WORKER_ID"] = "worker-123-1"
		},
	} {
		m := machineFixture()
		mutate(m)
		data, _ := json.Marshal([]any{m})
		code, out, _ = call(t, "analysis-machine-evidence", args, string(data), "")
		if code == 0 || out != "" {
			t.Fatal("accepted stale machine")
		}
	}
}
func TestReuseDoesNotAcceptWrongGeneration(t *testing.T) {
	for _, version := range []any{"series-analysis-v1-" + testCommit, testCommit, 42, nil} {
		m := machineFixture()
		objectMap(field(m, "config", "env"))["MOMO_ANALYSIS_CONFIG_VERSION"] = version
		data, _ := json.Marshal([]any{m})
		code, out, _ := call(t, "analysis-reusable-release", []string{workerRef}, string(data), "")
		want := "\n"
		if version == "series-analysis-v1-"+testCommit {
			want = testCommit + "\n"
		}
		if code != 0 || out != want {
			t.Fatal(code, out)
		}
	}
}
func TestRuntimeMachineEvidence(t *testing.T) {
	m := machineFixture()
	objectMap(field(m, "config"))["image"] = runtimeRef
	data, _ := json.Marshal([]any{m})
	code, out, _ := call(t, "runtime-machine-evidence", []string{runtimeRef}, string(data), "")
	if code != 0 || strings.Contains(out, "never-print") || !strings.Contains(out, "singleStartedExactImage") {
		t.Fatal(code, out)
	}
	code, out, _ = call(t, "runtime-machine-id", []string{runtimeRef}, string(data), "")
	if code != 0 || out != "a123\n" {
		t.Fatal(code, out)
	}
	data, _ = json.Marshal([]any{m, m})
	code, out, _ = call(t, "runtime-machine-evidence", []string{runtimeRef}, string(data), "")
	if code == 0 || out != "" {
		t.Fatal("accepted duplicate machines")
	}
}
