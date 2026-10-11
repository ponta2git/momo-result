package cievidence

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var analysisRefPattern = regexp.MustCompile(`^registry\.fly\.io/momo-result-analysis:[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$`)

func hashFile(path string) (string, error) {
	if !regularFile(path) {
		return "", errors.New("Evidence input must be a regular file.")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("Evidence input could not be read.")
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", errors.New("Evidence input could not be hashed.")
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func fileDigestMatch(path, expected string) error {
	if !shaPattern.MatchString(expected) {
		return errors.New("Invalid expected file digest.")
	}
	actual, err := hashFile(path)
	if err != nil {
		return err
	}
	if actual != expected {
		return errors.New("File digest does not match verified provenance.")
	}
	return nil
}

// Shell command substitution strips trailing newlines, not spaces or CRs.
func recordedText(path string) (string, error) {
	data, err := readRegular(path)
	return strings.TrimRight(string(data), "\n"), err
}

func recordedChecksum(path string) (string, error) {
	data, err := readRegular(path)
	if err != nil {
		return "", err
	}
	line := strings.TrimSuffix(string(data), "\n")
	digest, filename, found := strings.Cut(line, " ")
	// The path is descriptive, not an input path to follow. Permit spaces in
	// it, but require exactly one checksum record for the selected archive.
	if !found || !shaPattern.MatchString(digest) || len(filename) < 2 ||
		(filename[0] != ' ' && filename[0] != '*') || strings.ContainsAny(filename, "\r\n") {
		return "", errors.New("Invalid image archive checksum record.")
	}
	return digest, nil
}

func http4sPin(repoRoot string) (string, error) {
	data, err := readRegular(filepath.Join(repoRoot, ".http4s-ref"))
	if err != nil {
		return "", err
	}
	pin := strings.TrimSpace(string(data))
	if !commitPattern.MatchString(pin) {
		return "", errors.New("Invalid HTTP4s source revision.")
	}
	return pin, nil
}

// verifiedArchive validates sidecars and the compressed bytes. Decompression
// and docker load stay in the caller, which must preserve pipeline failures.
func verifiedArchive(directory, archiveName, expectedRef, expectedSHA string) (string, string, error) {
	recordedRef, err := recordedText(filepath.Join(directory, "image-ref.txt"))
	if err != nil {
		return "", "", err
	}
	recordedID, err := recordedText(filepath.Join(directory, "image-id.txt"))
	if err != nil {
		return "", "", err
	}
	recordedSHA, err := recordedChecksum(filepath.Join(directory, "image-tar.sha256"))
	if err != nil {
		return "", "", err
	}
	if recordedRef != expectedRef || !digestPattern.MatchString(recordedID) ||
		(expectedSHA != "" && recordedSHA != expectedSHA) {
		return "", "", errors.New("Image sidecars do not match candidate provenance.")
	}
	actualSHA, err := hashFile(filepath.Join(directory, archiveName))
	if err != nil {
		return "", "", err
	}
	if recordedSHA != actualSHA {
		return "", "", errors.New("Image archive or sidecars do not match candidate provenance.")
	}
	return recordedID, actualSHA, nil
}

func analysisArchive(args []string) (string, error) {
	if !analysisRefPattern.MatchString(args[1]) || !shaPattern.MatchString(args[2]) {
		return "", errors.New("Invalid expected analysis image identity.")
	}
	imageID, _, err := verifiedArchive(args[0], "analysis-worker-image.tar.gz", args[1], args[2])
	if err != nil {
		return "", err
	}
	return imageID + "\n", nil
}

func runtimeCandidate(args []string, repoRoot string) error {
	expected := runtimeCandidateInputs{runIdentity: runIdentity{args[1], args[2], args[3]}}
	if !expected.valid() || args[4] != expected.imageRef(runtimeRepository) {
		return errors.New("Runtime image reference does not match the selected workflow run.")
	}
	data, err := readRegular(filepath.Join(args[0], "candidate.json"))
	if err != nil {
		return err
	}
	patch, err := readRegular(filepath.Join(args[0], "http4s-patch.json"))
	if err != nil {
		return err
	}
	expected.ImageID, expected.TarSHA256, err = verifiedArchive(args[0], "momo-result-image.tar.gz", args[4], "")
	if err != nil {
		return err
	}
	expected.HTTP4SSourceSHA, err = http4sPin(repoRoot)
	if err != nil {
		return err
	}
	expected.ConfigSHA256, err = hashFile(filepath.Join(repoRoot, "fly.toml"))
	if err != nil {
		return err
	}
	return parseRuntimeCandidate(data, patch, expected)
}
