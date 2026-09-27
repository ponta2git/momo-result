package main

import (
	"bufio"
	"encoding/json"
	"io"
	"regexp"
	"sort"
)

const logSummaryEvent = "runtime_log_summary"

var safeLogValuePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,80}$`)

type logSummaryKey struct {
	App       string
	Component string
	Level     string
	Event     string
}

type logSummaryRecord struct {
	App       string `json:"app"`
	Component string `json:"component"`
	Level     string `json:"level"`
	Event     string `json:"event"`
	Count     int    `json:"count"`
}

type logSummary struct {
	SchemaVersion         int                `json:"schemaVersion"`
	Records               []logSummaryRecord `json:"records"`
	ExceptionClasses      map[string]int     `json:"exceptionClasses"`
	UnstructuredLineCount int                `json:"unstructuredLineCount"`
}

func runSummarizeLogs(stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	summary, err := summarizeLogs(stdin)
	if err != nil {
		writeResult(stderr, failureResult(logSummaryEvent, "InputReadError"))
		return 1
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(summary); err != nil {
		writeResult(stderr, failureResult(logSummaryEvent, "OutputWriteError"))
		return 1
	}
	return 0
}

func summarizeLogs(reader io.Reader) (logSummary, error) {
	counts := make(map[logSummaryKey]int)
	exceptions := make(map[string]int)
	unstructured := 0
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var value any
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			unstructured++
			continue
		}
		object, ok := value.(map[string]any)
		if !ok {
			unstructured++
			continue
		}
		key := logSummaryKey{
			App:       safeLogValue(object["app"], "unknown"),
			Component: safeLogValue(object["component"], "unknown"),
			Level:     safeLogValue(object["level"], "unknown"),
			Event:     safeLogValue(object["event"], "none"),
		}
		counts[key]++
		if rawClasses, ok := object["exception_classes"].([]any); ok {
			for _, rawClass := range rawClasses {
				exceptions[safeLogValue(rawClass, "UnknownError")]++
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return logSummary{}, err
	}
	keys := make([]logSummaryKey, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left, right int) bool {
		a, b := keys[left], keys[right]
		if a.App != b.App {
			return a.App < b.App
		}
		if a.Component != b.Component {
			return a.Component < b.Component
		}
		if a.Level != b.Level {
			return a.Level < b.Level
		}
		return a.Event < b.Event
	})
	records := make([]logSummaryRecord, 0, len(keys))
	for _, key := range keys {
		records = append(records, logSummaryRecord{
			App: key.App, Component: key.Component, Level: key.Level, Event: key.Event,
			Count: counts[key],
		})
	}
	return logSummary{
		SchemaVersion: 1, Records: records, ExceptionClasses: exceptions,
		UnstructuredLineCount: unstructured,
	}, nil
}

func safeLogValue(value any, fallback string) string {
	text, ok := value.(string)
	if !ok || !safeLogValuePattern.MatchString(text) {
		return fallback
	}
	return text
}
