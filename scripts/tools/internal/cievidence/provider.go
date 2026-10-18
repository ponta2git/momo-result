package cievidence

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"regexp"
	"strings"
)

var invalid = errors.New("CI provenance input failed its contract.")
var candidateTag = regexp.MustCompile(`^registry\.fly\.io/momo-result(-analysis)?:[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$`)

func provider(command string, args []string, in io.Reader, out io.Writer) error {
	counts := map[string]int{"resolve-pushed-image": 1, "resolve-deployment-run": 1, "verify-manifest-artifact": 2,
		"runtime-machine-evidence": 1, "runtime-machine-id": 1, "analysis-reusable-release": 1,
		"runtime-machine-start-id": 1, "analysis-machine-start-id": 4,
		"frozen-machine-id": 2, "frozen-machine-start-id": 2, "frozen-readiness-evidence": 1,
		"maintenance-analysis-evidence": 2, "maintenance-publish-evidence": 2,
		"analysis-machine-identity": 0, "analysis-machine-evidence": 4, "analysis-secrets": 1,
		"canonical-json": 0, "public-edge-evidence": 0, "normal-deployment-completion": 3}
	n, ok := counts[command]
	if !ok || len(args) != n {
		return flag.ErrHelp
	}
	value, err := readJSON(in)
	if err != nil {
		return err
	}
	switch command {
	case "maintenance-analysis-evidence":
		return maintenanceAnalysisEvidence(value, args[0], args[1], out)
	case "maintenance-publish-evidence":
		return maintenancePublishEvidence(value, args[0], args[1])
	case "frozen-machine-id", "frozen-machine-start-id":
		return frozenMachine(command, value, args, out)
	case "frozen-readiness-evidence":
		return frozenReadiness(value, args[0], out)
	case "resolve-pushed-image":
		return pushedImage(value, args[0], out)
	case "resolve-deployment-run":
		return deploymentRun(value, args[0], out)
	case "verify-manifest-artifact":
		return manifestArtifact(value, args[0], args[1])
	case "normal-deployment-completion":
		m := objectMap(value)
		expected := runIdentity{args[0], args[1], args[2]}
		if !expected.valid() || !m.keys("schemaVersion", "status", "mode", "runId", "runAttempt", "commit") ||
			!m.numberEquals("schemaVersion", 1) || !m.equals("status", "complete") || !m.equals("mode", "normal") ||
			!m.equals("runId", expected.RunID) || !m.equals("runAttempt", expected.RunAttempt) || !m.equals("commit", expected.Commit) {
			return invalid
		}
		return nil
	case "analysis-secrets":
		return secrets(value, args[0])
	case "canonical-json":
		encoder := json.NewEncoder(out)
		encoder.SetEscapeHTML(false)
		return encoder.Encode(value)
	case "public-edge-evidence":
		if field(value, "event") != "runtime_public_edge_smoke" || number(field(value, "schemaVersion")) != "1" || field(value, "status") != "ok" {
			return invalid
		}
		return encode(out, map[string]any{"schemaVersion": 1, "status": "ok"})
	default:
		return machines(command, value, args, out)
	}
}

func pushedImage(value any, tag string, out io.Writer) error {
	if !candidateTag.MatchString(tag) {
		return invalid
	}
	repository := strings.SplitN(tag, ":", 2)[0]
	values, ok := value.([]any)
	if !ok {
		return invalid
	}
	selected := map[string]bool{}
	for _, value := range values {
		s, ok := value.(string)
		if !ok {
			return invalid
		}
		if strings.HasPrefix(s, repository+"@sha256:") {
			selected[s] = true
		}
	}
	if len(selected) != 1 {
		return invalid
	}
	for ref := range selected {
		if !digestPattern.MatchString(strings.TrimPrefix(ref, repository+"@")) {
			return invalid
		}
		_, err := fmt.Fprintln(out, ref)
		return err
	}
	return invalid
}

func deploymentRun(v any, repository string, out io.Writer) error {
	attempt, commit := number(field(v, "run_attempt")), str(field(v, "head_sha"))
	event := str(field(v, "event"))
	if repository == "" || field(v, "name") != "deploy" || field(v, "path") != ".github/workflows/deploy.yml" ||
		(event != "push" && event != "workflow_dispatch") || field(v, "head_branch") != "master" ||
		field(v, "head_repository", "full_name") != repository || field(v, "conclusion") != "success" ||
		!positiveIDPattern.MatchString(attempt) || !commitPattern.MatchString(commit) {
		return invalid
	}
	_, err := fmt.Fprintf(out, "candidate_sha=%s\nrun_attempt=%s\n", commit, attempt)
	return err
}

func manifestArtifact(v any, path, runID string) error {
	m, err := readObjectFile(path)
	if err != nil {
		return err
	}
	if _, _, err = validateRuntimeDeployment(m, runIdentity{RunID: runID, RunAttempt: m.text("runAttempt"), Commit: m.text("commit")}); err != nil {
		return err
	}
	id, name, expectedDigest := str(field(m, "manifestArtifactId")), str(field(m, "manifestArtifactName")), str(field(m, "manifestArtifactDigest"))
	if !positiveIDPattern.MatchString(runID) || !positiveIDPattern.MatchString(id) || !digestPattern.MatchString(expectedDigest) ||
		name == "" || number(field(v, "id")) != id || field(v, "name") != name || field(v, "digest") != expectedDigest ||
		field(v, "expired") != false || number(field(v, "workflow_run", "id")) != runID {
		return invalid
	}
	return nil
}

func secrets(v any, mode string) error {
	if mode != "ready" && mode != "unstaged" {
		return flag.ErrHelp
	}
	list, ok := v.([]any)
	if !ok {
		return invalid
	}
	ready, staged := false, false
	for _, entry := range list {
		name, status := str(field(entry, "name")), str(field(entry, "status"))
		if name == "" || status == "" {
			return invalid
		}
		staged = staged || status == "Staged"
		ready = ready || name == "MOMO_PROCESSING_LISTENER_DATABASE_URL" && (status == "Deployed" || status == "Staged")
	}
	if (mode == "ready" && !ready) || (mode == "unstaged" && staged) {
		return invalid
	}
	return nil
}
