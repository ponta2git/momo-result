package main

import (
	"encoding/json"
	"io"
)

const resultSchemaVersion = 1

type commandResult struct {
	Event            string         `json:"event"`
	SchemaVersion    int            `json:"schemaVersion,omitempty"`
	Status           string         `json:"status"`
	ErrorClass       string         `json:"errorClass,omitempty"`
	Checks           []string       `json:"checks,omitempty"`
	ContractChecks   int            `json:"contractChecks,omitempty"`
	MissingCounts    map[string]int `json:"missingCounts,omitempty"`
	MissingProcesses []string       `json:"missingProcesses,omitempty"`
}

func writeResult(destination io.Writer, result commandResult) {
	encoder := json.NewEncoder(destination)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(result)
}

func successResult(event string) commandResult {
	return commandResult{
		Event:         event,
		SchemaVersion: resultSchemaVersion,
		Status:        "ok",
	}
}

func failureResult(event string, errorClass string) commandResult {
	return commandResult{
		Event:      event,
		Status:     "failed",
		ErrorClass: errorClass,
	}
}
