package cievidence

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"path/filepath"
	"regexp"
	"unicode/utf8"
)

var (
	edgeVersionPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	edgeNamePattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	edgeInvalid        = errors.New("Edge candidate failed its immutable provenance contract.")
)

// The deployable tree contains the exact Worker bundle, configuration, and Web
// assets consumed by both the system runner and deployment. Metadata lives next
// to it, so hashing never excludes mutable files inside the deployment payload.
func edgeTreeDigest(directory string) (string, error) {
	for _, required := range []string{"wrangler.json", "worker/index.js", "assets/index.html"} {
		if !regularFile(filepath.Join(directory, required)) {
			return "", edgeInvalid
		}
	}
	type entry struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
	}
	entries := []entry{}
	err := filepath.WalkDir(directory, func(path string, info fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return edgeInvalid
		}
		if info.IsDir() {
			return nil
		}
		if !info.Type().IsRegular() {
			return edgeInvalid
		}
		relative, err := filepath.Rel(directory, path)
		if err != nil {
			return edgeInvalid
		}
		digest, err := hashFile(path)
		if err != nil {
			return edgeInvalid
		}
		entries = append(entries, entry{filepath.ToSlash(relative), digest})
		return nil
	})
	if err != nil {
		return "", edgeInvalid
	}
	// WalkDir visits entries in lexical order; JSON preserves filename boundaries.
	data, err := json.Marshal(entries)
	if err != nil {
		return "", edgeInvalid
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func validateEdgeCandidate(candidate object, source runIdentity, treeDigest string) error {
	if !source.valid() || !shaPattern.MatchString(treeDigest) ||
		!candidate.keys("schemaVersion", "commit", "runId", "runAttempt", "treeSha256") ||
		!candidate.numberEquals("schemaVersion", 1) || !candidate.equals("commit", source.Commit) ||
		!candidate.equals("runId", source.RunID) || !candidate.equals("runAttempt", source.RunAttempt) ||
		!candidate.equals("treeSha256", treeDigest) {
		return edgeInvalid
	}
	return nil
}

func createEdgeCandidate(args []string, out io.Writer) error {
	v, err := options("create-edge-candidate", args, "artifact-dir", "run-id", "run-attempt", "commit")
	if err != nil {
		return err
	}
	source := runIdentity{v["run-id"], v["run-attempt"], v["commit"]}
	digest, err := edgeTreeDigest(filepath.Join(v["artifact-dir"], "edge"))
	if err != nil {
		return err
	}
	candidate := object{"schemaVersion": json.Number("1"), "commit": source.Commit, "runId": source.RunID, "runAttempt": source.RunAttempt, "treeSha256": digest}
	if err := validateEdgeCandidate(candidate, source, digest); err != nil {
		return err
	}
	return encode(out, candidate)
}

func edgeCandidate(args []string) error {
	if err := e2eArtifactSelection(args[2], args[4], args[5]); err != nil {
		return err
	}
	candidate, err := readObjectFile(filepath.Join(args[0], "candidate.json"))
	if err != nil {
		return err
	}
	digest, err := edgeTreeDigest(filepath.Join(args[0], "edge"))
	if err != nil {
		return err
	}
	return validateEdgeCandidate(candidate, runIdentity{args[1], args[2], args[3]}, digest)
}

// Wrangler's structured output may contain other events. Only a single deploy
// event for the selected Worker can establish deployment identity; URLs, account
// identifiers, and arbitrary provider fields never become public evidence.
func edgeDeployment(args []string) (string, error) {
	fail := errors.New("Edge deployment output did not identify the selected Worker version.")
	if !edgeNamePattern.MatchString(args[1]) {
		return "", fail
	}
	data, err := readRegular(args[0])
	if err != nil || len(data) > 1048576 || !utf8.Valid(data) {
		return "", fail
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	version := ""
	for {
		var event object
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				break
			}
			return "", fail
		}
		if event == nil {
			return "", fail
		}
		if !event.equals("type", "deploy") {
			continue
		}
		if version != "" || !event.numberEquals("version", 1) ||
			!event.equals("worker_name", args[1]) || !edgeVersionPattern.MatchString(event.text("version_id")) {
			return "", fail
		}
		version = event.text("version_id")
	}
	if version == "" {
		return "", fail
	}
	return encodeLine(object{"schemaVersion": 1, "workerName": args[1], "versionId": version})
}
