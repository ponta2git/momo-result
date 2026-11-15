package cievidence

import (
	"encoding/json"
	"io"
	"path/filepath"
	"strings"
)

func deployment(args []string, out io.Writer, root string) error {
	v, err := options("create-runtime-deployment", args, "candidate", "run-attempt", "registry-ref", "source-artifact-id", "source-artifact-digest", "manifest", "manifest-artifact-id", "manifest-artifact-digest", "edge-candidate", "edge-artifact-id", "edge-artifact-digest", "edge-deployment")
	if err != nil {
		return err
	}
	m, err := readObjectFile(v["candidate"])
	if err != nil {
		return err
	}
	if err = validateDeploymentSource(m, root); err != nil {
		return err
	}
	edge, err := readObjectFile(v["edge-candidate"])
	if err != nil {
		return err
	}
	// Read the already built tree again at deployment: no source rebuild can
	// silently replace the payload exercised by system E2E.
	treeDigest, err := edgeTreeDigest(filepath.Join(filepath.Dir(v["edge-candidate"]), "edge"))
	if err != nil {
		return err
	}
	if err = validateEdgeCandidate(edge, runIdentity{m.text("runId"), edge.text("runAttempt"), m.text("commit")}, treeDigest); err != nil {
		return err
	}
	edgeResult, err := readObjectFile(v["edge-deployment"])
	if err != nil || !edgeResult.keys("schemaVersion", "workerName", "versionId") ||
		!edgeResult.numberEquals("schemaVersion", 1) || !edgeNamePattern.MatchString(edgeResult.text("workerName")) ||
		!edgeVersionPattern.MatchString(edgeResult.text("versionId")) {
		return edgeInvalid
	}
	edgeDigest, err := normalizeArtifactDigest(v["edge-artifact-digest"])
	if err != nil {
		return err
	}
	sourceDigest, err := normalizeArtifactDigest(v["source-artifact-digest"])
	if err != nil {
		return err
	}
	manifestDigest, err := normalizeArtifactDigest(v["manifest-artifact-digest"])
	if err != nil {
		return err
	}
	manifestSHA, err := hashFile(v["manifest"])
	if err != nil {
		return err
	}
	if !immutableImage(v["registry-ref"], "momo-result") {
		return invalid
	}
	runID, sourceAttempt := str(m["runId"]), str(m["runAttempt"])
	delete(m, "tarSha256")
	m["schemaVersion"], m["sourceRunAttempt"], m["runAttempt"] = json.Number("4"), sourceAttempt, v["run-attempt"]
	m["registryRef"], m["registryDigest"] = v["registry-ref"], strings.SplitN(v["registry-ref"], "@", 2)[1]
	m["sourceArtifactName"] = "runtime-image-" + runID + "-" + sourceAttempt
	m["sourceArtifactId"], m["sourceArtifactDigest"] = v["source-artifact-id"], sourceDigest
	m["manifestArtifactName"] = "runtime-image-registry-manifest-" + runID + "-" + v["run-attempt"]
	m["manifestArtifactId"], m["manifestArtifactDigest"], m["manifestSha256"] = v["manifest-artifact-id"], manifestDigest, manifestSHA
	m["edgeRunAttempt"], m["edgeArtifactName"] = edge.text("runAttempt"), identity(edge).artifact("web-edge")
	m["edgeArtifactId"], m["edgeArtifactDigest"], m["edgeTreeSha256"] = v["edge-artifact-id"], edgeDigest, treeDigest
	m["edgeWorkerName"], m["edgeVersionId"] = edgeResult.text("workerName"), edgeResult.text("versionId")
	if _, _, err = validateRuntimeDeployment(m, identity(m)); err != nil {
		return err
	}
	return encode(out, m)
}
