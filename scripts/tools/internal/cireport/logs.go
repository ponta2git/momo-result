package cireport

import (
	"bufio"
	"io"
	"regexp"
	"sort"
	"strings"
)

type logKey struct{ App, Component, Level, Event string }
type logRecord struct {
	App       string `json:"app"`
	Component string `json:"component"`
	Level     string `json:"level"`
	Event     string `json:"event"`
	Count     uint64 `json:"count"`
}
type logSummary struct {
	Records               []logRecord       `json:"records"`
	ExceptionClasses      map[string]uint64 `json:"exceptionClasses"`
	UnstructuredLineCount uint64            `json:"unstructuredLineCount"`
	SchemaVersion         int               `json:"schemaVersion"`
}

var safeIdentifier = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,80}$`)

func identifier(value any, fallback string) string {
	valueString, ok := value.(string)
	if ok && safeIdentifier.MatchString(valueString) {
		return valueString
	}
	return fallback
}

func runtimeLogs(in io.Reader, out io.Writer) error {
	r := logSummary{Records: []logRecord{}, ExceptionClasses: map[string]uint64{}, SchemaVersion: 1}
	counts := map[logKey]uint64{}
	reader := bufio.NewReader(in)
	// ReadString avoids Scanner's default line limit. Memory follows one log
	// line plus distinct identifiers, rather than retaining the complete stream.
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil && readErr != io.EOF {
			return readErr
		}
		if len(line) != 0 {
			value, err := singleJSON(strings.NewReader(line))
			entry, object := value.(map[string]any)
			if err != nil || !object {
				r.UnstructuredLineCount++
			} else {
				key := logKey{identifier(entry["app"], "unknown"), identifier(entry["component"], "unknown"), identifier(entry["level"], "unknown"), identifier(entry["event"], "none")}
				counts[key]++
				if classes, ok := entry["exception_classes"].([]any); ok {
					for _, class := range classes {
						r.ExceptionClasses[identifier(class, "UnknownError")]++
					}
				}
			}
		}
		if readErr == io.EOF {
			break
		}
	}
	for key, count := range counts {
		r.Records = append(r.Records, logRecord{key.App, key.Component, key.Level, key.Event, count})
	}
	sort.Slice(r.Records, func(i, j int) bool {
		a, b := r.Records[i], r.Records[j]
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
	return writeJSON(out, r)
}
