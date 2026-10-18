package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const fixtureDatabaseProofJSON = `{"formatVersion":1,"targetFingerprint":"6771b0dca574fd57070c4e09362db28a2603f50c6a31c7ace1690390a4fa7169","ledgerFingerprint":"6c999946c7604635b2672944e5bd546152a17281205cfb4429ed3df8d20cd5ab"}`

const fixtureMaintenanceReadyJSON = `{"status":"ready","mode":"frozen","database":` + fixtureDatabaseProofJSON + `}`

func TestMaintenanceModeIsStrict(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		value   string
		present bool
		want    maintenanceMode
	}{
		{"", false, maintenanceNormal}, {"normal", true, maintenanceNormal}, {"frozen", true, maintenanceFrozen},
		{"", true, ""}, {"NORMAL", true, ""}, {" frozen", true, ""}, {"frozen ", true, ""}, {"drain", true, ""},
	} {
		got, err := parseMaintenanceMode(testCase.value, testCase.present)
		if got != testCase.want || (err != nil) != (testCase.want == "") {
			t.Fatalf("parse mode %q present=%v: got %q %v", testCase.value, testCase.present, got, err)
		}
	}
}

func TestMaintenanceCommandGuardsRunBeforeSideEffects(t *testing.T) {
	for _, testCase := range []struct {
		mode       string
		args       []string
		errorClass string
	}{
		{"invalid-secret", []string{"serve"}, "InvalidMaintenanceMode"},
		{"", []string{"serve"}, "InvalidMaintenanceMode"},
		{"frozen", []string{"smoke", "local"}, "MaintenanceModeMismatch"},
		{"frozen", []string{"smoke", "edge"}, "MaintenanceModeMismatch"},
		{"frozen", []string{"smoke", "http2"}, "MaintenanceModeMismatch"},
		{"normal", []string{"smoke", "maintenance"}, "MaintenanceModeMismatch"},
	} {
		t.Setenv("MOMO_MAINTENANCE_MODE", testCase.mode)
		var stdout, stderr bytes.Buffer
		code := runCLI(context.Background(), testCase.args, &stdout, &stderr)
		if code != 1 || stdout.Len() != 0 || !strings.Contains(stderr.String(), testCase.errorClass) || strings.Contains(stderr.String(), "invalid-secret") {
			t.Fatalf("guard returned code %d output %q %q", code, stdout.String(), stderr.String())
		}
	}
}

func TestMaintenanceProbeRequiresFrozenReadinessAndClosedRoutes(t *testing.T) {
	t.Parallel()
	for _, failingPath := range []string{"", maintenanceReadinessPath, "/healthz", "/api/auth/me", "/api/ocr/jobs"} {
		t.Run(failingPath, func(t *testing.T) {
			var methods []string
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				methods = append(methods, request.Method)
				status, code := "maintenance", http.StatusServiceUnavailable
				if request.URL.Path == maintenanceReadinessPath {
					status, code = "ready", http.StatusOK
				}
				if request.URL.Path == "/healthz" {
					code = http.StatusOK
				}
				if request.URL.Path == failingPath {
					status = "ok"
				}
				response.WriteHeader(code)
				if request.URL.Path == maintenanceReadinessPath {
					_, _ = fmt.Fprintf(response, `{"status":%q,"mode":"frozen","database":%s}`, status, fixtureDatabaseProofJSON)
				} else {
					_, _ = fmt.Fprintf(response, `{"status":%q,"mode":"frozen"}`, status)
				}
			}))
			defer server.Close()
			proof, err := probeMaintenanceHTTP(context.Background(), server.Client(), server.URL, "example.com", "test-token")
			if (err == nil) != (failingPath == "") {
				t.Fatalf("unexpected probe result: %v", err)
			}
			if failingPath == "" && strings.Join(methods, ",") != "GET,GET,GET,POST" {
				t.Fatalf("missing route closure checks: %v", methods)
			}
			if failingPath == "" && !proof.valid() {
				t.Fatal("did not retain the validated API connection proof")
			}
		})
	}
}

func TestMaintenancePayloadRejectsLeakedFieldsAndTrailingData(t *testing.T) {
	t.Parallel()
	for _, payload := range []string{
		`{"status":"ready","mode":"normal"}`,
		`{"status":"ready","mode":"frozen"}`,
		`{"status":"ready","mode":"frozen","database":null}`,
		`{"status":"ready","mode":"frozen","database":"secret"}`,
		strings.Replace(fixtureMaintenanceReadyJSON, `"formatVersion":1`, `"formatVersion":2`, 1),
		strings.Replace(fixtureMaintenanceReadyJSON, `"formatVersion":1`, `"formatVersion":1,"role":"secret"`, 1),
		strings.Replace(fixtureMaintenanceReadyJSON, `"mode":"frozen"`, `"mode":"frozen","host":"secret"`, 1),
		strings.Replace(fixtureMaintenanceReadyJSON, "6771b0d", "6771B0D", 1),
		strings.Replace(fixtureMaintenanceReadyJSON, "6c999946", "invalid-", 1),
		fixtureMaintenanceReadyJSON + ` {}`,
		fixtureMaintenanceReadyJSON + strings.Repeat(" ", probeBodyLimit),
	} {
		if _, err := decodeMaintenancePayload(strings.NewReader(payload), "ready"); err == nil {
			t.Fatal("accepted invalid maintenance payload")
		}
	}
}

func TestMaintenanceResultRetainsOnlyValidatedProof(t *testing.T) {
	t.Parallel()
	proof, err := decodeMaintenancePayload(strings.NewReader(fixtureMaintenanceReadyJSON), "ready")
	if err != nil {
		t.Fatal(err)
	}
	result := successResult(maintenanceSmokeEvent)
	result.Database = proof
	var output bytes.Buffer
	writeResult(&output, result)
	var encoded struct {
		Database json.RawMessage `json:"database"`
	}
	if json.Unmarshal(output.Bytes(), &encoded) != nil || string(encoded.Database) != fixtureDatabaseProofJSON {
		t.Fatalf("connection proof changed during result serialization: %s", output.String())
	}
	if _, err := decodeMaintenancePayload(strings.NewReader(strings.Replace(fixtureMaintenanceReadyJSON, `"ready"`, `"maintenance"`, 1)), "maintenance"); err == nil {
		t.Fatal("accepted database proof on a normal closed route")
	}
}
