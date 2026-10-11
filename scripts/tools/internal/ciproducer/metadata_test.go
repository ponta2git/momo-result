package ciproducer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ponta2git/momo-result/scripts/tools/internal/cievidence"
)

func put(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}
func metadataFixture(t *testing.T, worker bool) (string, string, []string) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "artifact")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	put(t, filepath.Join(root, ".http4s-ref"), testCommit+"\n")
	put(t, filepath.Join(root, "fly.toml"), "app='test'\n")
	put(t, filepath.Join(root, "fly.analysis.toml"), "app='worker'\n")
	repo, archive := "momo-result", "momo-result-image.tar.gz"
	if worker {
		repo, archive = "momo-result-analysis", "analysis-worker-image.tar.gz"
	}
	ref := "registry.fly.io/" + repo + ":" + testCommit + "-123-2"
	put(t, filepath.Join(dir, archive), "fixture archive bytes")
	hash, err := hashFile(filepath.Join(dir, archive))
	if err != nil {
		t.Fatal(err)
	}
	put(t, filepath.Join(dir, "image-tar.sha256"), hash+"  "+archive+"\n")
	put(t, filepath.Join(dir, "image-ref.txt"), ref+"\n")
	put(t, filepath.Join(dir, "image-id.txt"), testDigest+"\n")
	patch := `{"repository":"https://github.com/ponta2git/http4s.git","scalaVersion":"3.3.6","sourceSha":"` + testCommit + `","version":"1.0.0-test"}`
	put(t, filepath.Join(dir, "http4s-patch.json"), patch)
	args := []string{"--artifact-dir", dir, "--run-id", "123", "--run-attempt", "2", "--commit", testCommit, "--image-ref", ref}
	if worker {
		args = append(args, "--artifact-id", "456", "--artifact-digest", strings.TrimPrefix(testDigest, "sha256:"))
	}
	return root, dir, args
}
func TestCandidateProducerConsumer(t *testing.T) {
	for _, worker := range []bool{false, true} {
		root, dir, args := metadataFixture(t, worker)
		command := "create-runtime-candidate"
		if worker {
			command = "create-analysis-candidate"
		}
		code, out, diagnostics := call(t, command, args, "", root)
		if code != 0 {
			t.Fatal(command, code, diagnostics)
		}
		put(t, filepath.Join(dir, "candidate.json"), out)
		id := cievidence.Identity{RunID: "123", RunAttempt: "2", Commit: testCommit}
		if worker {
			if err := cievidence.ValidateAnalysisCandidate([]byte(out), id); err != nil {
				t.Fatal(err)
			}
		} else {
			if code, _, err := evidenceCall("runtime-candidate", []string{dir, "123", "2", testCommit, "registry.fly.io/momo-result:" + testCommit + "-123-2"}, root); code != 0 {
				t.Fatal(code, err)
			}
		}
		// A modified archive must not silently receive fresh provenance.
		archive := "momo-result-image.tar.gz"
		if worker {
			archive = "analysis-worker-image.tar.gz"
		}
		put(t, filepath.Join(dir, archive), "tampered")
		code, out, _ = call(t, command, args, "", root)
		if code == 0 || out != "" {
			t.Fatal("accepted tampered archive")
		}
	}
}
func evidenceCall(command string, args []string, root string) (int, string, string) {
	var out, diagnostics strings.Builder
	code := cievidence.Run(command, args, strings.NewReader(""), &out, &diagnostics, root)
	return code, out.String(), diagnostics.String()
}
func TestDeploymentProducerAndHistoricalWire(t *testing.T) {
	root, dir, args := metadataFixture(t, false)
	code, candidate, diagnostics := call(t, "create-runtime-candidate", args, "", root)
	if code != 0 {
		t.Fatal(diagnostics)
	}
	put(t, filepath.Join(dir, "candidate.json"), candidate)
	put(t, filepath.Join(dir, "registry-manifest.json"), "{\"schemaVersion\":2}\n")
	deploymentArgs := []string{"--candidate", filepath.Join(dir, "candidate.json"), "--run-attempt", "3", "--registry-ref", runtimeRef, "--source-artifact-id", "456", "--source-artifact-digest", testDigest, "--manifest", filepath.Join(dir, "registry-manifest.json"), "--manifest-artifact-id", "789", "--manifest-artifact-digest", strings.TrimPrefix(testDigest, "sha256:")}
	code, out, diagnostics := call(t, "create-runtime-deployment", deploymentArgs, "", root)
	if code != 0 {
		t.Fatal(diagnostics)
	}
	if err := cievidence.ValidateRuntimeDeployment([]byte(out), cievidence.Identity{RunID: "123", RunAttempt: "3", Commit: testCommit}); err != nil {
		t.Fatal(err)
	}
	// This frozen v3 fixture is the pre-refactor jq writer's wire document.
	want, err := os.ReadFile("testdata/runtime-deployment-v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var actual, expected any
	if json.Unmarshal([]byte(out), &actual) != nil || json.Unmarshal(want, &expected) != nil || !reflect.DeepEqual(actual, expected) {
		t.Fatalf("deployment wire changed:\n%s", out)
	}
	put(t, filepath.Join(dir, "deployment.json"), out)
	provider := `{"id":789,"name":"runtime-image-registry-manifest-123-3","digest":"` + testDigest + `","expired":false,"workflow_run":{"id":123},"secret":"never-print"}`
	for _, input := range []string{provider, strings.Replace(provider, `"expired":false`, `"expired":true`, 1), strings.Replace(provider, `"id":123`, `"id":124`, 1)} {
		code, result, diagnostics := call(t, "verify-manifest-artifact", []string{filepath.Join(dir, "deployment.json"), "123"}, input, root)
		if (code == 0) != (input == provider) || result != "" || strings.Contains(diagnostics, "never-print") {
			t.Fatal(code, result, diagnostics)
		}
	}
}
func TestPatchProducerRejectsUnpinnedSource(t *testing.T) {
	root, _, _ := metadataFixture(t, false)
	args := []string{"--repository", "https://github.com/ponta2git/http4s.git", "--scala-version", "3.3.6", "--source-sha", testCommit, "--version", "1.0.0-test"}
	code, _, err := call(t, "create-http4s-patch", args, "", root)
	if code != 0 {
		t.Fatal(err)
	}
	args[5] = strings.Repeat("b", 40)
	code, out, _ := call(t, "create-http4s-patch", args, "", root)
	if code == 0 || out != "" {
		t.Fatal("accepted unpinned patch")
	}
}
