package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type characterizationFixture struct {
	SchemaVersion int `json:"schemaVersion"`
	Preflight     []struct {
		Name                  string         `json:"name"`
		RemovedColumn         *string        `json:"removedColumn"`
		ExpectedMissingCounts map[string]int `json:"expectedMissingCounts"`
	} `json:"preflight"`
	RenderNginx []struct {
		Name                            string   `json:"name"`
		AppEnv                          string   `json:"appEnv"`
		CanonicalHost                   string   `json:"canonicalHost"`
		ExtraAllowedHosts               string   `json:"extraAllowedHosts"`
		OriginLockToken                 string   `json:"originLockToken"`
		ExpectedStatus                  string   `json:"expectedStatus"`
		ExpectedAllowedHosts            []string `json:"expectedAllowedHosts"`
		ExpectedOptionalOriginLockHosts []string `json:"expectedOptionalOriginLockHosts"`
	} `json:"renderNginx"`
	Smoke struct {
		ProcessCases []struct {
			Name            string   `json:"name"`
			CommandLines    []string `json:"commandLines"`
			ExpectedMissing []string `json:"expectedMissing"`
		} `json:"processCases"`
		CheckCases []struct {
			Mode           string   `json:"mode"`
			ExpectedChecks []string `json:"expectedChecks"`
		} `json:"checkCases"`
		HealthPayloadCases []struct {
			Name          string          `json:"name"`
			Payload       json.RawMessage `json:"payload"`
			ExpectedValid bool            `json:"expectedValid"`
		} `json:"healthPayloadCases"`
	} `json:"smoke"`
}

func TestCharacterizationFixture(t *testing.T) {
	t.Parallel()
	fixture := loadCharacterizationFixture(t)
	contract := loadTestContract(t)

	for _, testCase := range fixture.Preflight {
		t.Run("preflight/"+testCase.Name, func(t *testing.T) {
			snapshot := snapshotFromContract(contract)
			if testCase.RemovedColumn != nil {
				delete(snapshot.Columns, *testCase.RemovedColumn)
			}
			actual := missingContractCounts(contract, snapshot)
			if !equalIntMaps(actual, testCase.ExpectedMissingCounts) {
				t.Fatalf("missing counts = %#v, want %#v", actual, testCase.ExpectedMissingCounts)
			}
		})
	}

	for _, testCase := range fixture.RenderNginx {
		t.Run("render-nginx/"+testCase.Name, func(t *testing.T) {
			values, err := resolveNginxRenderValues(nginxRenderConfig{
				AppEnv:            testCase.AppEnv,
				CanonicalHost:     testCase.CanonicalHost,
				ExtraAllowedHosts: testCase.ExtraAllowedHosts,
				OriginLockToken:   testCase.OriginLockToken,
			})
			status := "ok"
			if err != nil {
				status = "failed"
			}
			if status != testCase.ExpectedStatus {
				t.Fatalf("status = %q, want %q", status, testCase.ExpectedStatus)
			}
			if status == "ok" {
				assertStringsEqual(t, values.AllowedHosts, testCase.ExpectedAllowedHosts)
				assertStringsEqual(t, values.OptionalOriginLockHosts, testCase.ExpectedOptionalOriginLockHosts)
			}
		})
	}

	for _, testCase := range fixture.Smoke.ProcessCases {
		t.Run("smoke/processes/"+testCase.Name, func(t *testing.T) {
			assertStringsEqual(t, missingRuntimeProcesses(testCase.CommandLines), testCase.ExpectedMissing)
		})
	}
	for _, testCase := range fixture.Smoke.CheckCases {
		t.Run("smoke/checks/"+testCase.Mode, func(t *testing.T) {
			assertStringsEqual(t, localSmokeChecks(testCase.Mode), testCase.ExpectedChecks)
		})
	}
	for _, testCase := range fixture.Smoke.HealthPayloadCases {
		t.Run("smoke/health/"+testCase.Name, func(t *testing.T) {
			actual := decodeValidHealthPayload(bytes.NewReader(testCase.Payload))
			if actual != testCase.ExpectedValid {
				t.Fatalf("valid health payload = %v, want %v", actual, testCase.ExpectedValid)
			}
		})
	}
}

func TestRenderNginxWritesExpectedConfigurationAndSafeResult(t *testing.T) {
	templatePath := filepath.Join(t.TempDir(), "nginx.conf.template")
	outputPath := filepath.Join(t.TempDir(), "nginx.conf")
	template := allowedHostPlaceholder + "\n" + optionalOriginHostPlaceholder + "\n" + originLockTokenPlaceholder
	if err := os.WriteFile(templatePath, []byte(template), 0o600); err != nil {
		t.Fatal(err)
	}
	secret := "0123456789abcdef0123456789abcdef"
	t.Setenv("APP_ENV", "prod")
	t.Setenv("MOMO_CANONICAL_HOST", "example.com")
	t.Setenv("MOMO_EXTRA_ALLOWED_HOSTS", "api.example.com")
	t.Setenv("MOMO_ORIGIN_LOCK_TOKEN", secret)
	t.Setenv("MOMO_NGINX_TEMPLATE_PATH", templatePath)
	t.Setenv("MOMO_NGINX_OUTPUT_PATH", outputPath)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if exitCode := runRenderNginx(&stdout, &stderr); exitCode != 0 {
		t.Fatalf("exit code = %d, stderr = %s", exitCode, stderr.String())
	}
	rendered, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"example.com" 1;`, `"api.example.com" 1;`, `"` + secret + `"`} {
		if !strings.Contains(string(rendered), expected) {
			t.Fatalf("rendered config is missing %q", expected)
		}
	}
	if strings.Contains(stdout.String(), secret) || strings.Contains(stderr.String(), secret) {
		t.Fatal("origin lock token leaked to command output")
	}
}

func TestNginxTemplateRequiresEachPlaceholderExactlyOnce(t *testing.T) {
	t.Parallel()
	valid := allowedHostPlaceholder + optionalOriginHostPlaceholder + originLockTokenPlaceholder
	if err := validateNginxTemplate(valid); err != nil {
		t.Fatalf("valid template rejected: %v", err)
	}
	if err := validateNginxTemplate(valid + allowedHostPlaceholder); err == nil {
		t.Fatal("duplicate placeholder accepted")
	}
	if err := validateNginxTemplate(strings.ReplaceAll(valid, originLockTokenPlaceholder, "")); err == nil {
		t.Fatal("missing placeholder accepted")
	}
}

func TestHealthPayloadRejectsTrailingData(t *testing.T) {
	t.Parallel()
	if decodeValidHealthPayload(strings.NewReader(`{"status":"ok"}{"status":"ok"}`)) {
		t.Fatal("health payload with trailing JSON was accepted")
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
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if exitCode := runCLI(context.Background(), []string{"unknown"}, &stdout, &stderr); exitCode != 2 {
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
}

func TestPostdeployEvidenceValidationSupportsCurrentAndLegacyEvidence(t *testing.T) {
	t.Parallel()
	legacy := map[string]any{
		"event":  localSmokeEvent,
		"status": "ok",
		"checks": []any{"database", "http", "processes", "redis", "web"},
	}
	current := map[string]any{
		"event":         localSmokeEvent,
		"schemaVersion": float64(1),
		"status":        "ok",
		"checks":        []any{"database", "http", "processes", "publicEdge", "redis", "web"},
	}
	if errorKind := validatePostdeployEvidence(legacy, nil); errorKind != "" {
		t.Fatalf("legacy evidence failed: %s", errorKind)
	}
	if errorKind := validatePostdeployEvidence(current, []string{"publicEdge"}); errorKind != "" {
		t.Fatalf("current evidence failed: %s", errorKind)
	}
	duplicate := map[string]any{
		"event":  localSmokeEvent,
		"status": "ok",
		"checks": []any{"database", "database"},
	}
	if errorKind := validatePostdeployEvidence(duplicate, nil); errorKind != "DuplicateChecks" {
		t.Fatalf("duplicate error = %q", errorKind)
	}
	current["schemaVersion"] = float64(2)
	if errorKind := validatePostdeployEvidence(current, nil); errorKind != "UnsupportedSchemaVersion" {
		t.Fatalf("schema error = %q", errorKind)
	}
}

func TestPostdeployEvidenceCLIProducesSafeResult(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "evidence.json")
	payload := `{"event":"runtime_postdeploy_smoke","schemaVersion":1,"status":"ok","checks":["database","http","processes","publicEdge","redis","web"]}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runValidatePostdeployEvidence(
		[]string{path, "--require-check", "publicEdge"}, &stdout, &stderr,
	)
	if exitCode != 0 || stderr.Len() != 0 {
		t.Fatalf("exit=%d stderr=%s", exitCode, stderr.String())
	}
	var result evidenceValidationResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "ok" || result.SchemaVersion != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestLogSummaryDropsMessagesAndUnstructuredContent(t *testing.T) {
	t.Parallel()
	sensitive := "sensitive-value-that-must-not-appear"
	input := strings.Join([]string{
		`{"app":"momo-result-api","level":"ERROR","message":"` + sensitive + `","exception_classes":["RuntimeException"]}`,
		"unstructured " + sensitive,
	}, "\n")
	summary, err := summarizeLogs(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), sensitive) {
		t.Fatal("sensitive log content leaked into summary")
	}
	if summary.UnstructuredLineCount != 1 || summary.ExceptionClasses["RuntimeException"] != 1 {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestRuntimeStopGraceIsBounded(t *testing.T) {
	t.Setenv(stopGraceEnvironmentName, "45")
	grace, err := runtimeStopGrace()
	if err != nil || grace != 45*time.Second {
		t.Fatalf("grace=%s err=%v", grace, err)
	}
	t.Setenv(stopGraceEnvironmentName, "91")
	if _, err := runtimeStopGrace(); err == nil {
		t.Fatal("unsafe stop grace accepted")
	}
}

func loadCharacterizationFixture(t *testing.T) characterizationFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "contracts", "runtime-tool-characterization-v1.json")
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture characterizationFixture
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.SchemaVersion != 1 {
		t.Fatalf("fixture schema version = %d", fixture.SchemaVersion)
	}
	return fixture
}

func loadTestContract(t *testing.T) runtimeDBContract {
	t.Helper()
	path := filepath.Join("..", "..", "..", "contracts", "runtime-db-contract.json")
	contract, err := loadRuntimeDBContract(path)
	if err != nil {
		t.Fatal(err)
	}
	return contract
}

func snapshotFromContract(contract runtimeDBContract) databaseSnapshot {
	return databaseSnapshot{
		Columns:           stringSet(contract.Columns),
		Tables:            stringSet(contract.Tables),
		Indexes:           stringSet(contract.Indexes),
		HardenedFunctions: stringSet(contract.HardenedFunctions),
		SeedMemberIDs:     stringSet(contract.SeedMemberIDs),
	}
}

func equalIntMaps(left map[string]int, right map[string]int) bool {
	if len(left) != len(right) {
		return false
	}
	for key, leftValue := range left {
		if right[key] != leftValue {
			return false
		}
	}
	return true
}

func assertStringsEqual(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("values = %#v, want %#v", actual, expected)
	}
	for index, value := range actual {
		if expected[index] != value {
			t.Fatalf("values = %#v, want %#v", actual, expected)
		}
	}
}
