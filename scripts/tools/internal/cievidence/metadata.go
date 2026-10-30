package cievidence

import (
	"encoding/json"
	"flag"
	"io"
	"path/filepath"
)

func options(command string, args []string, names ...string) (map[string]string, error) {
	f := flag.NewFlagSet(command, flag.ContinueOnError)
	f.SetOutput(io.Discard)
	pointers := map[string]*string{}
	for _, name := range names {
		pointers[name] = f.String(name, "", "")
	}
	if f.Parse(args) != nil || f.NArg() != 0 {
		return nil, flag.ErrHelp
	}
	values := map[string]string{}
	for name, p := range pointers {
		if *p == "" {
			return nil, flag.ErrHelp
		}
		values[name] = *p
	}
	return values, nil
}

func create(command string, args []string, out io.Writer, root string) error {
	switch command {
	case "create-http4s-patch":
		v, err := options(command, args, "repository", "scala-version", "source-sha", "version")
		if err != nil {
			return err
		}
		patch := object{"repository": v["repository"], "scalaVersion": v["scala-version"], "sourceSha": v["source-sha"], "version": v["version"]}
		pin, err := http4sPin(root)
		if err != nil {
			return err
		}
		if err = validateHTTP4SPatch(patch, pin); err != nil {
			return err
		}
		return encode(out, patch)
	case "create-runtime-candidate", "create-analysis-candidate":
		return candidate(command, args, out, root)
	case "create-runtime-deployment":
		return deployment(args, out, root)
	case "create-e2e-candidate":
		return createE2ECandidate(args, out)
	default:
		return flag.ErrHelp
	}
}

func identity(m object) runIdentity {
	return runIdentity{RunID: m.text("runId"), RunAttempt: m.text("runAttempt"), Commit: m.text("commit")}
}

func candidate(command string, args []string, out io.Writer, root string) error {
	names := []string{"artifact-dir", "run-id", "run-attempt", "commit", "image-ref"}
	worker := command == "create-analysis-candidate"
	if worker {
		names = append(names, "artifact-id", "artifact-digest")
	}
	v, err := options(command, args, names...)
	if err != nil {
		return err
	}
	source := runIdentity{RunID: v["run-id"], RunAttempt: v["run-attempt"], Commit: v["commit"]}
	dir, archive, config, repository := v["artifact-dir"], "momo-result-image.tar.gz", "fly.toml", runtimeRepository
	if worker {
		archive, config, repository = "analysis-worker-image.tar.gz", "fly.analysis.toml", analysisRepository
	}
	if !source.valid() || v["image-ref"] != source.imageRef(repository) {
		return invalid
	}
	artifactDigest := ""
	if worker {
		if !positiveIDPattern.MatchString(v["artifact-id"]) {
			return invalid
		}
		artifactDigest, err = normalizeArtifactDigest(v["artifact-digest"])
		if err != nil {
			return err
		}
	}
	// runIdentity and sidecars are checked before reading the potentially large
	// archive. Producers and consumers use the same filesystem contract.
	id, tar, err := verifiedArchive(dir, archive, v["image-ref"], "")
	if err != nil {
		return err
	}
	configSHA, err := hashFile(filepath.Join(root, config))
	if err != nil {
		return err
	}
	m := object{"schemaVersion": json.Number("1"), "commit": source.Commit, "runId": source.RunID, "runAttempt": source.RunAttempt, "imageRef": v["image-ref"], "tarSha256": tar, "configSha256": configSHA}
	if worker {
		m["imageArtifactId"], m["imageArtifactDigest"] = v["artifact-id"], artifactDigest
		m["imageArtifactName"] = source.artifact("analysis-worker-image")
		if _, err = validateAnalysisCandidate(m, source); err != nil {
			return err
		}
	} else {
		patch, err := readObjectFile(filepath.Join(dir, "http4s-patch.json"))
		if err != nil {
			return err
		}
		pin, err := http4sPin(root)
		if err != nil {
			return err
		}
		m["schemaVersion"], m["imageId"] = json.Number("2"), id
		copyPatch(m, patch)
		expected := runtimeCandidateInputs{runIdentity: source, ImageID: id, TarSHA256: tar, ConfigSHA256: configSHA, HTTP4SSourceSHA: pin}
		if err = validateRuntimeCandidate(m, patch, expected); err != nil {
			return err
		}
	}
	return encode(out, m)
}

func copyPatch(m, patch object) {
	m["http4sPatchRepository"], m["http4sPatchScalaVersion"] = patch["repository"], patch["scalaVersion"]
	m["http4sPatchSourceSha"], m["http4sPatchVersion"] = patch["sourceSha"], patch["version"]
}

// The archive is validated before loading. Deployment metadata creation checks
// its source document and checkout contracts without reading the archive again.
func validateDeploymentSource(m object, root string) error {
	pin, err := http4sPin(root)
	if err != nil {
		return err
	}
	config, err := hashFile(filepath.Join(root, "fly.toml"))
	if err != nil {
		return err
	}
	patch := object{"repository": m["http4sPatchRepository"], "scalaVersion": m["http4sPatchScalaVersion"], "sourceSha": m["http4sPatchSourceSha"], "version": m["http4sPatchVersion"]}
	return validateRuntimeCandidate(m, patch, runtimeCandidateInputs{runIdentity: identity(m), ImageID: m.text("imageId"), TarSHA256: m.text("tarSha256"), ConfigSHA256: config, HTTP4SSourceSHA: pin})
}
