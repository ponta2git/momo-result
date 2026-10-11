package cireport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
)

type maintenanceReport struct {
	SchemaVersion  int      `json:"schemaVersion"`
	Kind           string   `json:"kind"`
	Status         string   `json:"status"`
	Action         string   `json:"action"`
	Reason         string   `json:"reason"`
	PlanDigest     string   `json:"planDigest"`
	TargetCount    *big.Int `json:"targetCount"`
	CompletedCount *big.Int `json:"completedCount"`
	FailedCount    *big.Int `json:"failedCount"`
}

var planDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

func allowed(value any, values ...string) (string, bool) {
	s, ok := value.(string)
	if !ok {
		return "", false
	}
	for _, candidate := range values {
		if s == candidate {
			return s, true
		}
	}
	return "", false
}

func maintenance(value any) (maintenanceReport, error) {
	r := maintenanceReport{SchemaVersion: 1, Kind: "maintenance"}
	v, ok := value.(map[string]any)
	if !ok {
		return r, invalidInput
	}
	version, ok := count(v["schemaVersion"])
	if !ok || version.Cmp(big.NewInt(1)) != 0 {
		return r, invalidInput
	}
	r.Status, ok = allowed(v["status"], "planned", "running", "complete", "not_needed", "attention_required")
	if !ok {
		return r, invalidInput
	}
	r.Action, ok = allowed(v["action"], "none", "resume", "algorithm_update", "artifact_schema_update", "validation_contract_update", "initial_backfill")
	if !ok {
		return r, invalidInput
	}
	r.Reason, ok = allowed(v["reason"], "already_current", "existing_operation", "release_integrity_audit_failed", "applied_operation_has_a_different_current_release", "promote_before_backfill", "previous_generation_requires_explicit_recovery", "release_update_required", "reader_or_worker_incompatible", "plan_changed_run_check_again", "operation_accepted", "current_generation_operations")
	if !ok {
		return r, invalidInput
	}
	r.PlanDigest, ok = v["planDigest"].(string)
	if !ok || (r.PlanDigest != "" && !planDigest.MatchString(r.PlanDigest)) {
		return r, invalidInput
	}
	r.TargetCount, ok = count(v["targetCount"])
	if !ok {
		return r, invalidInput
	}
	r.CompletedCount, ok = count(v["completedCount"])
	if !ok {
		return r, invalidInput
	}
	r.FailedCount, ok = count(v["failedCount"])
	if !ok {
		return r, invalidInput
	}
	return r, nil
}

// A stream contains zero or more diagnostics and exactly one candidate object.
// Selection uses the same two keys as the producer-facing shell caller; a
// malformed candidate is not silently discarded in favor of a later valid one.
func maintenanceFromLog(in io.Reader) (any, error) {
	d := json.NewDecoder(in)
	d.UseNumber()
	var selected any
	candidates := 0
	for {
		var value any
		err := d.Decode(&value)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, invalidInput
		}
		if object, ok := value.(map[string]any); ok {
			_, hasVersion := object["schemaVersion"]
			_, hasDigest := object["planDigest"]
			if hasVersion && hasDigest {
				selected = value
				candidates++
			}
		}
	}
	if candidates != 1 {
		return nil, invalidInput
	}
	return selected, nil
}

func analysisReport(args []string, errOut io.Writer) int {
	fromLog := false
	var paths []string
	for _, arg := range args {
		if arg == "--from-log" {
			if fromLog {
				return usage("analysis-report", errOut)
			}
			fromLog = true
		} else {
			paths = append(paths, arg)
		}
	}
	if len(paths) != 2 || paths[0] == "" || paths[1] == "" {
		return usage("analysis-report", errOut)
	}
	input, output := paths[0], paths[1]
	inputAbs, inputErr := filepath.Abs(input)
	outputAbs, outputErr := filepath.Abs(output)
	if inputErr != nil || outputErr != nil || inputAbs == outputAbs {
		return failure(errOut, "Analysis report paths must be distinct.")
	}
	// Remove previous publishable evidence before attempting another extraction.
	// Never follow output symlinks or overwrite the input through a hard link.
	if outputInfo, err := os.Lstat(output); err == nil {
		if !outputInfo.Mode().IsRegular() {
			return failure(errOut, "Analysis report output is unavailable.")
		}
		if inputInfo, err := os.Stat(input); err == nil && os.SameFile(inputInfo, outputInfo) {
			return failure(errOut, "Analysis report paths must be distinct.")
		}
		if err := os.Remove(output); err != nil {
			return failure(errOut, "Analysis report output is unavailable.")
		}
	} else if !os.IsNotExist(err) {
		return failure(errOut, "Analysis report output is unavailable.")
	}
	f, err := regularInput(input)
	if err != nil {
		return failure(errOut, "Analysis report input must be a regular file.")
	}
	defer f.Close()
	var value any
	if fromLog {
		value, err = maintenanceFromLog(f)
	} else {
		value, err = singleJSON(f)
	}
	if err != nil {
		return failure(errOut, "Analysis report is invalid or not unique.")
	}
	r, err := maintenance(value)
	if err != nil {
		return failure(errOut, "Analysis report is invalid or not unique.")
	}
	var data bytes.Buffer
	if err := writeJSON(&data, r); err != nil {
		return failure(errOut, "Analysis report encoding failed.")
	}
	if err := writeFile(output, data.Bytes()); err != nil {
		return failure(errOut, "Analysis report output is unavailable.")
	}
	return 0
}

func analysisReportState(args []string, out, errOut io.Writer) int {
	if len(args) != 1 || args[0] == "" {
		return usage("analysis-report-state", errOut)
	}
	f, err := regularInput(args[0])
	if err != nil {
		return failure(errOut, "Analysis report input must be a regular file.")
	}
	defer f.Close()
	value, err := singleJSON(f)
	if err != nil {
		return failure(errOut, "Analysis report is invalid or not unique.")
	}
	r, err := maintenance(value)
	if err != nil {
		return failure(errOut, "Analysis report is invalid or not unique.")
	}
	// Planned work is actionable only with the exact inspected plan. The
	// report format permits empty digests for other states, but emitting a
	// planned state without one would let the caller apply without its guard.
	if r.Status == "planned" && r.PlanDigest == "" {
		return failure(errOut, "Planned analysis requires a valid plan digest.")
	}
	if _, err := fmt.Fprintf(out, "%s\t%s\n", r.Status, r.PlanDigest); err != nil {
		return failure(errOut, "Analysis report output is unavailable.")
	}
	return 0
}

const followup = `### Release follow-up required

The release has not been confirmed complete. Check the failed step and the analysis operation report, if present.

- ` + "`reader_or_worker_incompatible`" + `: finish the compatible deployment, then retry.
- ` + "`plan_changed_run_check_again`" + `: run ` + "`Analysis production operation`" + ` with ` + "`check`" + `, then ` + "`auto`" + `.
- ` + "`running`" + `: processing continues durably. Run ` + "`Analysis production operation`" + ` with ` + "`auto`" + ` to resume checking.
- ` + "`attention_required`" + ` with failed targets or an integrity error: investigate the report before retrying; do not create a fresh campaign to hide a failure.
- No report: complete or repair the failed deployment stage before analysis maintenance.

Use ` + "`pnpm analysis:maintain check`" + ` to inspect or ` + "`pnpm analysis:maintain`" + ` to reconcile. Both dispatch the protected workflow on master.
After manual recovery, rerun the original deploy run to verify the whole release and publish its release notes.
`

func analysisSummary(args []string, out, errOut io.Writer) int {
	if len(args) != 2 || args[0] == "" {
		return usage("analysis-summary", errOut)
	}
	result, ok := allowed(args[1], "success", "failure", "cancelled", "skipped")
	if !ok {
		return usage("analysis-summary", errOut)
	}
	var markdown bytes.Buffer
	status, reportInvalid := "", false
	if info, err := os.Lstat(args[0]); err == nil && info.Mode().IsRegular() {
		f, err := os.Open(args[0])
		var value any
		if err == nil {
			value, err = singleJSON(f)
			f.Close()
		}
		if err == nil {
			var r maintenanceReport
			r, err = maintenance(value)
			if err == nil {
				status = r.Status
				fmt.Fprintf(&markdown, "### Analysis maintenance\n\n| 状態 | 操作 | 対象 | 完了 | 失敗 |\n| --- | --- | ---: | ---: | ---: |\n| %s | %s | %s | %s | %s |\n\n判定理由: `%s`\n\n", r.Status, r.Action, r.TargetCount, r.CompletedCount, r.FailedCount, r.Reason)
			}
		}
		reportInvalid = err != nil
	} else if err != nil && !os.IsNotExist(err) {
		reportInvalid = true
	}
	if result == "success" {
		if status == "planned" || status == "running" {
			markdown.WriteString("確認のみで終了しました。適用・完了確認には `pnpm analysis:maintain` を実行します。\n")
		}
	} else {
		markdown.WriteString(followup)
	}
	if _, err := out.Write(markdown.Bytes()); err != nil {
		return failure(errOut, "Analysis summary output is unavailable.")
	}
	if result != "success" {
		fmt.Fprintln(errOut, "::error::Release follow-up is required. See the job summary and operation evidence.")
	}
	if reportInvalid {
		return failure(errOut, "Analysis summary report is invalid.")
	}
	return 0
}
