// Package cievidence owns CI provenance, its production and validation, and
// allowlisted provider evidence. It never invokes external commands.
package cievidence

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
)

var usages = map[string]string{
	"runtime-candidate":          "<artifact-directory> <run-id> <run-attempt> <commit> <image-ref>",
	"analysis-candidate":         "<candidate.json> <run-id> <run-attempt> <commit> [--config file]",
	"runtime-deployment":         "<deployment.json> <run-id> <run-attempt> <commit> [--config file]",
	"runtime-release-selection":  "<run-id> <commit> <candidate-run-attempt> <artifact-name> <artifact-id> <artifact-digest> <image-ref>",
	"postdeploy-evidence":        "<evidence.json> [--require-check name]...",
	"worker-readiness":           "<provider-json-log> <machine-id> <analysis-worker-id> <ocr-worker-id>",
	"artifact-digest":            "<artifact-digest>",
	"analysis-archive":           "<artifact-directory> <expected-image-ref> <expected-tar-sha256>",
	"image-id-match":             "<expected-id> <actual-id>",
	"file-digest-match":          "<file> <bare-sha256>",
	"analysis-release-selection": "<run-id> <producer-attempt> <metadata-name> <metadata-id> <metadata-digest>",
	"create-http4s-patch":        "--repository URL --scala-version VERSION --source-sha SHA --version VERSION",
	"create-runtime-candidate":   "--artifact-dir DIR --run-id ID --run-attempt N --commit SHA --image-ref REF",
	"create-analysis-candidate":  "--artifact-dir DIR --run-id ID --run-attempt N --commit SHA --image-ref REF --artifact-id ID --artifact-digest DIGEST",
	"create-runtime-deployment":  "--candidate FILE --run-id ID --run-attempt N --registry-ref REF --source-artifact-id ID --source-artifact-digest DIGEST --manifest FILE --manifest-artifact-id ID --manifest-artifact-digest DIGEST",
	"resolve-pushed-image":       "IMAGE_TAG < docker-repo-digests.json",
	"resolve-deployment-run":     "REPOSITORY < github-run.json",
	"verify-manifest-artifact":   "DEPLOYMENT_JSON RUN_ID < github-artifact.json",
	"runtime-machine-evidence":   "IMAGE_REF < machines.json",
	"runtime-machine-id":         "IMAGE_REF < machines.json",
	"runtime-machine-start-id":   "IMAGE_REF < machines.json",
	"analysis-machine-start-id":  "IMAGE_REF RELEASE_SHA ANALYSIS_WORKER_ID OCR_WORKER_ID < machines.json",
	"analysis-reusable-release":  "IMAGE_REF < machines.json",
	"analysis-machine-identity":  "< machines.json",
	"analysis-machine-evidence":  "IMAGE_REF RELEASE_SHA ANALYSIS_WORKER_ID OCR_WORKER_ID < machines.json",
	"analysis-secrets":           "ready|unstaged < secrets.json",
	"canonical-json":             "< manifest.json",
	"public-edge-evidence":       "< edge-smoke.json",
}

var argumentCounts = map[string]int{
	"runtime-candidate": 5, "analysis-candidate": 4, "runtime-deployment": 4,
	"runtime-release-selection": 7, "worker-readiness": 4, "artifact-digest": 1,
	"analysis-archive": 3, "image-id-match": 2,
	"file-digest-match": 2, "analysis-release-selection": 5,
}

// Run preserves the validators' positional arguments and stdout contracts.
// repoRoot supplies checkout-owned configuration; input evidence stays explicit.
// No document contents or filesystem/provider errors are copied to stderr.
func Run(command string, args []string, in io.Reader, out, errOut io.Writer, repoRoot string) int {
	usage, known := usages[command]
	if !known {
		fmt.Fprintln(errOut, "Unknown evidence command.")
		return 2
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprintf(out, "Usage: ci-tool %s %s\n", command, usage)
		fmt.Fprintln(out, "Valid evidence exits 0; rejected evidence exits 1; invalid arguments exit 2.")
		fmt.Fprintln(out, "Rejected evidence emits no success output. Caller policy decides whether failure stops the workflow.")
		return 0
	}
	optionalConfig := (command == "analysis-candidate" || command == "runtime-deployment") && len(args) == 6 && args[4] == "--config" && args[5] != ""
	if count, fixed := argumentCounts[command]; fixed && len(args) != count && !optionalConfig {
		fmt.Fprintf(errOut, "Usage: ci-tool %s %s\n", command, usage)
		return 2
	}
	var result string
	var err error
	switch command {
	case "runtime-candidate":
		err = runtimeCandidate(args, repoRoot)
	case "analysis-candidate":
		result, err = analysisCandidate(args)
	case "runtime-deployment":
		result, err = runtimeDeployment(args)
	case "runtime-release-selection":
		result, err = runtimeReleaseSelection(args)
	case "analysis-release-selection":
		err = analysisReleaseSelection(args)
	case "postdeploy-evidence":
		result, err = postdeployEvidence(args)
	case "worker-readiness":
		result, err = workerReadiness(args)
	case "artifact-digest":
		result, err = normalizeArtifactDigest(args[0])
		if err == nil {
			result += "\n"
		}
	case "analysis-archive":
		result, err = analysisArchive(args)
	case "file-digest-match":
		err = fileDigestMatch(args[0], args[1])
	case "image-id-match":
		if !digestPattern.MatchString(args[0]) || !digestPattern.MatchString(args[1]) || args[0] != args[1] {
			err = errors.New("The loaded image ID does not match the verified candidate image ID.")
		}
	case "create-http4s-patch", "create-runtime-candidate", "create-analysis-candidate", "create-runtime-deployment":
		var output bytes.Buffer
		err = create(command, args, &output, repoRoot)
		result = output.String()
	default:
		var output bytes.Buffer
		err = provider(command, args, in, &output)
		result = output.String()
	}
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintf(errOut, "Usage: ci-tool %s %s\n", command, usage)
			return 2
		}
		var evidenceErr *postdeployError
		if errors.As(err, &evidenceErr) {
			fmt.Fprintf(errOut, "{\"event\":\"runtime_postdeploy_evidence_validation\",\"status\":\"failed\",\"errorKind\":%q}\n", evidenceErr.kind)
			return evidenceErr.code
		}
		fmt.Fprintln(errOut, err.Error())
		return 1
	}
	if _, err := io.WriteString(out, result); err != nil {
		fmt.Fprintln(errOut, "Evidence output could not be written.")
		return 1
	}
	return 0
}
