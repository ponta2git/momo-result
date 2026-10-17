package cievidence

import (
	"fmt"
	"io"
)

func frozenMachine(command string, value any, args []string, out io.Writer) error {
	repository := "momo-result"
	if args[0] == "analysis" {
		repository += "-analysis"
	} else if args[0] != "runtime" {
		return invalid
	}
	list, ok := value.([]any)
	if !ok || len(list) != 1 || !immutableImage(args[1], repository) {
		return invalid
	}
	m := list[0]
	id, state := str(field(m, "id")), field(m, "state")
	if !machineID.MatchString(id) || field(m, "config", "image") != args[1] ||
		field(m, "config", "env", "MOMO_MAINTENANCE_MODE") != "frozen" ||
		(args[0] == "analysis" && !guest(m)) {
		return invalid
	}
	if command == "frozen-machine-start-id" {
		if state == "started" {
			return nil
		}
		if state != "stopped" {
			return invalid
		}
	} else if state != "started" {
		return invalid
	}
	_, err := fmt.Fprintln(out, id)
	return err
}

func frozenReadiness(value any, role string, out io.Writer) error {
	if number(field(value, "schemaVersion")) != "1" {
		return invalid
	}
	switch role {
	case "runtime":
		if field(value, "event") != "runtime_maintenance_readiness" || field(value, "status") != "ok" {
			return invalid
		}
		checks, ok := field(value, "checks").([]any)
		if !ok || len(checks) != 4 {
			return invalid
		}
		expected := map[string]bool{"frozen_readiness": false, "normal_routes_closed": false, "database_contract": false, "runtime_processes": false}
		for _, check := range checks {
			name, ok := check.(string)
			seen, expectedCheck := expected[name]
			if !ok || !expectedCheck || seen {
				return invalid
			}
			expected[name] = true
		}
	case "analysis":
		if field(value, "event") != "worker_maintenance_readiness" || field(value, "status") != "ready" || field(value, "mode") != "frozen" {
			return invalid
		}
	default:
		return invalid
	}
	return encode(out, map[string]any{"schemaVersion": 1, "consumer": role, "mode": "frozen", "status": "ready"})
}
