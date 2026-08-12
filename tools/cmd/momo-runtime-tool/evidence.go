package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
)

const postdeployEvidenceValidationEvent = "runtime_postdeploy_evidence_validation"

var checkNamePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*$`)

var corePostdeployChecks = []string{"database", "http", "processes", "redis", "web"}

type evidenceValidationResult struct {
	Event         string `json:"event,omitempty"`
	SchemaVersion int    `json:"schemaVersion,omitempty"`
	Status        string `json:"status"`
	ErrorKind     string `json:"errorKind,omitempty"`
}

func runValidatePostdeployEvidence(args []string, stdout io.Writer, stderr io.Writer) int {
	path, required, errorKind := parseEvidenceArguments(args)
	if errorKind != "" {
		writeEvidenceValidationResult(stderr, evidenceValidationResult{
			Event: postdeployEvidenceValidationEvent, Status: "failed", ErrorKind: errorKind,
		})
		return 2
	}
	file, err := os.Open(path)
	if err != nil {
		writeEvidenceFailure(stderr, "FileError")
		return 1
	}
	defer file.Close()
	payload, err := decodeOneJSONValue(io.LimitReader(file, 1_048_577))
	if err != nil {
		writeEvidenceFailure(stderr, "JSONDecodeError")
		return 1
	}
	if errorKind := validatePostdeployEvidence(payload, required); errorKind != "" {
		writeEvidenceFailure(stderr, errorKind)
		return 1
	}
	writeEvidenceValidationResult(stdout, evidenceValidationResult{SchemaVersion: 1, Status: "ok"})
	return 0
}

func parseEvidenceArguments(args []string) (string, []string, string) {
	if len(args) < 1 || args[0] == "" {
		return "", nil, "InvalidArguments"
	}
	path := args[0]
	required := make([]string, 0)
	for index := 1; index < len(args); {
		if args[index] != "--require-check" || index+1 >= len(args) {
			return "", nil, "InvalidArguments"
		}
		check := args[index+1]
		if !checkNamePattern.MatchString(check) {
			return "", nil, "InvalidRequiredCheck"
		}
		required = append(required, check)
		index += 2
	}
	return path, required, ""
}

func decodeOneJSONValue(reader io.Reader) (any, error) {
	decoder := json.NewDecoder(reader)
	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errors.New("trailing JSON value")
	}
	return payload, nil
}

func validatePostdeployEvidence(payload any, additionalRequired []string) string {
	object, ok := payload.(map[string]any)
	if !ok {
		return "InvalidPayload"
	}
	if event, ok := object["event"].(string); !ok || event != localSmokeEvent {
		return "InvalidEvent"
	}
	if schemaVersion, present := object["schemaVersion"]; present {
		version, ok := schemaVersion.(float64)
		if !ok || version != 1 {
			return "UnsupportedSchemaVersion"
		}
	}
	if status, ok := object["status"].(string); !ok || status != "ok" {
		return "UnhealthyStatus"
	}
	rawChecks, ok := object["checks"].([]any)
	if !ok {
		return "InvalidChecks"
	}
	checks := make(map[string]struct{}, len(rawChecks))
	for _, rawCheck := range rawChecks {
		check, ok := rawCheck.(string)
		if !ok || !checkNamePattern.MatchString(check) {
			return "InvalidChecks"
		}
		if _, duplicate := checks[check]; duplicate {
			return "DuplicateChecks"
		}
		checks[check] = struct{}{}
	}
	for _, required := range append(corePostdeployChecks, additionalRequired...) {
		if _, present := checks[required]; !present {
			return "MissingRequiredChecks"
		}
	}
	return ""
}

func writeEvidenceFailure(stderr io.Writer, errorKind string) {
	writeEvidenceValidationResult(stderr, evidenceValidationResult{
		Event: postdeployEvidenceValidationEvent, Status: "failed", ErrorKind: errorKind,
	})
}

func writeEvidenceValidationResult(destination io.Writer, result evidenceValidationResult) {
	encoder := json.NewEncoder(destination)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(result)
}
