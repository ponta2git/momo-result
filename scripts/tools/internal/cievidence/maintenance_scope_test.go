package cievidence

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func scopeReceipt(t *testing.T, operation string, scope object) string {
	t.Helper()
	r := object{"formatVersion": 1, "operation": operation, "cutoverId": "release-fixture", "stopEpoch": 4,
		"candidates": object{"result": testCommit}, "scope": scope,
		"producer": object{"runId": "123456", "runAttempt": 2, "artifacts": []any{object{"id": "111", "digest": strings.Repeat("a", 64)}}}}
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "receipt.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func analysisScope() object {
	return object{"operationId": "analysis-release-operation-fixture", "campaignId": "analysis-campaign-fixture", "planDigest": testDigest}
}

func publishScope() object {
	return object{"deploymentRunId": "654321", "deploymentRunAttempt": 3, "provenanceArtifactId": "333", "provenanceArtifactDigest": strings.Repeat("a", 64)}
}

func TestMaintenanceScopeRejectsUnboundCommands(t *testing.T) {
	path := scopeReceipt(t, "analysis", analysisScope())
	code, out, diagnostics := call(t, "maintenance-operation-scope", []string{path, "analysis"}, "", "")
	if code != 0 || !strings.Contains(out, "campaign_id=analysis-campaign-fixture\n") || !strings.Contains(out, "stop_epoch=4\n") {
		t.Fatal(code, out, diagnostics)
	}
	for _, s := range []object{
		{"operationId": "unsafe;never-print", "campaignId": "campaign", "planDigest": testDigest},
		{"operationId": "operation", "campaignId": "campaign", "planDigest": "stale"},
		{"operationId": "operation", "campaignId": "campaign", "planDigest": testDigest, "command": "never-print"},
	} {
		path := scopeReceipt(t, "analysis", s)
		code, out, diagnostics := call(t, "maintenance-operation-scope", []string{path, "analysis"}, "", "")
		if code == 0 || out != "" || strings.Contains(diagnostics, "never-print") {
			t.Fatal(code, out, diagnostics)
		}
	}
	code, out, _ = call(t, "maintenance-operation-scope", []string{path, "publish"}, "", "")
	if code == 0 || out != "" {
		t.Fatal("an analysis receipt selected publication")
	}
}

func TestAnalysisCompletionRequiresTheBoundPlanAndEveryTarget(t *testing.T) {
	path := scopeReceipt(t, "analysis", analysisScope())
	valid := fmt.Sprintf(`{"schemaVersion":1,"cutoverId":"release-fixture","stopEpoch":4,"operationId":"analysis-release-operation-fixture","campaignId":"analysis-campaign-fixture","planDigest":%q,"status":"complete","targetCount":2,"completedCount":2,"failedCount":0}`, testDigest)
	for _, change := range []func(object){
		nil,
		func(o object) { o["stopEpoch"] = 3 },
		func(o object) { o["campaignId"] = "other-campaign" },
		func(o object) { o["planDigest"] = "sha256:" + strings.Repeat("b", 64) },
		func(o object) { o["status"] = "attention_required" },
		func(o object) { o["completedCount"] = 1 },
		func(o object) { o["completedCount"] = 1; o["failedCount"] = 1 },
		func(o object) { o["providerSecret"] = "never-print" },
	} {
		input := valid
		if change != nil {
			input = string(mutated(t, []byte(valid), change))
		}
		code, out, diagnostics := call(t, "maintenance-analysis-evidence", []string{path, "complete"}, input, "")
		if (code == 0) != (change == nil) || (change != nil && out != "") || strings.Contains(out+diagnostics, "never-print") {
			t.Fatal(code, out, diagnostics)
		}
	}
	planned := strings.Replace(valid, `"status":"complete"`, `"status":"planned"`, 1)
	planned = strings.Replace(planned, `"completedCount":2`, `"completedCount":1`, 1)
	code, _, diagnostics := call(t, "maintenance-analysis-evidence", []string{path, "plan"}, planned, "")
	if code != 0 {
		t.Fatal(diagnostics)
	}
	code, _, diagnostics = call(t, "maintenance-analysis-evidence", []string{path, "plan"}, valid, "")
	if code != 0 {
		t.Fatal("an already completed read-only plan must remain idempotent", diagnostics)
	}
}

func TestMaintenancePublisherRequiresDeployedRunCompletionAndProducer(t *testing.T) {
	path := scopeReceipt(t, "publish", publishScope())
	provenance, err := os.ReadFile("testdata/runtime-deployment-v4.json")
	if err != nil {
		t.Fatal(err)
	}
	run := fmt.Sprintf(`{"id":654321,"run_attempt":3,"head_sha":%q,"head_branch":"cutover/release-fixture","event":"workflow_dispatch","path":".github/workflows/deploy-maintenance.yml","status":"completed","conclusion":"success","repository":{"full_name":"ponta2git/momo-result"},"private":"never-print"}`, testCommit)
	artifact := fmt.Sprintf(`{"id":333,"name":"runtime-deployment-metadata-654321-3","digest":%q,"expired":false,"workflow_run":{"id":654321,"head_sha":%q},"private":"never-print"}`, testDigest, testCommit)
	completion := fmt.Sprintf(`{"schemaVersion":1,"status":"ready","mode":"frozen","runId":"654321","runAttempt":"3","commit":%q,"cutoverId":"release-fixture","stopEpoch":4,"provenanceArtifactId":"333","provenanceArtifactDigest":%q}`, testCommit, testDigest)
	for _, tc := range []struct {
		kind, input string
		changes     []func(object)
	}{
		{"run", run, []func(object){
			func(o object) { o["run_attempt"] = 2 }, func(o object) { o["path"] = ".github/workflows/deploy.yml" },
			func(o object) { o["conclusion"] = "failure" }, func(o object) { o["head_branch"] = "master" },
		}},
		{"artifact", artifact, []func(object){
			func(o object) { o["id"] = 334 }, func(o object) { o["expired"] = true },
			func(o object) { o["digest"] = "sha256:" + strings.Repeat("b", 64) },
		}},
		{"completion", completion, []func(object){
			func(o object) { o["mode"] = "normal" }, func(o object) { o["stopEpoch"] = 5 },
			func(o object) { o["provenanceArtifactId"] = "334" },
		}},
		{"provenance", string(provenance), []func(object){
			func(o object) { o["sourceRunId"] = "654321" }, func(o object) { o["sourceRunAttempt"] = "3" },
			func(o object) { o["sourceArtifactId"] = "112" },
		}},
	} {
		for _, change := range append([]func(object){nil}, tc.changes...) {
			input := tc.input
			if change != nil {
				input = string(mutated(t, []byte(input), change))
			}
			code, out, diagnostics := call(t, "maintenance-publish-evidence", []string{path, tc.kind}, input, "")
			if (code == 0) != (change == nil) || out != "" || strings.Contains(diagnostics, "never-print") {
				t.Fatal(tc.kind, code, out, diagnostics)
			}
		}
	}
}
