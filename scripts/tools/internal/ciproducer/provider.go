package ciproducer

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"strings"

	"github.com/ponta2git/momo-result/scripts/tools/internal/cievidence"
)

func provider(command string, args []string, in io.Reader, out io.Writer) error {
	counts := map[string]int{"resolve-pushed-image": 1, "resolve-deployment-run": 1, "verify-manifest-artifact": 2,
		"runtime-machine-evidence": 1, "runtime-machine-id": 1, "analysis-reusable-release": 1,
		"analysis-machine-identity": 0, "analysis-machine-evidence": 4, "analysis-secrets": 1,
		"canonical-json": 0, "public-edge-evidence": 0}
	n, ok := counts[command]
	if !ok || len(args) != n {
		return flag.ErrHelp
	}
	value, err := readJSON(in)
	if err != nil {
		return err
	}
	switch command {
	case "resolve-pushed-image":
		return pushedImage(value, args[0], out)
	case "resolve-deployment-run":
		return deploymentRun(value, args[0], out)
	case "verify-manifest-artifact":
		return manifestArtifact(value, args[0], args[1])
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
		if !digest.MatchString(strings.TrimPrefix(ref, repository+"@")) {
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
		!positive.MatchString(attempt) || !sha.MatchString(commit) {
		return invalid
	}
	_, err := fmt.Fprintf(out, "candidate_sha=%s\nrun_attempt=%s\n", commit, attempt)
	return err
}

func manifestArtifact(v any, path, runID string) error {
	data, err := regular(path)
	if err != nil {
		return err
	}
	m, err := readJSON(bytes.NewReader(data))
	if err != nil {
		return err
	}
	if err = cievidence.ValidateRuntimeDeployment(data, cievidence.Identity{RunID: runID, RunAttempt: str(field(m, "runAttempt")), Commit: str(field(m, "commit"))}); err != nil {
		return err
	}
	id, name, expectedDigest := str(field(m, "manifestArtifactId")), str(field(m, "manifestArtifactName")), str(field(m, "manifestArtifactDigest"))
	if !positive.MatchString(runID) || !positive.MatchString(id) || !digest.MatchString(expectedDigest) ||
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
		ready = ready || name == "MOMO_ANALYSIS_OUTBOX_LISTENER_DATABASE_URL" && (status == "Deployed" || status == "Staged")
	}
	if (mode == "ready" && !ready) || (mode == "unstaged" && staged) {
		return invalid
	}
	return nil
}
