package cievidence

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

const testCommit = "0123456789abcdef0123456789abcdef01234567"

var testDigest = "sha256:" + strings.Repeat("a", 64)
var runtimeRef = "registry.fly.io/momo-result@" + testDigest
var workerRef = "registry.fly.io/momo-result-analysis@" + testDigest

func call(t *testing.T, command string, args []string, input, root string) (int, string, string) {
	t.Helper()
	var out, diagnostics bytes.Buffer
	code := Run(command, args, strings.NewReader(input), &out, &diagnostics, root)
	return code, out.String(), diagnostics.String()
}
func TestPushedImageSelection(t *testing.T) {
	tag := "registry.fly.io/momo-result:" + testCommit + "-123-2"
	for _, tc := range []struct {
		input string
		ok    bool
	}{
		{fmt.Sprintf(`[%q,%q,"registry.fly.io/other@sha256:bad"]`, runtimeRef, runtimeRef), true},
		{fmt.Sprintf(`[%q,%q]`, runtimeRef, "registry.fly.io/momo-result@sha256:"+strings.Repeat("b", 64)), false},
		{`null`, false}, {`[]`, false}, {`["secret-reply"]`, false}, {fmt.Sprintf(`[%q] {}`, runtimeRef), false},
	} {
		code, out, err := call(t, "resolve-pushed-image", []string{tag}, tc.input, "")
		if (code == 0) != tc.ok {
			t.Fatalf("selection result: %d %s", code, err)
		}
		if tc.ok && out != runtimeRef+"\n" {
			t.Fatal(out)
		}
		if !tc.ok && (out != "" || strings.Contains(err, "secret-reply")) {
			t.Fatal("unsafe failed output")
		}
	}
}
func TestDeploymentRunIdentity(t *testing.T) {
	input := fmt.Sprintf(`{"name":"deploy","path":".github/workflows/deploy.yml","event":"push","head_branch":"master","head_repository":{"full_name":"owner/repo"},"conclusion":"success","run_attempt":2,"head_sha":%q,"token":"never-print"}`, testCommit)
	for _, bad := range []string{"", `"run_attempt":2|"run_attempt":2.5`, `"run_attempt":2|"run_attempt":"2"`, `"head_branch":"master"|"head_branch":"develop"`, `"conclusion":"success"|"conclusion":"failure"`} {
		value := input
		if bad != "" {
			parts := strings.Split(bad, "|")
			value = strings.Replace(value, parts[0], parts[1], 1)
		}
		code, out, err := call(t, "resolve-deployment-run", []string{"owner/repo"}, value, "")
		if (code == 0) != (bad == "") {
			t.Fatalf("unexpected result %d", code)
		}
		if bad == "" && out != "candidate_sha="+testCommit+"\nrun_attempt=2\n" {
			t.Fatal(out)
		}
		if strings.Contains(out+err, "never-print") {
			t.Fatal("provider content leaked")
		}
	}
}
func TestCanonicalManifestBaseline(t *testing.T) {
	// Both publishing and rollback hash this Go canonical representation.
	input := `{"schemaVersion":2,"layers":[{"size":123,"digest":"sha256:abc","mediaType":"application/test"}],"mediaType":"application/test","config":{"size":7,"digest":"sha256:def"}}`
	want := "{\"config\":{\"digest\":\"sha256:def\",\"size\":7},\"layers\":[{\"digest\":\"sha256:abc\",\"mediaType\":\"application/test\",\"size\":123}],\"mediaType\":\"application/test\",\"schemaVersion\":2}\n"
	code, out, _ := call(t, "canonical-json", nil, input, "")
	if code != 0 || out != want {
		t.Fatalf("%d %s", code, out)
	}
	for _, input := range []string{`{} {}`, `{"bad":`, ""} {
		code, out, _ = call(t, "canonical-json", nil, input, "")
		if code == 0 || out != "" {
			t.Fatal("accepted invalid stream")
		}
	}
}

func TestCanonicalUnicodeBaseline(t *testing.T) {
	want, err := os.ReadFile("testdata/canonical-unicode.json")
	if err != nil {
		t.Fatal(err)
	}
	input := "{\"schemaVersion\":2,\"annotations\":{\"paragraph\":\"before\u2029after\",\"line\":\"before\u2028after\"}}"
	for range 2 {
		code, out, diagnostics := call(t, "canonical-json", nil, input, "")
		if code != 0 || out != string(want) {
			t.Fatalf("canonical baseline differs: %d %q %s", code, out, diagnostics)
		}
		input = out
	}
}
func TestPublicEvidenceProjection(t *testing.T) {
	code, out, _ := call(t, "public-edge-evidence", nil, `{"event":"runtime_public_edge_smoke","schemaVersion":1,"status":"ok","providerSecret":"never-print"}`, "")
	if code != 0 || strings.Contains(out, "never-print") {
		t.Fatal(out)
	}
	code, out, _ = call(t, "public-edge-evidence", nil, `{"event":"runtime_public_edge_smoke","schemaVersion":1,"status":"failed"}`, "")
	if code == 0 || out != "" {
		t.Fatal("accepted failed smoke")
	}
}

func TestNormalPublisherRequiresTheCompletedDeploymentAttempt(t *testing.T) {
	valid := `{"schemaVersion":1,"status":"complete","mode":"normal","runId":"123","runAttempt":"3","commit":"` + testCommit + `"}`
	for _, change := range []func(object){
		nil,
		func(o object) { o["mode"] = "frozen" },
		func(o object) { o["runId"] = "456" },
		func(o object) { o["runAttempt"] = "2" },
		func(o object) { o["status"] = "draining" },
		func(o object) { o["providerSecret"] = "never-print" },
	} {
		input := valid
		if change != nil {
			input = string(mutated(t, []byte(valid), change))
		}
		code, out, diagnostics := call(t, "normal-deployment-completion", []string{"123", "3", testCommit}, input, "")
		if (code == 0) != (change == nil) || out != "" || strings.Contains(diagnostics, "never-print") {
			t.Fatal(code, out, diagnostics)
		}
	}
}

func TestProviderJSONRejectsInvalidUTF8(t *testing.T) {
	code, out, diagnostics := call(t, "canonical-json", nil, "{\"value\":\"\xff\"}", "")
	if code != 1 || out != "" || strings.Contains(diagnostics, "\xff") {
		t.Fatal("invalid UTF-8 was repaired into evidence")
	}
}

func TestProviderIntegersRejectExponentExpansion(t *testing.T) {
	for _, input := range []string{"1e999999999", "1e-999999999"} {
		if number(json.Number(input)) != "" {
			t.Fatal("accepted unbounded expansion")
		}
	}
	for input, want := range map[string]string{"0e999999999": "0", "1.0": "1", "10e1": "100", "9007199254740993": "9007199254740993"} {
		if got := number(json.Number(input)); got != want {
			t.Fatalf("%s => %s", input, got)
		}
	}
}
func TestSecretsFailClosed(t *testing.T) {
	for _, tc := range []struct {
		mode, input string
		ok          bool
	}{
		{"ready", `[{"name":"MOMO_PROCESSING_LISTENER_DATABASE_URL","status":"Staged"}]`, true},
		{"unstaged", `[{"name":"other","status":"Staged"}]`, false},
		{"ready", `[]`, false}, {"unstaged", `[]`, true}, {"unstaged", `[{}]`, false}, {"ready", `null`, false},
	} {
		code, out, _ := call(t, "analysis-secrets", []string{tc.mode}, tc.input, "")
		if (code == 0) != tc.ok || out != "" {
			t.Fatalf("%s: %d %q", tc.mode, code, out)
		}
	}
}
