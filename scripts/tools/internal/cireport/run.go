// Package cireport parses CI reports without exposing input values in errors.
// See README.md for the command, output, and failure contracts.
package cireport

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"strings"
)

var invalidInput = errors.New("invalid input")

// Run executes a report command. Status 2 means invalid arguments; status 1
// means invalid/unavailable input or an I/O failure. Errors never quote input.
func Run(command string, args []string, in io.Reader, out, errOut io.Writer, repoRoot string) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		_, err := fmt.Fprintln(out, help(command))
		if err != nil {
			return 1
		}
		return 0
	}
	switch command {
	case "coverage":
		return coverage(args, out, errOut, repoRoot)
	case "runtime-logs":
		if len(args) != 0 {
			return usage(command, errOut)
		}
		if err := runtimeLogs(in, out); err != nil {
			return failure(errOut, "Runtime log summary failed.")
		}
		return 0
	case "analysis-report":
		return analysisReport(args, errOut)
	case "analysis-summary":
		return analysisSummary(args, out, errOut)
	case "analysis-report-state":
		return analysisReportState(args, out, errOut)
	default:
		return usage(command, errOut)
	}
}

func help(command string) string {
	switch command {
	case "coverage":
		return "coverage <web|api> [--root directory] --out directory [--allow-missing]\nWrites raw-summary.json and summary.md. Invalid reports fail and replace previous summaries; --allow-missing allows only absent reports."
	case "runtime-logs":
		return "runtime-logs\nReads JSON log lines on stdin; writes only allowlisted identifiers and counts. Malformed/non-object lines are counted without copying content."
	case "analysis-report":
		return "analysis-report [--from-log] <input-json> <output-json>\nPublishes only validated maintenance fields. Normally requires exactly one JSON document; --from-log accepts a JSON stream with exactly one object containing schemaVersion and planDigest. Invalid input clears prior output."
	case "analysis-summary":
		return "analysis-summary <report-json> <success|failure|cancelled|skipped>\nWrites Markdown from validated maintenance fields. Missing reports are allowed; unsuccessful operations print follow-up instructions and a fixed CI error annotation without changing the operation result."
	case "analysis-report-state":
		return "analysis-report-state <report-json>\nValidates one maintenance report and writes status, a tab, planDigest, and a newline. Planned work requires a nonempty digest. No other input fields are emitted."
	default:
		return "Commands: coverage, runtime-logs, analysis-report, analysis-report-state, analysis-summary"
	}
}

func usage(command string, out io.Writer) int   { fmt.Fprintln(out, help(command)); return 2 }
func failure(out io.Writer, message string) int { fmt.Fprintln(out, message); return 1 }

func singleJSON(in io.Reader) (any, error) {
	d := json.NewDecoder(in)
	d.UseNumber()
	var value, extra any
	if err := d.Decode(&value); err != nil {
		return nil, invalidInput
	}
	if err := d.Decode(&extra); err != io.EOF {
		return nil, invalidInput
	}
	return value, nil
}

// Counts remain exact even above the float64 integer range. Decimal/exponent
// spellings are accepted when their mathematical value is a nonnegative integer.
func count(value any) (*big.Int, bool) {
	n, ok := value.(json.Number)
	if !ok || !json.Valid([]byte(n)) {
		return nil, false
	}
	text := string(n)
	if !strings.ContainsAny(text, ".eE") {
		integer, ok := new(big.Int).SetString(text, 10)
		return integer, ok && integer.Sign() >= 0
	}
	mantissa, _, _ := strings.Cut(strings.ToLower(text), "e")
	if strings.Trim(mantissa, "-0.") == "" {
		return new(big.Int), true
	}
	// Avoid expanding tiny exponent-form inputs into enormous allocations.
	// Zero and literal integers do not need a rational representation.
	f, err := n.Float64()
	if err != nil || math.IsInf(f, 0) || f < 1 {
		return nil, false
	}
	r, ok := new(big.Rat).SetString(string(n))
	if !ok || r.Sign() < 0 || !r.IsInt() {
		return nil, false
	}
	return new(big.Int).Set(r.Num()), true
}

func finiteNumber(value any) (float64, bool) {
	n, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := n.Float64()
	return f, err == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
}

func writeJSON(out io.Writer, value any) error {
	e := json.NewEncoder(out)
	e.SetIndent("", "  ")
	return e.Encode(value)
}

func regularInput(path string) (*os.File, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, invalidInput
	}
	return os.Open(path)
}

func writeFile(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".ci-report-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
