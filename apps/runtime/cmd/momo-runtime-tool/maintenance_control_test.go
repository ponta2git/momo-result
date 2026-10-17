package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const admissionDrainSnapshot = `{"consumer":"momo-result-api","scope":"process","cutoverId":"fixture-1","stopEpoch":7,"stage":"admission","phase":"drained","writers":[{"name":"http_admission","stage":"admission","status":"drained"},{"name":"http_continuations_and_runtime","stage":"all","status":"active"}],"inFlight":{"requests":0,"continuations":1}}`

func TestMaintenanceControlUsesAuthenticatedLocalProtocol(t *testing.T) {
	const token = "maintenance-fixture-token-00000000"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer "+token || request.Header.Get("Content-Type") != "application/json" {
			t.Error("control request omitted authentication or JSON method")
		}
		body, _ := io.ReadAll(request.Body)
		if string(body) != `{"cutoverId":"fixture-1","stopEpoch":7,"stage":"admission"}` {
			t.Error("control request changed the cutover identity")
		}
		writer.WriteHeader(http.StatusAccepted)
		_, _ = writer.Write([]byte(admissionDrainSnapshot))
	}))
	defer server.Close()
	request := maintenanceDrainRequest{CutoverID: "fixture-1", StopEpoch: 7, Stage: "admission"}
	snapshot, failure := requestMaintenanceControl(context.Background(), server.Client(), server.URL, token, &request)
	if failure != "" || snapshot.Phase != "drained" || snapshot.InFlight.Continuations == nil || *snapshot.InFlight.Continuations != 1 {
		t.Fatal("admission receipt with a permitted continuation was rejected", failure)
	}
}

func TestMaintenanceControlRejectsUntrustedOrInconsistentReceipts(t *testing.T) {
	cases := []string{
		strings.Replace(admissionDrainSnapshot, `"consumer":"momo-result-api"`, `"consumer":"momo-result-api","secret":"must-not-be-output"`, 1),
		admissionDrainSnapshot + `{}`,
		strings.Repeat(" ", 4097),
		strings.Replace(admissionDrainSnapshot, `"requests":0`, `"requests":1`, 1),
		strings.Replace(admissionDrainSnapshot, `"requests":0`, `"requests":null`, 1),
		strings.Replace(admissionDrainSnapshot, `"cutoverId":"fixture-1"`, `"cutoverId":"different"`, 1),
		strings.Replace(admissionDrainSnapshot, `"phase":"drained"`, `"phase":"failed"`, 1),
		strings.Replace(admissionDrainSnapshot, `"status":"drained"`, `"status":"timed_out"`, 1),
	}
	for index, body := range cases {
		t.Run(strings.Repeat("x", index+1), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(http.StatusAccepted)
				_, _ = writer.Write([]byte(body))
			}))
			defer server.Close()
			request := maintenanceDrainRequest{CutoverID: "fixture-1", StopEpoch: 7, Stage: "admission"}
			_, failure := requestMaintenanceControl(context.Background(), server.Client(), server.URL, "token", &request)
			if failure != "ControlResponseError" {
				t.Fatal("unsafe receipt accepted")
			}
		})
	}
}

func TestMaintenanceControlRejectsMalformedArgumentsBeforeNetwork(t *testing.T) {
	for _, args := range [][]string{
		{}, {"status", "extra"}, {"drain"},
		{"drain", "--cutover-id", "fixture", "--stop-epoch", "0", "--stage", "all"},
		{"drain", "--cutover-id", "fixture", "--stop-epoch", "9007199254740992", "--stage", "all"},
		{"drain", "--cutover-id", "fixture", "--cutover-id", "7", "--stage", "all"},
		{"drain", "--cutover-id", "fixture", "--stop-epoch", "7", "--stage", "unexpected"},
	} {
		if _, err := parseMaintenanceControl(args); err == nil {
			t.Fatal("invalid control arguments accepted")
		}
	}
	if _, err := parseMaintenanceControl([]string{"drain", "--stage", "all", "--stop-epoch", "7", "--cutover-id", "fixture"}); err != nil {
		t.Fatal("valid control arguments rejected")
	}
}
