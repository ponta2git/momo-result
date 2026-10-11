package cievidence

import (
	"errors"
	"fmt"
	"strings"
)

const (
	runtimeRepository  = "registry.fly.io/momo-result"
	analysisRepository = "registry.fly.io/momo-result-analysis"
	http4sRepository   = "https://github.com/ponta2git/http4s.git"
	http4sScalaVersion = "3.3.6"
)

// Identity names the producing run, not the current workflow's retry attempt.
type Identity struct {
	RunID      string
	RunAttempt string
	Commit     string
}

func (i Identity) valid() bool {
	return positiveIDPattern.MatchString(i.RunID) && positiveIDPattern.MatchString(i.RunAttempt) && commitPattern.MatchString(i.Commit)
}

func (i Identity) imageRef(repository string) string {
	return repository + ":" + i.Commit + "-" + i.RunID + "-" + i.RunAttempt
}

func (i Identity) artifact(prefix string) string {
	return prefix + "-" + i.RunID + "-" + i.RunAttempt
}

// RuntimeCandidateInputs are measured archive/configuration values. Producers
// and consumers both validate metadata against these, not against itself.
type RuntimeCandidateInputs struct {
	Identity
	ImageID         string
	TarSHA256       string
	ConfigSHA256    string
	HTTP4SSourceSHA string
}

// NormalizeArtifactDigest accepts the upload action's bare digest and the API's
// prefixed digest. It never accepts other algorithms, uppercase, or whitespace.
func NormalizeArtifactDigest(value string) (string, error) {
	if shaPattern.MatchString(value) {
		return "sha256:" + value, nil
	}
	if digestPattern.MatchString(value) {
		return value, nil
	}
	return "", errors.New("Artifact digest must be a lowercase SHA-256 value.")
}

// ValidateHTTP4SPatch enforces the pinned source and the exact patch manifest.
func ValidateHTTP4SPatch(data []byte, expectedSourceSHA string) error {
	_, err := http4sPatch(data, expectedSourceSHA)
	return err
}

func http4sPatch(data []byte, expectedSourceSHA string) (object, error) {
	patch, err := decodeObject(data)
	if err != nil || !commitPattern.MatchString(expectedSourceSHA) ||
		!patch.keys("repository", "scalaVersion", "sourceSha", "version") ||
		!patch.equals("repository", http4sRepository) || !patch.equals("scalaVersion", http4sScalaVersion) ||
		!patch.equals("sourceSha", expectedSourceSHA) || !versionPattern.MatchString(patch.text("version")) {
		return nil, errors.New("HTTP4s patch metadata failed its pinned source contract.")
	}
	return patch, nil
}

// ValidateRuntimeCandidate checks the exact v2 candidate and associated patch.
func ValidateRuntimeCandidate(data, patchData []byte, expected RuntimeCandidateInputs) error {
	candidate, err := decodeObject(data)
	patch, patchErr := http4sPatch(patchData, expected.HTTP4SSourceSHA)
	if err != nil || patchErr != nil || !expected.Identity.valid() ||
		!digestPattern.MatchString(expected.ImageID) || !shaPattern.MatchString(expected.TarSHA256) ||
		!shaPattern.MatchString(expected.ConfigSHA256) ||
		!candidate.keys("commit", "configSha256", "http4sPatchRepository", "http4sPatchScalaVersion", "http4sPatchSourceSha", "http4sPatchVersion", "imageId", "imageRef", "runAttempt", "runId", "schemaVersion", "tarSha256") ||
		!candidate.numberEquals("schemaVersion", 2) ||
		!candidate.equals("commit", expected.Commit) || !candidate.equals("runId", expected.RunID) ||
		!candidate.equals("runAttempt", expected.RunAttempt) || !candidate.equals("imageRef", expected.imageRef(runtimeRepository)) ||
		!candidate.equals("imageId", expected.ImageID) || !candidate.equals("tarSha256", expected.TarSHA256) ||
		!candidate.equals("configSha256", expected.ConfigSHA256) ||
		!candidate.equals("http4sPatchRepository", patch.text("repository")) ||
		!candidate.equals("http4sPatchScalaVersion", patch.text("scalaVersion")) ||
		!candidate.equals("http4sPatchSourceSha", patch.text("sourceSha")) ||
		!candidate.equals("http4sPatchVersion", patch.text("version")) {
		return errors.New("Runtime candidate failed its immutable provenance contract.")
	}
	return nil
}

// ValidateAnalysisCandidate is also used by the metadata producer.
func ValidateAnalysisCandidate(data []byte, expected Identity) error {
	_, err := validatedAnalysisCandidate(data, expected)
	return err
}

func validatedAnalysisCandidate(data []byte, expected Identity) (object, error) {
	candidate, err := decodeObject(data)
	if err != nil || !expected.valid() ||
		!candidate.keys("commit", "configSha256", "imageArtifactDigest", "imageArtifactId", "imageArtifactName", "imageRef", "runAttempt", "runId", "schemaVersion", "tarSha256") ||
		!candidate.numberEquals("schemaVersion", 1) ||
		!candidate.equals("commit", expected.Commit) || !candidate.equals("runId", expected.RunID) ||
		!candidate.equals("runAttempt", expected.RunAttempt) || !candidate.equals("imageRef", expected.imageRef(analysisRepository)) ||
		!candidate.equals("imageArtifactName", expected.artifact("analysis-worker-image")) ||
		!positiveIDPattern.MatchString(candidate.text("imageArtifactId")) ||
		!digestPattern.MatchString(candidate.text("imageArtifactDigest")) ||
		!shaPattern.MatchString(candidate.text("tarSha256")) || !shaPattern.MatchString(candidate.text("configSha256")) {
		return nil, errors.New("Candidate metadata failed its immutable provenance contract.")
	}
	return candidate, nil
}

func analysisCandidate(args []string) (string, error) {
	data, err := readRegular(args[0])
	if err != nil {
		return "", err
	}
	candidate, err := validatedAnalysisCandidate(data, Identity{args[1], args[2], args[3]})
	if err != nil {
		return "", err
	}
	if len(args) == 6 {
		if err := fileDigestMatch(args[5], candidate.text("configSha256")); err != nil {
			return "", err
		}
	}
	return outputFields(candidate,
		"candidate_sha", "commit", "candidate_run_attempt", "runAttempt", "config_sha256", "configSha256",
		"image_artifact_digest", "imageArtifactDigest", "image_artifact_id", "imageArtifactId",
		"image_artifact_name", "imageArtifactName", "image_ref", "imageRef", "tar_sha256", "tarSha256"), nil
}

// ValidateRuntimeDeployment preserves v1/v2/v3 release records, including a
// producer attempt different from the deployment attempt and historical pins.
func ValidateRuntimeDeployment(data []byte, expected Identity) error {
	_, _, err := validatedRuntimeDeployment(data, expected)
	return err
}

func validatedRuntimeDeployment(data []byte, expected Identity) (object, string, error) {
	fail := errors.New("Runtime deployment metadata failed its immutable provenance contract.")
	deployment, err := decodeObject(data)
	if err != nil || !expected.valid() {
		return nil, "", fail
	}
	keys := []string{"commit", "configSha256", "imageId", "imageRef", "manifestArtifactDigest", "manifestArtifactId", "manifestArtifactName", "manifestSha256", "registryDigest", "registryRef", "runAttempt", "runId", "schemaVersion", "sourceArtifactDigest", "sourceArtifactId", "sourceArtifactName"}
	sourceAttempt := expected.RunAttempt
	switch {
	case deployment.numberEquals("schemaVersion", 1):
	case deployment.numberEquals("schemaVersion", 2), deployment.numberEquals("schemaVersion", 3):
		keys = append(keys, "sourceRunAttempt")
		sourceAttempt = deployment.text("sourceRunAttempt")
		if deployment.numberEquals("schemaVersion", 3) {
			keys = append(keys, "http4sPatchRepository", "http4sPatchScalaVersion", "http4sPatchSourceSha", "http4sPatchVersion")
			if !deployment.equals("http4sPatchRepository", http4sRepository) ||
				!deployment.equals("http4sPatchScalaVersion", http4sScalaVersion) ||
				!commitPattern.MatchString(deployment.text("http4sPatchSourceSha")) ||
				!versionPattern.MatchString(deployment.text("http4sPatchVersion")) {
				return nil, "", fail
			}
		}
	default:
		return nil, "", fail
	}
	source := Identity{expected.RunID, sourceAttempt, expected.Commit}
	if !source.valid() || !deployment.keys(keys...) ||
		!deployment.equals("commit", expected.Commit) || !deployment.equals("runId", expected.RunID) ||
		!deployment.equals("runAttempt", expected.RunAttempt) || !deployment.equals("imageRef", source.imageRef(runtimeRepository)) ||
		!deployment.equals("sourceArtifactName", source.artifact("runtime-image")) ||
		!deployment.equals("manifestArtifactName", expected.artifact("runtime-image-registry-manifest")) ||
		!deployment.equals("registryRef", runtimeRepository+"@"+deployment.text("registryDigest")) {
		return nil, "", fail
	}
	for _, field := range []string{"imageId", "registryDigest", "sourceArtifactDigest", "manifestArtifactDigest"} {
		if !digestPattern.MatchString(deployment.text(field)) {
			return nil, "", fail
		}
	}
	for _, field := range []string{"configSha256", "manifestSha256"} {
		if !shaPattern.MatchString(deployment.text(field)) {
			return nil, "", fail
		}
	}
	for _, field := range []string{"sourceArtifactId", "manifestArtifactId"} {
		if !positiveIDPattern.MatchString(deployment.text(field)) {
			return nil, "", fail
		}
	}
	return deployment, sourceAttempt, nil
}

func runtimeDeployment(args []string) (string, error) {
	data, err := readRegular(args[0])
	if err != nil {
		return "", err
	}
	deployment, sourceAttempt, err := validatedRuntimeDeployment(data, Identity{args[1], args[2], args[3]})
	if err != nil {
		return "", err
	}
	if len(args) == 6 {
		if err := fileDigestMatch(args[5], deployment.text("configSha256")); err != nil {
			return "", err
		}
	}
	deployment["sourceRunAttempt"] = sourceAttempt
	return outputFields(deployment,
		"candidate_sha", "commit", "source_run_attempt", "sourceRunAttempt", "config_sha256", "configSha256",
		"image_ref", "imageRef", "manifest_artifact_digest", "manifestArtifactDigest",
		"manifest_artifact_id", "manifestArtifactId", "manifest_artifact_name", "manifestArtifactName",
		"manifest_sha256", "manifestSha256", "registry_digest", "registryDigest", "registry_ref", "registryRef"), nil
}

func outputFields(value object, pairs ...string) string {
	var result strings.Builder
	for index := 0; index < len(pairs); index += 2 {
		fmt.Fprintf(&result, "%s=%s\n", pairs[index], value.text(pairs[index+1]))
	}
	return result.String()
}

func runtimeReleaseSelection(args []string) (string, error) {
	source := Identity{args[0], args[2], args[1]}
	if !source.valid() || !positiveIDPattern.MatchString(args[4]) {
		return "", errors.New("Invalid runtime release candidate identity.")
	}
	if args[3] != source.artifact("runtime-image") {
		return "", errors.New("Runtime artifact name does not match the producer candidate identity.")
	}
	if args[6] != source.imageRef(runtimeRepository) {
		return "", errors.New("Runtime image reference does not match the producer candidate identity.")
	}
	if _, err := NormalizeArtifactDigest(args[5]); err != nil {
		return "", err
	}
	return fmt.Sprintf("artifact_id=%s\nartifact_name=%s\ncandidate_run_attempt=%s\nimage_ref=%s\n", args[4], args[3], args[2], args[6]), nil
}

func analysisReleaseSelection(args []string) error {
	if !positiveIDPattern.MatchString(args[0]) || !positiveIDPattern.MatchString(args[1]) || !positiveIDPattern.MatchString(args[3]) ||
		args[2] != "analysis-candidate-metadata-"+args[0]+"-"+args[1] {
		return errors.New("Worker metadata does not match the selected producer identity.")
	}
	_, err := NormalizeArtifactDigest(args[4])
	return err
}
