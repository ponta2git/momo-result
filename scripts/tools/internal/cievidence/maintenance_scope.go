package cievidence

import (
	"fmt"
	"io"
	"regexp"
	"strconv"
)

var cutoverIdentity = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
var operationIdentity = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func safeInteger(value any, positive bool) (uint64, bool) {
	s := number(value)
	n, err := strconv.ParseUint(s, 10, 64)
	return n, err == nil && n <= 9007199254740991 && (!positive || n > 0)
}

// The shared controller authenticates the whole receipt and live permit. These
// selectors own only operation-specific arguments and their local evidence.
func maintenanceScope(path, operation string) (object, object, error) {
	r, err := readObjectFile(path)
	if err != nil {
		return nil, nil, err
	}
	s := objectMap(r["scope"])
	_, validEpoch := safeInteger(r["stopEpoch"], true)
	if !r.numberEquals("formatVersion", 1) || !r.equals("operation", operation) ||
		!cutoverIdentity.MatchString(r.text("cutoverId")) || !validEpoch || !commitPattern.MatchString(str(field(r, "candidates", "result"))) {
		return nil, nil, invalid
	}
	switch operation {
	case "analysis":
		if !s.keys("operationId", "campaignId", "planDigest") || !operationIdentity.MatchString(s.text("operationId")) ||
			!operationIdentity.MatchString(s.text("campaignId")) || !digestPattern.MatchString(s.text("planDigest")) ||
			!shaPattern.MatchString(str(field(r, "evidence", "previousStage"))) {
			return nil, nil, invalid
		}
	case "publish":
		_, validAttempt := safeInteger(s["deploymentRunAttempt"], true)
		if !s.keys("deploymentRunId", "deploymentRunAttempt", "provenanceArtifactId", "provenanceArtifactDigest") ||
			!positiveIDPattern.MatchString(s.text("deploymentRunId")) || !validAttempt ||
			!positiveIDPattern.MatchString(s.text("provenanceArtifactId")) || !shaPattern.MatchString(s.text("provenanceArtifactDigest")) ||
			!commitPattern.MatchString(str(field(r, "candidates", "result"))) {
			return nil, nil, invalid
		}
	default:
		return nil, nil, invalid
	}
	return r, s, nil
}

func maintenanceOperationScope(args []string) (string, error) {
	r, s, err := maintenanceScope(args[0], args[1])
	if err != nil {
		return "", err
	}
	result := fmt.Sprintf("cutover_id=%s\nstop_epoch=%s\nrelease_sha=%s\n", r.text("cutoverId"), number(r["stopEpoch"]), str(field(r, "candidates", "result")))
	if args[1] == "analysis" {
		return result + outputFields(s, "operation_id", "operationId", "campaign_id", "campaignId", "plan_digest", "planDigest") +
			fmt.Sprintf("readiness_digest=sha256:%s\n", str(field(r, "evidence", "previousStage"))), nil
	}
	result += fmt.Sprintf("deployment_run_id=%s\ndeployment_run_attempt=%s\nprovenance_artifact_id=%s\nprovenance_artifact_digest=sha256:%s\n",
		s.text("deploymentRunId"), number(s["deploymentRunAttempt"]), s.text("provenanceArtifactId"), s.text("provenanceArtifactDigest"))
	return result, nil
}

func maintenanceAnalysisEvidence(value any, path, kind, phase string, out io.Writer) error {
	r, s, err := maintenanceScope(path, "analysis")
	if err != nil {
		return err
	}
	v := objectMap(value)
	total, validTotal := safeInteger(v["targetCount"], false)
	completed, validCompleted := safeInteger(v["completedCount"], false)
	failed, validFailed := safeInteger(v["failedCount"], false)
	status := v.text("status")
	keys := []string{"schemaVersion", "kind", "cutoverId", "stopEpoch", "operationId", "campaignId", "planDigest", "status", "targetCount", "completedCount", "failedCount"}
	if kind == "initialize" {
		keys = append(keys, "candidateRelease", "readinessDigest")
		if status == "initialized" {
			keys = append(keys, "continuationPlanDigest")
			if !digestPattern.MatchString(v.text("continuationPlanDigest")) || v.text("continuationPlanDigest") == v.text("planDigest") {
				return invalid
			}
		}
		if (status != "planned" && status != "initialized") || (phase == "complete" && status != "initialized") ||
			!v.equals("candidateRelease", str(field(r, "candidates", "result"))) ||
			!v.equals("readinessDigest", "sha256:"+str(field(r, "evidence", "previousStage"))) || failed != 0 {
			return invalid
		}
	} else if kind != "continue" || (status != "planned" && status != "complete") || (phase == "complete" && status != "complete") {
		return invalid
	}
	if (phase != "plan" && phase != "complete") || !v.keys(keys...) ||
		!v.numberEquals("schemaVersion", 2) || !v.equals("kind", kind) ||
		!v.equals("cutoverId", r.text("cutoverId")) || number(v["stopEpoch"]) != number(r["stopEpoch"]) ||
		!v.equals("operationId", s.text("operationId")) || !v.equals("campaignId", s.text("campaignId")) || !v.equals("planDigest", s.text("planDigest")) ||
		!validTotal || !validCompleted || !validFailed || completed+failed > total ||
		(status == "complete" && (completed != total || failed != 0)) {
		return invalid
	}
	return encode(out, v)
}

// Match an immediately preceding read-only status with the guard's authenticated
// control head. This narrows initialization to consumersReady without extending
// the shared receipt scope or weakening the controller's live permit check.
func maintenanceInitializationGuard(value any, receiptPath, statusPath string) error {
	r, _, err := maintenanceScope(receiptPath, "analysis")
	if err != nil {
		return err
	}
	s, err := readObjectFile(statusPath)
	if err != nil {
		return err
	}
	g := objectMap(value)
	_, validVersion := safeInteger(s["stateVersion"], true)
	if !s.keys("head", "stateVersion", "cutoverId", "stopEpoch", "phase") ||
		!g.keys("controlHead", "cutoverId", "stopEpoch", "stateVersion", "receiptDigest") ||
		!s.equals("phase", "CONSUMERS_STAGED") || !commitPattern.MatchString(s.text("head")) ||
		!g.equals("controlHead", s.text("head")) || !validVersion || number(s["stateVersion"]) != number(g["stateVersion"]) ||
		!s.equals("cutoverId", r.text("cutoverId")) || !g.equals("cutoverId", r.text("cutoverId")) ||
		number(s["stopEpoch"]) != number(r["stopEpoch"]) || number(g["stopEpoch"]) != number(r["stopEpoch"]) ||
		!shaPattern.MatchString(g.text("receiptDigest")) {
		return invalid
	}
	return nil
}

func maintenancePublishEvidence(value any, path, kind string) error {
	r, s, err := maintenanceScope(path, "publish")
	if err != nil {
		return err
	}
	runID, attempt, commit := s.text("deploymentRunId"), number(s["deploymentRunAttempt"]), str(field(r, "candidates", "result"))
	v := objectMap(value)
	switch kind {
	case "run":
		if number(v["id"]) != runID || number(v["run_attempt"]) != attempt || !v.equals("head_sha", commit) ||
			!v.equals("head_branch", "cutover/"+r.text("cutoverId")) || !v.equals("event", "workflow_dispatch") ||
			!v.equals("path", ".github/workflows/deploy-maintenance.yml") || !v.equals("status", "completed") || !v.equals("conclusion", "success") ||
			field(v, "repository", "full_name") != "ponta2git/momo-result" {
			return invalid
		}
	case "artifact":
		if number(v["id"]) != s.text("provenanceArtifactId") || !v.equals("digest", "sha256:"+s.text("provenanceArtifactDigest")) ||
			!v.equals("name", "runtime-deployment-metadata-"+runID+"-"+attempt) || v["expired"] != false ||
			number(field(v, "workflow_run", "id")) != runID || field(v, "workflow_run", "head_sha") != commit {
			return invalid
		}
	case "completion":
		if !v.keys("schemaVersion", "status", "mode", "runId", "runAttempt", "commit", "cutoverId", "stopEpoch", "provenanceArtifactId", "provenanceArtifactDigest") ||
			!v.numberEquals("schemaVersion", 1) || !v.equals("status", "ready") || !v.equals("mode", "frozen") ||
			!v.equals("runId", runID) || !v.equals("runAttempt", attempt) || !v.equals("commit", commit) ||
			!v.equals("cutoverId", r.text("cutoverId")) || number(v["stopEpoch"]) != number(r["stopEpoch"]) ||
			!v.equals("provenanceArtifactId", s.text("provenanceArtifactId")) || !v.equals("provenanceArtifactDigest", "sha256:"+s.text("provenanceArtifactDigest")) {
			return invalid
		}
	case "provenance":
		if _, _, err := validateRuntimeDeployment(v, runIdentity{runID, attempt, commit}); err != nil {
			return err
		}
		if !v.numberEquals("schemaVersion", 4) || !v.equals("sourceRunId", str(field(r, "producer", "runId"))) ||
			!v.equals("sourceRunAttempt", number(field(r, "producer", "runAttempt"))) {
			return invalid
		}
		artifacts, ok := field(r, "producer", "artifacts").([]any)
		if !ok {
			return invalid
		}
		matched := false
		for _, artifact := range artifacts {
			matched = matched || (field(artifact, "id") == v.text("sourceArtifactId") &&
				"sha256:"+str(field(artifact, "digest")) == v.text("sourceArtifactDigest"))
		}
		if !matched {
			return invalid
		}
	default:
		return invalid
	}
	return nil
}
