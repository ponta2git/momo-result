// Package ciproducer creates CI provenance and projects provider replies into
// bounded evidence. It performs no provider calls or deployment operations.
package ciproducer

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"regexp"
)

var invalid = errors.New("invalid provenance input")
var sha = regexp.MustCompile(`^[0-9a-f]{40}$`)
var digest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var positive = regexp.MustCompile(`^[1-9][0-9]*$`)
var candidateTag = regexp.MustCompile(`^registry\.fly\.io/momo-result(-analysis)?:[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$`)

// Run writes output only after all input is validated. Status 2 denotes CLI
// misuse; status 1 denotes unavailable/invalid evidence or an output failure.
// Diagnostics deliberately never reproduce provider replies or argument values.
func Run(command string, args []string, in io.Reader, out, errOut io.Writer, repoRoot string) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		_, err := fmt.Fprintln(out, help(command))
		if err != nil {
			return 1
		}
		return 0
	}
	var result bytes.Buffer
	var err error
	if len(command) >= 7 && command[:7] == "create-" {
		err = create(command, args, &result, repoRoot)
	} else {
		err = provider(command, args, in, &result)
	}
	if errors.Is(err, flag.ErrHelp) {
		fmt.Fprintln(errOut, help(command))
		return 2
	}
	if err == nil {
		_, err = io.Copy(out, &result)
	}
	if err != nil {
		fmt.Fprintln(errOut, "CI provenance input failed its contract.")
		return 1
	}
	return 0
}

func help(command string) string {
	switch command {
	case "create-http4s-patch":
		return command + " --repository URL --scala-version VERSION --source-sha SHA --version VERSION"
	case "create-runtime-candidate":
		return command + " --artifact-dir DIR --run-id ID --run-attempt N --commit SHA --image-ref REF"
	case "create-analysis-candidate":
		return command + " --artifact-dir DIR --run-id ID --run-attempt N --commit SHA --image-ref REF --artifact-id ID --artifact-digest DIGEST"
	case "create-runtime-deployment":
		return command + " --candidate FILE --run-attempt N --registry-ref REF --source-artifact-id ID --source-artifact-digest DIGEST --manifest FILE --manifest-artifact-id ID --manifest-artifact-digest DIGEST"
	case "resolve-pushed-image":
		return command + " IMAGE_TAG < docker-repo-digests.json"
	case "resolve-deployment-run":
		return command + " REPOSITORY < github-run.json"
	case "verify-manifest-artifact":
		return command + " DEPLOYMENT_JSON RUN_ID < github-artifact.json"
	case "runtime-machine-evidence", "runtime-machine-id", "analysis-reusable-release":
		return command + " IMAGE_REF < machines.json"
	case "analysis-machine-identity":
		return command + " < machines.json"
	case "analysis-machine-evidence":
		return command + " IMAGE_REF RELEASE_SHA ANALYSIS_WORKER_ID OCR_WORKER_ID < machines.json"
	case "analysis-secrets":
		return command + " ready|unstaged < secrets.json"
	case "canonical-json":
		return command + " < manifest.json"
	case "public-edge-evidence":
		return command + " < edge-smoke.json"
	default:
		return "Unknown CI producer command."
	}
}

func readJSON(in io.Reader) (any, error) {
	d := json.NewDecoder(in)
	d.UseNumber()
	var value, extra any
	if d.Decode(&value) != nil {
		return nil, invalid
	}
	if d.Decode(&extra) != io.EOF {
		return nil, invalid
	}
	return value, nil
}
func object(value any) map[string]any { m, _ := value.(map[string]any); return m }
func field(value any, keys ...string) any {
	for _, key := range keys {
		value = object(value)[key]
	}
	return value
}
func str(value any) string { s, _ := value.(string); return s }
func number(value any) string {
	n, ok := value.(json.Number)
	if !ok {
		return ""
	}
	r, ok := new(big.Rat).SetString(string(n))
	if !ok || !r.IsInt() {
		return ""
	}
	return r.Num().String()
}
func encode(out io.Writer, value any) error {
	e := json.NewEncoder(out)
	e.SetIndent("", "  ")
	return e.Encode(value)
}
func regular(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, invalid
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, invalid
	}
	return data, nil
}
