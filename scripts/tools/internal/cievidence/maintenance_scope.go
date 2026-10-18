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
			!operationIdentity.MatchString(s.text("campaignId")) || !digestPattern.MatchString(s.text("planDigest")) {
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
		return result + outputFields(s, "operation_id", "operationId", "campaign_id", "campaignId", "plan_digest", "planDigest"), nil
	}
	result += fmt.Sprintf("deployment_run_id=%s\ndeployment_run_attempt=%s\nprovenance_artifact_id=%s\nprovenance_artifact_digest=sha256:%s\n",
		s.text("deploymentRunId"), number(s["deploymentRunAttempt"]), s.text("provenanceArtifactId"), s.text("provenanceArtifactDigest"))
	return result, nil
}

func maintenanceAnalysisEvidence(value any, path, phase string, out io.Writer) error {
	r, s, err := maintenanceScope(path, "analysis")
	if err != nil {
		return err
	}
	v := objectMap(value)
	total, validTotal := safeInteger(v["targetCount"], false)
	completed, validCompleted := safeInteger(v["completedCount"], false)
	failed, validFailed := safeInteger(v["failedCount"], false)
	status := v.text("status")
	if (phase != "plan" && phase != "complete") ||
		(status != "planned" && status != "complete") || (phase == "complete" && status != "complete") ||
		!v.keys("schemaVersion", "cutoverId", "stopEpoch", "operationId", "campaignId", "planDigest", "status", "targetCount", "completedCount", "failedCount") ||
		!v.numberEquals("schemaVersion", 1) ||
		!v.equals("cutoverId", r.text("cutoverId")) || number(v["stopEpoch"]) != number(r["stopEpoch"]) ||
		!v.equals("operationId", s.text("operationId")) || !v.equals("campaignId", s.text("campaignId")) || !v.equals("planDigest", s.text("planDigest")) ||
		!validTotal || !validCompleted || !validFailed || completed+failed > total ||
		(status == "complete" && (completed != total || failed != 0)) {
		return invalid
	}
	return encode(out, v)
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
