package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
				_, _ = fmt.Fprintf(response, `{"status":%q,"mode":"frozen"}`, status)
			}))
			defer server.Close()
			err := probeMaintenanceHTTP(context.Background(), server.Client(), server.URL, "example.com", "test-token")
			if (err == nil) != (failingPath == "") {
				t.Fatalf("unexpected probe result: %v", err)
			}
			if failingPath == "" && strings.Join(methods, ",") != "GET,GET,GET,POST" {
				t.Fatalf("missing route closure checks: %v", methods)
			}
		})
	}
}

func TestMaintenancePayloadRejectsLeakedFieldsAndTrailingData(t *testing.T) {
	t.Parallel()
	for _, payload := range []string{
		`{"status":"ready","mode":"normal"}`,
		`{"status":"ready","mode":"frozen","database":"secret"}`,
		`{"status":"ready","mode":"frozen"} {}`,
		`{"status":"ready","mode":"frozen"}` + strings.Repeat(" ", probeBodyLimit),
	} {
		if decodeMaintenancePayload(strings.NewReader(payload), "ready") {
			t.Fatal("accepted invalid maintenance payload")
		}
	}
}
