package cievidence

import (
	"fmt"
	"io"
	"regexp"
	"strings"
)

var machineID = regexp.MustCompile(`^[a-z0-9]+$`)

func immutableImage(ref, repository string) bool {
	prefix := "registry.fly.io/" + repository + "@"
	return strings.HasPrefix(ref, prefix) && digestPattern.MatchString(strings.TrimPrefix(ref, prefix))
}
func enabled(m any) bool {
	return field(m, "state") == "started" && field(m, "config", "env", "MOMO_ANALYSIS_PUBLICATION_MODE") == "enabled" &&
		field(m, "config", "env", "MOMO_OCR_V2_CONSUMER_MODE") == "enabled"
}
func guest(m any) bool {
	return field(m, "config", "guest", "cpu_kind") == "shared" && number(field(m, "config", "guest", "cpus")) == "1" &&
		number(field(m, "config", "guest", "memory_mb")) == "256"
}
func release(m any) string {
	v := str(field(m, "config", "env", "MOMO_ANALYSIS_CONFIG_VERSION"))
	if !strings.HasPrefix(v, "series-analysis-v1-") {
		return ""
	}
	v = strings.TrimPrefix(v, "series-analysis-v1-")
	if !commitPattern.MatchString(v) {
		return ""
	}
	return v
}
func machines(command string, value any, args []string, out io.Writer) error {
	list, ok := value.([]any)
	if !ok {
		return invalid
	}
	if command == "analysis-reusable-release" {
		if !immutableImage(args[0], "momo-result-analysis") {
			return invalid
		}
		previous := ""
		mode := any(nil)
		if len(list) == 1 {
			mode = field(list[0], "config", "env", "MOMO_MAINTENANCE_MODE")
		}
		if len(list) == 1 && (mode == nil || mode == "normal") && enabled(list[0]) && guest(list[0]) && field(list[0], "config", "image") == args[0] {
			previous = release(list[0])
		}
		_, err := fmt.Fprintln(out, previous)
		return err
	}
	if len(list) != 1 {
		return invalid
	}
	m := list[0]
	id, image := str(field(m, "id")), str(field(m, "config", "image"))
	if command == "runtime-machine-start-id" || command == "analysis-machine-start-id" {
		state := field(m, "state")
		if (state != "stopped" && state != "started") || !machineID.MatchString(id) {
			return invalid
		}
		// Apply the same image/configuration contract before starting a stopped
		// deployment. This is a start target, never evidence of a running machine.
		objectMap(m)["state"] = "started"
		validator := "runtime-machine-id"
		if command == "analysis-machine-start-id" {
			validator = "analysis-machine-evidence"
		}
		if err := machines(validator, list, args, io.Discard); err != nil {
			return err
		}
		if state == "stopped" {
			_, err := fmt.Fprintln(out, id)
			return err
		}
		return nil
	}
	switch command {
	case "runtime-machine-evidence", "runtime-machine-id":
		if !immutableImage(args[0], "momo-result") || field(m, "state") != "started" || image != args[0] {
			return invalid
		}
		if command == "runtime-machine-id" {
			if !machineID.MatchString(id) {
				return invalid
			}
			_, err := fmt.Fprintln(out, id)
			return err
		}
		return encode(out, map[string]any{"schemaVersion": 1, "singleStartedExactImage": true})
	case "analysis-machine-identity":
		if !enabled(m) || !machineID.MatchString(id) || !immutableImage(image, "momo-result-analysis") || release(m) == "" {
			return invalid
		}
		_, err := fmt.Fprintf(out, "%s\t%s\tseries-analysis-v1-%s\n", id, image, release(m))
		return err
	case "analysis-machine-evidence":
		if !immutableImage(args[0], "momo-result-analysis") || !commitPattern.MatchString(args[1]) ||
			!regexp.MustCompile(`^worker-[1-9][0-9]*-[1-9][0-9]*$`).MatchString(args[2]) ||
			!regexp.MustCompile(`^ocr-[1-9][0-9]*-[1-9][0-9]*$`).MatchString(args[3]) ||
			!enabled(m) || !guest(m) || !machineID.MatchString(id) || image != args[0] || release(m) != args[1] ||
			field(m, "config", "env", "MOMO_ANALYSIS_WORKER_ID") != args[2] || field(m, "config", "env", "MOMO_OCR_V2_WORKER_ID") != args[3] {
			return invalid
		}
		return encode(out, map[string]any{"schemaVersion": 1, "machineId": id, "state": "started", "image": image, "analysisWorkerId": args[2], "ocrWorkerId": args[3]})
	}
	return invalid
}
