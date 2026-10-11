package cireport

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func invoke(command string, args []string, input string) (int, string, string) {
	var out, stderr bytes.Buffer
	status := Run(command, args, strings.NewReader(input), &out, &stderr, ".")
	return status, out.String(), stderr.String()
}

func TestCountAvoidsExponentExpansion(t *testing.T) {
	for _, input := range []string{"1e999999999", "1e-999999999", "-1e999999999"} {
		if _, ok := count(json.Number(input)); ok {
			t.Fatal("accepted unbounded expansion")
		}
	}
	for input, want := range map[string]string{"0e999999999": "0", "0e-999999999": "0", "1.0": "1", "10e1": "100", "9007199254740993": "9007199254740993"} {
		got, ok := count(json.Number(input))
		if !ok || got.String() != want {
			t.Fatalf("%s rejected or altered", input)
		}
	}
}
func put(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
func read(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
func object(t *testing.T, data string) map[string]any {
	t.Helper()
	value, err := singleJSON(strings.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	result, ok := value.(map[string]any)
	if !ok {
		t.Fatal("expected object")
	}
	return result
}

const webFixture = `{"total":{
"statements":{"covered":1,"total":3,"pct":33.33},
"branches":{"covered":0,"total":0,"pct":100},
"functions":{"covered":0,"total":0,"pct":"Unknown"},
"lines":{"covered":2,"total":2,"pct":100}}}`
const apiFixture = `<scoverage statement-count="3" statements-invoked="1" statement-rate="33.33" branch-rate="50.00"><packages/></scoverage>`

func TestCoverageOutputsAndMissingReplacement(t *testing.T) {
	for _, subsystem := range []string{"web", "api"} {
		t.Run(subsystem, func(t *testing.T) {
			root := t.TempDir()
			output := filepath.Join(root, "summary")
			path, fixture := filepath.Join(root, "apps/web/coverage/coverage-summary.json"), webFixture
			if subsystem == "api" {
				path, fixture = filepath.Join(root, "apps/api/target/out/jvm/scala-3.9.0/momo-result-api/scoverage-report/scoverage.xml"), apiFixture
			}
			args := []string{subsystem, "--root", root, "--out", output}
			put(t, path, fixture)
			if code, _, err := invoke("coverage", args, ""); code != 0 {
				t.Fatalf("code %d: %s", code, err)
			}
			raw := object(t, read(t, filepath.Join(output, "raw-summary.json")))
			if raw["status"] != "ok" {
				t.Fatal(raw)
			}
			metrics := raw["metrics"].(map[string]any)
			if metrics["statements"].(map[string]any)["pct"] != json.Number("33.3") {
				t.Fatal(metrics)
			}
			markdown := read(t, filepath.Join(output, "summary.md"))
			if subsystem == "web" && !strings.Contains(markdown, "| functions | - | 0 / 0 |") {
				t.Fatal(markdown)
			}
			if subsystem == "api" && (!strings.Contains(markdown, "| branches | 50.0% | - |") || !strings.Contains(markdown, "omitted from the measured totals")) {
				t.Fatal(markdown)
			}
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			for _, allowed := range []bool{false, true} {
				missingArgs, wantCode := append([]string{}, args...), 1
				if allowed {
					missingArgs = append(missingArgs, "--allow-missing")
					wantCode = 0
				}
				if code, _, _ := invoke("coverage", missingArgs, ""); code != wantCode {
					t.Fatalf("missing: %d", code)
				}
				raw = object(t, read(t, filepath.Join(output, "raw-summary.json")))
				if raw["status"] != "missing" || len(raw["metrics"].(map[string]any)) != 0 {
					t.Fatal(raw)
				}
				if strings.Contains(read(t, filepath.Join(output, "summary.md")), "| statements |") {
					t.Fatal("stale markdown")
				}
			}
		})
	}
}

func TestCoverageRejectsInvalidAndReplacesPrevious(t *testing.T) {
	invalid := []string{`{broken`, webFixture + webFixture}
	for _, field := range []string{"pct", "covered", "total"} {
		for _, value := range []string{"null", "true", `"private-value"`, "-1", "0.5", "101"} {
			v := object(t, webFixture)
			v["total"].(map[string]any)["statements"].(map[string]any)[field] = json.RawMessage(value)
			data, err := json.Marshal(v)
			if err != nil {
				t.Fatal(err)
			}
			invalid = append(invalid, string(data))
		}
	}
	for _, fixture := range invalid {
		t.Run(fixture, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "apps/web/coverage/coverage-summary.json")
			output := filepath.Join(root, "summary")
			args := []string{"web", "--root", root, "--out", output, "--allow-missing"}
			put(t, path, webFixture)
			if code, _, _ := invoke("coverage", args, ""); code != 0 {
				t.Fatal(code)
			}
			put(t, path, fixture)
			code, _, stderr := invoke("coverage", args, "")
			if code != 1 || strings.Contains(stderr, "private-value") {
				t.Fatalf("%d %s", code, stderr)
			}
			raw := object(t, read(t, filepath.Join(output, "raw-summary.json")))
			if raw["status"] != "invalid" || len(raw["metrics"].(map[string]any)) != 0 {
				t.Fatal(raw)
			}
			if strings.Contains(read(t, filepath.Join(output, "summary.md")), "| statements |") {
				t.Fatal("stale markdown")
			}
		})
	}
}

func TestCoverageMetricContracts(t *testing.T) {
	cases := []struct {
		pct, covered, total string
		valid               bool
		rounded             string
	}{
		{`"Unknown"`, `0`, `0`, true, "null"}, {`"Unknown"`, `1`, `1`, false, ""},
		{`null`, `0`, `0`, false, ""}, {`50`, `0`, `0`, false, ""}, {`0`, `0`, `0`, true, "0"},
		{`50`, `null`, `null`, true, "50"}, {`50`, `null`, `2`, false, ""},
		{`0.45`, `1`, `223`, true, "0.4"}, {`99`, `1`, `3`, false, ""},
		{`100`, `9007199254740993`, `9007199254740993`, true, "100"},
		{`100`, `9007199254740993`, `9007199254740992`, false, ""},
		{`100`, `1.0000000000000001`, `1`, false, ""},
	}
	for _, c := range cases {
		t.Run(c.pct+"/"+c.covered+"/"+c.total, func(t *testing.T) {
			v := object(t, `{"pct":`+c.pct+`,"covered":`+c.covered+`,"total":`+c.total+`}`)
			m, err := validateMetric(v["pct"], v["covered"], v["total"])
			if (err == nil) != c.valid {
				t.Fatalf("valid=%v err=%v", c.valid, err)
			}
			if err == nil {
				data, _ := json.Marshal(m.Pct)
				if string(data) != c.rounded {
					t.Fatalf("got %s want %s", data, c.rounded)
				}
			}
		})
	}
}

func TestAPICoverageRejectsAmbiguousAndMalformedXML(t *testing.T) {
	for _, fixture := range []string{`<broken`, apiFixture + apiFixture, apiFixture + "secret", strings.Replace(apiFixture, `50.00`, `NaN`, 1), strings.Replace(apiFixture, `statements-invoked="1"`, `statements-invoked="1/1"`, 1), strings.Replace(apiFixture, `scoverage`, `other`, 2), `<scoverage xmlns="urn:other"/>`} {
		if _, err := apiCoverage(strings.NewReader(fixture)); err == nil {
			t.Fatalf("accepted %s", fixture)
		}
	}
	root := t.TempDir()
	output := filepath.Join(root, "summary")
	for _, version := range []string{"3.8.4", "3.9.0"} {
		put(t, filepath.Join(root, "apps/api/target/out/jvm/scala-"+version+"/momo-result-api/scoverage-report/scoverage.xml"), apiFixture)
	}
	if code, _, _ := invoke("coverage", []string{"api", "--root", root, "--out", output}, ""); code != 1 {
		t.Fatal(code)
	}
	if !strings.Contains(read(t, filepath.Join(output, "raw-summary.json")), "Ambiguous") {
		t.Fatal("missing ambiguity reason")
	}
}

func TestRuntimeLogsSafeAggregation(t *testing.T) {
	input := `{"app":"api","level":"ERROR","message":"private-value","exception_classes":["RuntimeException"]}
{"app":"api","level":"ERROR","message":"private-value","exception_classes":["RuntimeException",17]}
unstructured private-value
null
[]
{"app":"invalid\n","exception_classes":"not-an-array"}
`
	code, out, stderr := invoke("runtime-logs", nil, input)
	if code != 0 || strings.Contains(out+stderr, "private-value") {
		t.Fatalf("%d %s %s", code, out, stderr)
	}
	r := object(t, out)
	if r["unstructuredLineCount"] != json.Number("3") {
		t.Fatal(r)
	}
	classes := r["exceptionClasses"].(map[string]any)
	if classes["RuntimeException"] != json.Number("2") || classes["UnknownError"] != json.Number("1") {
		t.Fatal(classes)
	}
	records := r["records"].([]any)
	if len(records) != 2 || records[0].(map[string]any)["app"] != "api" || records[0].(map[string]any)["count"] != json.Number("2") {
		t.Fatal(records)
	}
	for _, input := range []string{"", `{"message":"` + strings.Repeat("private-value", 10000) + `"}`} {
		code, out, _ = invoke("runtime-logs", nil, input)
		if code != 0 || strings.Contains(out, "private-value") {
			t.Fatal(code)
		}
	}
	code, out, _ = invoke("runtime-logs", nil, "{} {}\n\n{broken")
	if code != 0 || object(t, out)["unstructuredLineCount"] != json.Number("3") {
		t.Fatal(out)
	}
}

type brokenReader struct{}

func (brokenReader) Read([]byte) (int, error) { return 0, errors.New("private-read-error") }

type brokenWriter struct{}

func (brokenWriter) Write([]byte) (int, error) { return 0, errors.New("private-write-error") }
func TestIOErrorsDoNotExposeContent(t *testing.T) {
	for _, tc := range []struct {
		in  io.Reader
		out io.Writer
	}{{brokenReader{}, io.Discard}, {strings.NewReader("{}"), brokenWriter{}}} {
		var stderr bytes.Buffer
		if code := Run("runtime-logs", nil, tc.in, tc.out, &stderr, "."); code != 1 || strings.Contains(stderr.String(), "private-") {
			t.Fatalf("%d %s", code, stderr.String())
		}
	}
}

func TestHelpAndUsage(t *testing.T) {
	for _, command := range []string{"coverage", "runtime-logs", "analysis-report", "analysis-report-state", "analysis-summary"} {
		if code, out, _ := invoke(command, []string{"--help"}, ""); code != 0 || !strings.Contains(out, command) {
			t.Fatal(command)
		}
		if code, _, _ := invoke(command, []string{"--unexpected", "extra", "extra"}, ""); code != 2 {
			t.Fatalf("%s %d", command, code)
		}
	}
}
