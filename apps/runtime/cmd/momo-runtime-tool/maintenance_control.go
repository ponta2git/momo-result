package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"time"
)

const maintenanceControlEvent = "runtime_maintenance_control"

var cutoverIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
var maintenanceTokenPattern = regexp.MustCompile(`^[A-Za-z0-9._~+/=-]{32,512}$`)

type maintenanceDrainRequest struct {
	CutoverID string `json:"cutoverId"`
	StopEpoch int64  `json:"stopEpoch"`
	Stage     string `json:"stage"`
}

type maintenanceWriter struct {
	Name    string `json:"name"`
	Stage   string `json:"stage"`
	Status  string `json:"status"`
	Failure string `json:"failure,omitempty"`
}

type maintenanceSnapshot struct {
	Consumer  string              `json:"consumer"`
	Scope     string              `json:"scope"`
	CutoverID *string             `json:"cutoverId"`
	StopEpoch *int64              `json:"stopEpoch"`
	Stage     *string             `json:"stage"`
	Phase     string              `json:"phase"`
	Writers   []maintenanceWriter `json:"writers"`
	InFlight  struct {
		Requests      *int64 `json:"requests"`
		Continuations *int64 `json:"continuations"`
	} `json:"inFlight"`
}

func parseMaintenanceControl(args []string) (*maintenanceDrainRequest, error) {
	if len(args) == 1 && args[0] == "status" {
		return nil, nil
	}
	if len(args) != 7 || args[0] != "drain" {
		return nil, errors.New("invalid arguments")
	}
	values := make(map[string]string)
	for index := 1; index < len(args); index += 2 {
		key := args[index]
		if key != "--cutover-id" && key != "--stop-epoch" && key != "--stage" {
			return nil, errors.New("invalid arguments")
		}
		if _, exists := values[key]; exists {
			return nil, errors.New("invalid arguments")
		}
		values[key] = args[index+1]
	}
	epoch, err := strconv.ParseInt(values["--stop-epoch"], 10, 64)
	if err != nil || epoch <= 0 || epoch > 9007199254740991 || !cutoverIDPattern.MatchString(values["--cutover-id"]) ||
		(values["--stage"] != "admission" && values["--stage"] != "all") {
		return nil, errors.New("invalid arguments")
	}
	return &maintenanceDrainRequest{CutoverID: values["--cutover-id"], StopEpoch: epoch, Stage: values["--stage"]}, nil
}

func runMaintenanceControl(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	request, err := parseMaintenanceControl(args)
	if err != nil {
		writeResult(stderr, failureResult(maintenanceControlEvent, "InvalidArguments"))
		return 2
	}
	token := os.Getenv("MOMO_MAINTENANCE_OPERATIONS_TOKEN")
	if !maintenanceTokenPattern.MatchString(token) {
		writeResult(stderr, failureResult(maintenanceControlEvent, "MissingOrInvalidConfiguration"))
		return 1
	}
	// This control channel is always the local Caddy listener, with no proxy or redirects.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	snapshot, failure := requestMaintenanceControl(ctx, client, "http://127.0.0.1:8080/internal/maintenance/drain", token, request)
	if failure != "" {
		writeResult(stderr, failureResult(maintenanceControlEvent, failure))
		return 1
	}
	if json.NewEncoder(stdout).Encode(snapshot) != nil {
		writeResult(stderr, failureResult(maintenanceControlEvent, "OutputError"))
		return 1
	}
	return 0
}

func requestMaintenanceControl(ctx context.Context, client *http.Client, endpoint, token string, drain *maintenanceDrainRequest) (maintenanceSnapshot, string) {
	var snapshot maintenanceSnapshot
	method, expectedStatus := http.MethodGet, http.StatusOK
	var body io.Reader
	if drain != nil {
		method, expectedStatus = http.MethodPost, http.StatusAccepted
		encoded, err := json.Marshal(drain)
		if err != nil {
			return snapshot, "InvalidArguments"
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return snapshot, "ControlRequestError"
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if drain != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return snapshot, "ControlRequestError"
	}
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		switch response.StatusCode {
		case http.StatusUnauthorized:
			return snapshot, "Unauthorized"
		case http.StatusConflict:
			return snapshot, "CutoverConflict"
		default:
			return snapshot, "ControlResponseError"
		}
	}
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(encoded) > 4096 {
		return snapshot, "ControlResponseError"
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&snapshot) != nil || decoder.Decode(new(any)) != io.EOF || !validMaintenanceSnapshot(snapshot) {
		return maintenanceSnapshot{}, "ControlResponseError"
	}
	if drain != nil && (snapshot.CutoverID == nil || *snapshot.CutoverID != drain.CutoverID ||
		snapshot.StopEpoch == nil || *snapshot.StopEpoch != drain.StopEpoch || snapshot.Stage == nil || *snapshot.Stage != drain.Stage) {
		return maintenanceSnapshot{}, "ControlResponseError"
	}
	return snapshot, ""
}

func validMaintenanceSnapshot(snapshot maintenanceSnapshot) bool {
	if snapshot.Consumer != "momo-result-api" || snapshot.Scope != "process" || len(snapshot.Writers) != 2 ||
		snapshot.InFlight.Requests == nil || snapshot.InFlight.Continuations == nil ||
		*snapshot.InFlight.Requests < 0 || *snapshot.InFlight.Continuations < 0 {
		return false
	}
	for index, writer := range snapshot.Writers {
		if (index == 0 && (writer.Name != "http_admission" || writer.Stage != "admission")) ||
			(index == 1 && (writer.Name != "http_continuations_and_runtime" || writer.Stage != "all")) {
			return false
		}
		switch writer.Status {
		case "active", "draining", "drained":
			if writer.Failure != "" {
				return false
			}
		case "timed_out":
			if writer.Failure != "drain_timeout" {
				return false
			}
		case "failed":
			if writer.Failure != "drain_failed" {
				return false
			}
		default:
			return false
		}
	}
	if snapshot.CutoverID == nil || snapshot.StopEpoch == nil || snapshot.Stage == nil {
		return snapshot.CutoverID == nil && snapshot.StopEpoch == nil && snapshot.Stage == nil && snapshot.Phase == "running" &&
			snapshot.Writers[0].Status == "active" && snapshot.Writers[1].Status == "active"
	}
	if !cutoverIDPattern.MatchString(*snapshot.CutoverID) || *snapshot.StopEpoch <= 0 || *snapshot.StopEpoch > 9007199254740991 ||
		(*snapshot.Stage != "admission" && *snapshot.Stage != "all") || snapshot.Writers[0].Status == "active" {
		return false
	}
	selected := snapshot.Writers[:1]
	if *snapshot.Stage == "all" {
		if snapshot.Writers[1].Status == "active" {
			return false
		}
		selected = snapshot.Writers
	} else if snapshot.Writers[1].Status != "active" {
		return false
	}
	phase := "drained"
	for _, writer := range selected {
		if writer.Status == "failed" {
			phase = "failed"
			break
		}
		if writer.Status == "timed_out" {
			phase = "timed_out"
		} else if writer.Status == "draining" && phase == "drained" {
			phase = "draining"
		}
	}
	if phase == "drained" && (*snapshot.InFlight.Requests != 0 || (*snapshot.Stage == "all" && *snapshot.InFlight.Continuations != 0)) {
		return false
	}
	return snapshot.Phase == phase
}
