package cievidence

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFrozenMachineSelectionUsesPersistentModeAndExactImage(t *testing.T) {
	for _, role := range []string{"runtime", "analysis"} {
		ref := runtimeRef
		if role == "analysis" {
			ref = workerRef
		}
		for _, tc := range []struct {
			name, state, mode, image, command, output string
			count                                     int
			valid                                     bool
		}{
			{"ready", "started", "frozen", ref, "frozen-machine-id", "a123\n", 1, true},
			{"stopped is not readiness", "stopped", "frozen", ref, "frozen-machine-id", "", 1, false},
			{"start exact stopped target", "stopped", "frozen", ref, "frozen-machine-start-id", "a123\n", 1, true},
			{"already started", "started", "frozen", ref, "frozen-machine-start-id", "", 1, true},
			{"normal mode", "started", "normal", ref, "frozen-machine-id", "", 1, false},
			{"missing persistent mode", "started", "", ref, "frozen-machine-id", "", 1, false},
			{"wrong image", "started", "frozen", ref + "x", "frozen-machine-id", "", 1, false},
			{"ambiguous target", "started", "frozen", ref, "frozen-machine-id", "", 2, false},
			{"transitional target", "starting", "frozen", ref, "frozen-machine-start-id", "", 1, false},
		} {
			t.Run(role+"/"+tc.name, func(t *testing.T) {
				m := machineFixture()
				m["state"] = tc.state
				objectMap(field(m, "config"))["image"] = tc.image
				objectMap(field(m, "config", "env"))["MOMO_MAINTENANCE_MODE"] = tc.mode
				list := []any{m}
				if tc.count == 2 {
					list = append(list, m)
				}
				input, _ := json.Marshal(list)
				code, out, diagnostics := call(t, tc.command, []string{role, ref}, string(input), "")
				if (code == 0) != tc.valid || out != tc.output || strings.Contains(out+diagnostics, "never-print") {
					t.Fatal(code, out, diagnostics)
				}
			})
		}
	}
}

func TestFrozenReadinessRequiresEveryDedicatedProbe(t *testing.T) {
	runtime := `{"event":"runtime_maintenance_readiness","schemaVersion":1,"status":"ok","checks":["frozen_readiness","normal_routes_closed","database_contract","runtime_processes"],"private":"never-print"}`
	worker := `{"event":"worker_maintenance_readiness","schemaVersion":1,"status":"ready","mode":"frozen","private":"never-print"}`
	for _, tc := range []struct {
		role, input string
		valid       bool
	}{
		{"runtime", runtime, true}, {"analysis", worker, true},
		{"runtime", strings.Replace(runtime, "database_contract", "frozen_readiness", 1), false},
		{"runtime", strings.Replace(runtime, "\"ok\"", "\"failed\"", 1), false},
		{"analysis", strings.Replace(worker, "frozen", "normal", 1), false},
		{"runtime", worker, false}, {"analysis", runtime, false},
	} {
		code, out, diagnostics := call(t, "frozen-readiness-evidence", []string{tc.role}, tc.input, "")
		if (code == 0) != tc.valid || strings.Contains(out+diagnostics, "never-print") || (!tc.valid && out != "") {
			t.Fatal(code, out, diagnostics)
		}
		if tc.valid {
			var evidence map[string]any
			if json.Unmarshal([]byte(out), &evidence) != nil || len(evidence) != 4 || evidence["consumer"] != tc.role || evidence["status"] != "ready" || evidence["mode"] != "frozen" || evidence["schemaVersion"] != float64(1) {
				t.Fatal(out)
			}
		}
	}
}
