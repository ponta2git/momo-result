package cievidence

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"path/filepath"
)

// System E2E test artifacts are not release candidates. Each kind has its own
// payload, but both bind one producer run/attempt/commit to the measured bytes.
const (
	e2eControlledWorker   = "controlled-worker"
	e2eSessionFixture     = "session-fixture"
	controlledWorkerRepo  = "momo-e2e-controlled-worker"
	controlledWorkerTar   = "controlled-worker-image.tar.gz"
	sessionFixtureJAR     = "session-fixture.jar"
	sessionFixtureRecord  = "session-fixture.json"
	e2eCandidateRecord    = "candidate.json"
	e2eCandidateMalformed = "E2E artifact failed its immutable provenance contract."
)

// e2eInputs are values measured from the artifact directory or supplied by an
// already verified source, never copied from the candidate being checked.
type e2eInputs struct {
	runIdentity
	Kind           string
	ImageID        string
	SHA256         string
	RuntimeImageID string
}

func e2eKind(kind string) bool { return kind == e2eControlledWorker || kind == e2eSessionFixture }

// sessionFixtureManifest is the runner's input contract, shared by CI, manual,
// and local preparation. CI provenance is recorded separately in candidate.json.
func sessionFixtureManifest(directory, runtimeImageID string) (string, error) {
	manifest, err := readObjectFile(filepath.Join(directory, sessionFixtureRecord))
	if err != nil {
		return "", err
	}
	actual, err := hashFile(filepath.Join(directory, sessionFixtureJAR))
	if err != nil {
		return "", err
	}
	if !digestPattern.MatchString(runtimeImageID) ||
		!manifest.keys("jarSha256", "runtimeImageId", "schemaVersion") || !manifest.numberEquals("schemaVersion", 1) ||
		!manifest.equals("runtimeImageId", runtimeImageID) || !manifest.equals("jarSha256", actual) {
		return "", errors.New("Session fixture does not match the verified Runtime image.")
	}
	return actual, nil
}

// measuredE2E reads the payload of one kind. The session fixture is bound to the
// supplied Runtime image ID; the worker image ID comes from its archive sidecars.
func measuredE2E(kind, directory string, source runIdentity, runtimeImageID string) (e2eInputs, error) {
	measured := e2eInputs{runIdentity: source, Kind: kind, RuntimeImageID: runtimeImageID}
	if !source.valid() || !e2eKind(kind) {
		return measured, errors.New(e2eCandidateMalformed)
	}
	var err error
	if kind == e2eControlledWorker {
		measured.ImageID, measured.SHA256, err = verifiedArchive(directory, controlledWorkerTar, source.imageRef(controlledWorkerRepo), "")
	} else {
		measured.SHA256, err = sessionFixtureManifest(directory, runtimeImageID)
	}
	return measured, err
}

func validateE2ECandidate(candidate object, expected e2eInputs) error {
	common := candidate.numberEquals("schemaVersion", 1) && candidate.equals("kind", expected.Kind) &&
		expected.runIdentity.valid() && candidate.equals("commit", expected.Commit) &&
		candidate.equals("runId", expected.RunID) && candidate.equals("runAttempt", expected.RunAttempt)
	switch expected.Kind {
	case e2eControlledWorker:
		common = common && digestPattern.MatchString(expected.ImageID) && shaPattern.MatchString(expected.SHA256) &&
			candidate.keys("commit", "imageId", "imageRef", "kind", "runAttempt", "runId", "schemaVersion", "tarSha256") &&
			candidate.equals("imageRef", expected.imageRef(controlledWorkerRepo)) &&
			candidate.equals("imageId", expected.ImageID) && candidate.equals("tarSha256", expected.SHA256)
	case e2eSessionFixture:
		common = common && digestPattern.MatchString(expected.RuntimeImageID) && shaPattern.MatchString(expected.SHA256) &&
			candidate.keys("commit", "jarSha256", "kind", "runAttempt", "runId", "runtimeImageId", "schemaVersion") &&
			candidate.equals("runtimeImageId", expected.RuntimeImageID) && candidate.equals("jarSha256", expected.SHA256)
	default:
		common = false
	}
	if !common {
		return errors.New(e2eCandidateMalformed)
	}
	return nil
}

func createE2ECandidate(args []string, out io.Writer) error {
	v, err := options("create-e2e-candidate", args, "kind", "artifact-dir", "run-id", "run-attempt", "commit", "runtime-image-id")
	if err != nil {
		// Only the session fixture is bound to a Runtime image.
		v, err = options("create-e2e-candidate", args, "kind", "artifact-dir", "run-id", "run-attempt", "commit")
		if err != nil || v["kind"] != e2eControlledWorker {
			return flag.ErrHelp
		}
	} else if v["kind"] != e2eSessionFixture {
		return flag.ErrHelp
	}
	source := runIdentity{RunID: v["run-id"], RunAttempt: v["run-attempt"], Commit: v["commit"]}
	measured, err := measuredE2E(v["kind"], v["artifact-dir"], source, v["runtime-image-id"])
	if err != nil {
		return err
	}
	m := object{"schemaVersion": json.Number("1"), "kind": measured.Kind, "commit": source.Commit, "runId": source.RunID, "runAttempt": source.RunAttempt}
	if measured.Kind == e2eControlledWorker {
		m["imageRef"], m["imageId"], m["tarSha256"] = source.imageRef(controlledWorkerRepo), measured.ImageID, measured.SHA256
	} else {
		m["runtimeImageId"], m["jarSha256"] = measured.RuntimeImageID, measured.SHA256
	}
	if err = validateE2ECandidate(m, measured); err != nil {
		return err
	}
	return encode(out, m)
}

// e2eCandidate checks a downloaded artifact against the selected producer. The
// artifact ID and digest are the producer's upload outputs; download verifies
// the bytes against the digest, so only their identity format is checked here.
func e2eCandidate(args []string) (string, error) {
	kind := ""
	if len(args) > 0 {
		kind = args[0]
	}
	if (kind != e2eControlledWorker || len(args) != 7) && (kind != e2eSessionFixture || len(args) != 8) {
		return "", flag.ErrHelp
	}
	if !positiveIDPattern.MatchString(args[5]) {
		return "", errors.New("Invalid E2E artifact identity.")
	}
	if _, err := normalizeArtifactDigest(args[6]); err != nil {
		return "", err
	}
	runtimeImageID := ""
	if kind == e2eSessionFixture {
		runtimeImageID = args[7]
	}
	measured, err := measuredE2E(kind, args[1], runIdentity{RunID: args[2], RunAttempt: args[3], Commit: args[4]}, runtimeImageID)
	if err != nil {
		return "", err
	}
	candidate, err := readObjectFile(filepath.Join(args[1], e2eCandidateRecord))
	if err != nil {
		return "", err
	}
	if err = validateE2ECandidate(candidate, measured); err != nil {
		return "", err
	}
	if kind == e2eSessionFixture {
		return "", nil
	}
	return outputFields(candidate, "image_ref", "imageRef", "image_id", "imageId"), nil
}
