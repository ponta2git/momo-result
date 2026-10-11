package ciproducer

import (
	"encoding/json"
	"io"
	"strings"

	"github.com/ponta2git/momo-result/scripts/tools/internal/cievidence"
)

func deployment(args []string, out io.Writer, root string) error {
	v, err := options("create-runtime-deployment", args, "candidate", "run-attempt", "registry-ref", "source-artifact-id", "source-artifact-digest", "manifest", "manifest-artifact-id", "manifest-artifact-digest")
	if err != nil {
		return err
	}
	m, err := objectFile(v["candidate"])
	if err != nil {
		return err
	}
	if err = validateCandidate(m, patchFrom(m), root); err != nil {
		return err
	}
	sourceDigest, err := cievidence.NormalizeArtifactDigest(v["source-artifact-digest"])
	if err != nil {
		return err
	}
	manifestDigest, err := cievidence.NormalizeArtifactDigest(v["manifest-artifact-digest"])
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
	m["schemaVersion"], m["sourceRunAttempt"], m["runAttempt"] = 3, sourceAttempt, v["run-attempt"]
	m["registryRef"], m["registryDigest"] = v["registry-ref"], strings.SplitN(v["registry-ref"], "@", 2)[1]
	m["sourceArtifactName"] = "runtime-image-" + runID + "-" + sourceAttempt
	m["sourceArtifactId"], m["sourceArtifactDigest"] = v["source-artifact-id"], sourceDigest
	m["manifestArtifactName"] = "runtime-image-registry-manifest-" + runID + "-" + v["run-attempt"]
	m["manifestArtifactId"], m["manifestArtifactDigest"], m["manifestSha256"] = v["manifest-artifact-id"], manifestDigest, manifestSHA
	data, _ := json.Marshal(m)
	if err = cievidence.ValidateRuntimeDeployment(data, identity(m)); err != nil {
		return err
	}
	return encode(out, m)
}
