package cievidence

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"
)

type postdeployError struct {
	kind string
	code int
}

func (e *postdeployError) Error() string { return e.kind }

func postdeployFailure(kind string) error { return &postdeployError{kind, 1} }

func postdeployEvidence(args []string) (string, error) {
	if len(args) == 0 || args[0] == "" || len(args)%2 != 1 {
		return "", &postdeployError{"InvalidArguments", 2}
	}
	required := []string{"database", "http", "http2", "processes", "redis", "web"}
	for index := 1; index < len(args); index += 2 {
		if args[index] != "--require-check" {
			return "", &postdeployError{"InvalidArguments", 2}
		}
		if !checkNamePattern.MatchString(args[index+1]) {
			return "", &postdeployError{"InvalidRequiredCheck", 2}
		}
		required = append(required, args[index+1])
	}
	info, err := os.Stat(args[0])
	if err != nil || !info.Mode().IsRegular() {
		return "", postdeployFailure("FileError")
	}
	file, err := os.Open(args[0])
	if err != nil {
		return "", postdeployFailure("FileError")
	}
	defer file.Close()
	const maxBytes = 1048576
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return "", postdeployFailure("FileError")
	}
	if len(data) > maxBytes {
		return "", postdeployFailure("JSONDecodeError")
	}
	value, err := decodeOne(data)
	if err != nil {
		return "", postdeployFailure("JSONDecodeError")
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return "", postdeployFailure("InvalidPayload")
	}
	evidence := object(raw)
	if !evidence.equals("event", "runtime_postdeploy_smoke") {
		return "", postdeployFailure("InvalidEvent")
	}
	if _, exists := evidence["schemaVersion"]; exists && !evidence.numberEquals("schemaVersion", 1) {
		return "", postdeployFailure("UnsupportedSchemaVersion")
	}
	if !evidence.equals("status", "ok") {
		return "", postdeployFailure("UnhealthyStatus")
	}
	checks, ok := evidence["checks"].([]any)
	if !ok {
		return "", postdeployFailure("InvalidChecks")
	}
	seen := make(map[string]bool)
	duplicate := false
	for _, value := range checks {
		check, ok := value.(string)
		if !ok || !checkNamePattern.MatchString(check) {
			return "", postdeployFailure("InvalidChecks")
		}
		duplicate = duplicate || seen[check]
		seen[check] = true
	}
	if duplicate {
		return "", postdeployFailure("DuplicateChecks")
	}
	for _, check := range required {
		if !seen[check] {
			return "", postdeployFailure("MissingRequiredChecks")
		}
	}
	return "{\"schemaVersion\":1,\"status\":\"ok\"}\n", nil
}

type readinessCheck struct {
	Timestamp string `json:"timestamp"`
	Event     string `json:"event"`
	WorkerID  string `json:"workerId"`
}

func workerReadiness(args []string) (string, error) {
	fail := errors.New("Worker readiness evidence did not match the selected machine and workers.")
	info, err := os.Stat(args[0])
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return "", fail
	}
	file, err := os.Open(args[0])
	if err != nil {
		return "", fail
	}
	defer file.Close()
	events := []string{"analysis_worker_ready", "ocr_rust_v2_worker_ready", "analysis_outbox_notification_route_ready", "analysis_outbox_ready"}
	workers := []string{args[2], args[3], args[2], args[2]}
	checks := make([]*readinessCheck, len(events))
	decoder := json.NewDecoder(file)
	for {
		var data json.RawMessage
		err := decoder.Decode(&data)
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fail
		}
		check, err := appReadinessEvent(data, args[1])
		if err != nil {
			return "", fail
		}
		if check == nil {
			continue
		}
		for index, event := range events {
			if check.Event == event && check.WorkerID == workers[index] {
				if _, err := time.Parse(time.RFC3339Nano, check.Timestamp); err != nil {
					return "", fail
				}
				// Provider order, rather than timestamp sorting, is the existing
				// meaning of "latest". Keep only the last matching occurrence.
				checks[index] = check
			}
		}
	}
	for _, check := range checks {
		if check == nil {
			return "", fail
		}
	}
	return encodeLine(struct {
		SchemaVersion    int               `json:"schemaVersion"`
		MachineID        string            `json:"machineId"`
		AnalysisWorkerID string            `json:"analysisWorkerId"`
		OCRWorkerID      string            `json:"ocrWorkerId"`
		Checks           []*readinessCheck `json:"checks"`
	}{1, args[1], args[2], args[3], checks})
}

func appReadinessEvent(data []byte, machine string) (*readinessCheck, error) {
	value, err := decodeOne(data)
	if err != nil {
		return nil, err
	}
	if value == nil {
		return nil, nil
	}
	outer, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Invalid provider log record.")
	}
	if !object(outer).equals("instance", machine) {
		return nil, nil
	}
	provider := outer["meta"]
	for _, key := range []string{"Event", "Provider"} {
		if provider == nil {
			return nil, nil
		}
		container, ok := provider.(map[string]any)
		if !ok {
			return nil, errors.New("Invalid provider log record.")
		}
		provider = container[key]
	}
	if provider != "app" {
		return nil, nil
	}
	message, ok := outer["message"].(string)
	if !ok {
		return nil, nil
	}
	inner, err := decodeObject([]byte(message))
	if err != nil {
		return nil, nil
	}
	fields, ok := inner["fields"].(map[string]any)
	if !ok {
		return nil, nil
	}
	event, eventOK := fields["event"].(string)
	worker, workerOK := fields["worker_id"].(string)
	if !eventOK || !workerOK {
		return nil, nil
	}
	timestamp, _ := outer["timestamp"].(string)
	return &readinessCheck{timestamp, event, worker}, nil
}
