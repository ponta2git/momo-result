package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type characterizationFixture struct {
	SchemaVersion int `json:"schemaVersion"`
	Preflight     []struct {
		Name                  string         `json:"name"`
		RemovedColumn         *string        `json:"removedColumn"`
		ExpectedMissingCounts map[string]int `json:"expectedMissingCounts"`
	} `json:"preflight"`
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

func TestHealthPayloadRejectsTrailingData(t *testing.T) {
	t.Parallel()
	payload := `{"status":"ok"}`
	atLimit := payload + strings.Repeat(" ", 4096-len(payload))
	if !decodeValidHealthPayload(strings.NewReader(atLimit)) {
		t.Fatal("complete health payload at the byte limit was rejected")
	}
	for _, input := range []string{payload + payload, atLimit + payload} {
		if decodeValidHealthPayload(strings.NewReader(input)) {
			t.Fatal("health payload with trailing JSON was accepted")
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

func loadCharacterizationFixture(t *testing.T) characterizationFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "contracts", "runtime-tool-characterization-v1.json")
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
	path := filepath.Join("..", "..", "..", "..", "contracts", "runtime-db-contract.json")
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
