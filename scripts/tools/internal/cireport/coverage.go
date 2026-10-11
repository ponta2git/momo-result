package cireport

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type coverageMetric struct {
	Pct     *float64 `json:"pct"`
	Covered *big.Int `json:"covered"`
	Total   *big.Int `json:"total"`
}

type coverageReport struct {
	GeneratedAt   string                    `json:"generatedAt"`
	Subsystem     string                    `json:"subsystem"`
	Status        string                    `json:"status"`
	Message       *string                   `json:"message"`
	Limitations   []string                  `json:"limitations"`
	SourceReports []string                  `json:"sourceReports"`
	Metrics       map[string]coverageMetric `json:"metrics"`
}

var metricOrder = []string{"statements", "branches", "functions", "lines"}

const coverageLimitation = "API coverage is diagnostic. Scala may omit oversized endpoint/schema initializers; compiler diagnostics identify each initializer omitted from the measured totals."

func coverage(args []string, _ io.Writer, errOut io.Writer, repoRoot string) int {
	if len(args) == 0 || (args[0] != "web" && args[0] != "api") {
		return usage("coverage", errOut)
	}
	subsystem := args[0]
	root, output, allowMissing := repoRoot, "", false
	if root == "" {
		root = "."
	}
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "--root", "--out":
			if i+1 == len(args) || args[i+1] == "" {
				return usage("coverage", errOut)
			}
			if args[i] == "--root" {
				root = args[i+1]
			} else {
				output = args[i+1]
			}
			i++
		case "--allow-missing":
			allowMissing = true
		default:
			return usage("coverage", errOut)
		}
	}
	if output == "" {
		return usage("coverage", errOut)
	}
	if err := os.MkdirAll(output, 0o755); err != nil {
		return failure(errOut, "Coverage summary output is unavailable.")
	}
	r := coverageReport{GeneratedAt: time.Now().UTC().Format(time.RFC3339), Subsystem: subsystem, Status: "ok", Limitations: []string{}, SourceReports: []string{}, Metrics: map[string]coverageMetric{}}
	setStatus := func(status, message string) { r.Status = status; r.Message = &message }
	path := "apps/web/coverage/coverage-summary.json"
	if subsystem == "api" {
		matches, err := filepath.Glob(filepath.Join(root, "apps/api/target/out/jvm/scala-*/momo-result-api/scoverage-report/scoverage.xml"))
		if err != nil {
			return failure(errOut, "Coverage report lookup failed.")
		}
		switch len(matches) {
		case 0:
			setStatus("missing", "Coverage report not found under apps/api/target.")
		case 1:
			path, err = filepath.Rel(root, matches[0])
			if err != nil {
				return failure(errOut, "Coverage report lookup failed.")
			}
		default:
			setStatus("invalid", "Ambiguous Scala coverage reports.")
		}
	}
	if r.Status == "ok" {
		fullPath := filepath.Join(root, path)
		info, err := os.Stat(fullPath)
		if os.IsNotExist(err) || (err == nil && !info.Mode().IsRegular()) {
			setStatus("missing", "Coverage report not found: "+filepath.ToSlash(path))
		} else if err != nil {
			setStatus("invalid", "Invalid coverage report.")
		} else {
			f, err := os.Open(fullPath)
			if err == nil {
				if subsystem == "web" {
					r.Metrics, err = webCoverage(f)
				} else {
					r.Metrics, err = apiCoverage(f)
				}
				f.Close()
			}
			if err != nil {
				setStatus("invalid", "Invalid coverage report.")
				r.Metrics = map[string]coverageMetric{}
			}
		}
	}
	if r.Status == "ok" {
		r.SourceReports = []string{filepath.ToSlash(path)}
		if subsystem == "api" {
			r.Limitations = []string{coverageLimitation}
		}
	}
	var raw, markdown bytes.Buffer
	if err := writeJSON(&raw, r); err != nil {
		return failure(errOut, "Coverage summary encoding failed.")
	}
	fmt.Fprintf(&markdown, "## Coverage Summary: %s\n\n", subsystem)
	if r.Status != "ok" {
		fmt.Fprintf(&markdown, "Coverage report is unavailable: %s\n", *r.Message)
	} else {
		markdown.WriteString("| Metric | Coverage | Covered / Total |\n|---|---:|---:|\n")
		for _, name := range metricOrder {
			m, ok := r.Metrics[name]
			if !ok {
				continue
			}
			pct, counts := "-", "-"
			if m.Pct != nil {
				pct = fmt.Sprintf("%.1f%%", *m.Pct)
			}
			if m.Covered != nil {
				counts = m.Covered.String() + " / " + m.Total.String()
			}
			fmt.Fprintf(&markdown, "| %s | %s | %s |\n", name, pct, counts)
		}
		markdown.WriteString("\n")
		for _, limitation := range r.Limitations {
			fmt.Fprintf(&markdown, "%s\n\n", limitation)
		}
	}
	// Both files are replaced even when the report is missing/invalid, so a
	// prior successful invocation cannot be mistaken for current evidence.
	if err := writeFile(filepath.Join(output, "raw-summary.json"), raw.Bytes()); err != nil {
		return failure(errOut, "Coverage summary output is unavailable.")
	}
	if err := writeFile(filepath.Join(output, "summary.md"), markdown.Bytes()); err != nil {
		return failure(errOut, "Coverage summary output is unavailable.")
	}
	if r.Status == "invalid" || (r.Status == "missing" && !allowMissing) {
		return failure(errOut, "Coverage report is unavailable or invalid.")
	}
	return 0
}

func webCoverage(in io.Reader) (map[string]coverageMetric, error) {
	value, err := singleJSON(in)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, invalidInput
	}
	total, ok := object["total"].(map[string]any)
	if !ok {
		return nil, invalidInput
	}
	metrics := make(map[string]coverageMetric, 4)
	for _, name := range metricOrder {
		fields, ok := total[name].(map[string]any)
		if !ok {
			return nil, invalidInput
		}
		for _, key := range []string{"pct", "covered", "total"} {
			if _, ok := fields[key]; !ok {
				return nil, invalidInput
			}
		}
		metric, err := validateMetric(fields["pct"], fields["covered"], fields["total"])
		if err != nil {
			return nil, err
		}
		metrics[name] = metric
	}
	return metrics, nil
}

func validateMetric(pctValue, coveredValue, totalValue any) (coverageMetric, error) {
	m := coverageMetric{}
	if pctValue == "Unknown" {
		covered, cOK := count(coveredValue)
		total, tOK := count(totalValue)
		if !cOK || !tOK || covered.Sign() != 0 || total.Sign() != 0 {
			return m, invalidInput
		}
		m.Covered, m.Total = covered, total
		return m, nil
	}
	pct, ok := finiteNumber(pctValue)
	if !ok || pct < 0 || pct > 100 {
		return m, invalidInput
	}
	if coveredValue == nil && totalValue == nil {
		rounded := math.Round(pct*10) / 10
		m.Pct = &rounded
		return m, nil
	}
	covered, cOK := count(coveredValue)
	total, tOK := count(totalValue)
	if !cOK || !tOK || covered.Cmp(total) > 0 {
		return m, invalidInput
	}
	m.Covered, m.Total = covered, total
	if total.Sign() == 0 {
		if pct != 0 && pct != 100 {
			return m, invalidInput
		}
	} else {
		actual, _ := new(big.Rat).Mul(new(big.Rat).SetFrac(covered, total), big.NewRat(100, 1)).Float64()
		if math.Abs(pct-actual) > 0.010000001 {
			return m, invalidInput
		}
		pct = actual
	}
	rounded := math.Round(pct*10) / 10
	m.Pct = &rounded
	return m, nil
}

func apiCoverage(in io.Reader) (map[string]coverageMetric, error) {
	d := xml.NewDecoder(in)
	depth, roots := 0, 0
	var fields map[string]any
	for {
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, invalidInput
		}
		switch t := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots != 1 || t.Name.Local != "scoverage" || t.Name.Space != "" {
					return nil, invalidInput
				}
				fields = map[string]any{}
				for _, a := range t.Attr {
					if a.Name.Space == "" {
						if _, duplicate := fields[a.Name.Local]; duplicate {
							return nil, invalidInput
						}
						fields[a.Name.Local] = json.Number(a.Value)
					}
				}
			}
			depth++
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(t)) != "" {
				return nil, invalidInput
			}
		}
	}
	if roots != 1 || depth != 0 {
		return nil, invalidInput
	}
	statements, err := validateMetric(fields["statement-rate"], fields["statements-invoked"], fields["statement-count"])
	if err != nil || statements.Covered == nil {
		return nil, invalidInput
	}
	branches, err := validateMetric(fields["branch-rate"], nil, nil)
	if err != nil {
		return nil, invalidInput
	}
	return map[string]coverageMetric{"statements": statements, "branches": branches}, nil
}
