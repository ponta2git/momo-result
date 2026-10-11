package ciproducer

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/ponta2git/momo-result/scripts/tools/internal/cievidence"
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
		patch := map[string]any{"repository": v["repository"], "scalaVersion": v["scala-version"], "sourceSha": v["source-sha"], "version": v["version"]}
		pin, err := textFile(filepath.Join(root, ".http4s-ref"))
		if err != nil {
			return err
		}
		data, _ := json.Marshal(patch)
		if err = cievidence.ValidateHTTP4SPatch(data, pin); err != nil {
			return err
		}
		return encode(out, patch)
	case "create-runtime-candidate", "create-analysis-candidate":
		return candidate(command, args, out, root)
	case "create-runtime-deployment":
		return deployment(args, out, root)
	default:
		return flag.ErrHelp
	}
}
func textFile(path string) (string, error) {
	data, err := regular(path)
	return strings.TrimRight(string(data), "\n"), err
}
func hashFile(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", invalid
	}
	f, err := os.Open(path)
	if err != nil {
		return "", invalid
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", invalid
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func objectFile(path string) (map[string]any, error) {
	data, err := regular(path)
	if err != nil {
		return nil, err
	}
	value, err := readJSON(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	m := object(value)
	if m == nil {
		return nil, invalid
	}
	return m, nil
}
func identity(m map[string]any) cievidence.Identity {
	return cievidence.Identity{RunID: str(m["runId"]), RunAttempt: str(m["runAttempt"]), Commit: str(m["commit"])}
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
	dir, archive, config := v["artifact-dir"], "momo-result-image.tar.gz", "fly.toml"
	if worker {
		archive, config = "analysis-worker-image.tar.gz", "fly.analysis.toml"
	}
	tar, err := hashFile(filepath.Join(dir, archive))
	if err != nil {
		return err
	}
	recorded, err := textFile(filepath.Join(dir, "image-tar.sha256"))
	if err != nil {
		return err
	}
	fields := strings.Fields(recorded)
	if len(fields) != 2 || fields[0] != tar {
		return invalid
	}
	ref, err := textFile(filepath.Join(dir, "image-ref.txt"))
	if err != nil || ref != v["image-ref"] {
		return invalid
	}
	id, err := textFile(filepath.Join(dir, "image-id.txt"))
	if err != nil || !digest.MatchString(id) {
		return invalid
	}
	configSHA, err := hashFile(filepath.Join(root, config))
	if err != nil {
		return err
	}
	m := map[string]any{"schemaVersion": 1, "commit": v["commit"], "runId": v["run-id"], "runAttempt": v["run-attempt"], "imageRef": ref, "tarSha256": tar, "configSha256": configSHA}
	if worker {
		d, err := cievidence.NormalizeArtifactDigest(v["artifact-digest"])
		if err != nil {
			return err
		}
		m["imageArtifactId"], m["imageArtifactDigest"] = v["artifact-id"], d
		m["imageArtifactName"] = "analysis-worker-image-" + v["run-id"] + "-" + v["run-attempt"]
		data, _ := json.Marshal(m)
		if err = cievidence.ValidateAnalysisCandidate(data, identity(m)); err != nil {
			return err
		}
	} else {
		patch, err := objectFile(filepath.Join(dir, "http4s-patch.json"))
		if err != nil {
			return err
		}
		m["schemaVersion"], m["imageId"] = 2, id
		copyPatch(m, patch)
		if err = validateCandidate(m, patch, root); err != nil {
			return err
		}
	}
	return encode(out, m)
}
func copyPatch(m, patch map[string]any) {
	m["http4sPatchRepository"], m["http4sPatchScalaVersion"] = patch["repository"], patch["scalaVersion"]
	m["http4sPatchSourceSha"], m["http4sPatchVersion"] = patch["sourceSha"], patch["version"]
}
func patchFrom(m map[string]any) map[string]any {
	return map[string]any{"repository": m["http4sPatchRepository"], "scalaVersion": m["http4sPatchScalaVersion"], "sourceSha": m["http4sPatchSourceSha"], "version": m["http4sPatchVersion"]}
}
func validateCandidate(m, patch map[string]any, root string) error {
	pin, err := textFile(filepath.Join(root, ".http4s-ref"))
	if err != nil {
		return err
	}
	config, err := hashFile(filepath.Join(root, "fly.toml"))
	if err != nil {
		return err
	}
	data, _ := json.Marshal(m)
	patchData, _ := json.Marshal(patch)
	return cievidence.ValidateRuntimeCandidate(data, patchData, cievidence.RuntimeCandidateInputs{Identity: identity(m), ImageID: str(m["imageId"]), TarSHA256: str(m["tarSha256"]), ConfigSHA256: config, HTTP4SSourceSHA: pin})
}
