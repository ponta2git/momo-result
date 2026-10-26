package cievidence

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	e2eRuntimeImageID = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	e2eArtifactID     = "777"
	e2eArtifactDigest = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
)

// e2eArtifact creates a producer directory for attempt 1 and its candidate
// through the production metadata command.
func e2eArtifact(t *testing.T, kind string) string {
	t.Helper()
	dir := t.TempDir()
	args := []string{"--kind", kind, "--artifact-dir", dir, "--run-id", "123456", "--run-attempt", "1", "--commit", fixtureCommit}
	if kind == e2eControlledWorker {
		ref := controlledWorkerRepo + ":" + fixtureCommit + "-123456-1"
		writeFile(t, filepath.Join(dir, controlledWorkerTar), fixture(t, "archive-bytes.txt"))
		writeFile(t, filepath.Join(dir, "image-id.txt"), []byte("sha256:"+fixtureSHA+"\n"))
		writeFile(t, filepath.Join(dir, "image-ref.txt"), []byte(ref+"\n"))
		writeFile(t, filepath.Join(dir, "image-tar.sha256"), []byte(fixtureTarSHA+"  "+controlledWorkerTar+"\n"))
	} else {
		writeFile(t, filepath.Join(dir, sessionFixtureJAR), fixture(t, "archive-bytes.txt"))
		writeFile(t, filepath.Join(dir, sessionFixtureRecord), []byte(`{"schemaVersion":1,"runtimeImageId":"`+e2eRuntimeImageID+`","jarSha256":"`+fixtureTarSHA+`"}`+"\n"))
		args = append(args, "--runtime-image-id", e2eRuntimeImageID)
	}
	code, out, stderr := run(t, "create-e2e-candidate", args, "")
	if code != 0 || stderr != "" {
		t.Fatalf("create %s: code=%d stderr=%q", kind, code, stderr)
	}
	writeFile(t, filepath.Join(dir, e2eCandidateRecord), []byte(out))
	return dir
}

func e2eArgs(kind, dir string) []string {
	args := []string{kind, dir, "123456", "1", fixtureCommit, e2eArtifactID, e2eArtifactDigest}
	if kind == e2eSessionFixture {
		args = append(args, e2eRuntimeImageID)
	}
	return args
}

func TestE2ECandidatesAcceptProducerAttemptAcrossConsumerRetries(t *testing.T) {
	worker := e2eArtifact(t, e2eControlledWorker)
	code, out, stderr := run(t, "e2e-candidate", e2eArgs(e2eControlledWorker, worker), "")
	expected := "image_ref=" + controlledWorkerRepo + ":" + fixtureCommit + "-123456-1\nimage_id=sha256:" + fixtureSHA + "\n"
	if code != 0 || out != expected || stderr != "" {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out, stderr)
	}
	session := e2eArtifact(t, e2eSessionFixture)
	if code, out, stderr := run(t, "e2e-candidate", e2eArgs(e2eSessionFixture, session), ""); code != 0 || out != "" || stderr != "" {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out, stderr)
	}
	// A consumer rerun keeps the recorded producer attempt; its own attempt is not a substitute.
	for _, kind := range []string{e2eControlledWorker, e2eSessionFixture} {
		dir := map[string]string{e2eControlledWorker: worker, e2eSessionFixture: session}[kind]
		args := e2eArgs(kind, dir)
		args[3] = "2"
		rejected(t, "e2e-candidate", args, "")
	}
}

func TestE2ECandidatesRejectMismatchedProvenanceAndPayloads(t *testing.T) {
	for _, kind := range []string{e2eControlledWorker, e2eSessionFixture} {
		t.Run(kind, func(t *testing.T) {
			changes := map[string]func([]string){
				"other-commit":    func(a []string) { a[4] = strings.Repeat("f", 40) },
				"other-run":       func(a []string) { a[2] = "999" },
				"artifact-id":     func(a []string) { a[5] = "0" },
				"artifact-digest": func(a []string) { a[6] = "sha512:" + e2eArtifactDigest },
				"other-kind-record": func(a []string) {
					a[0] = map[string]string{e2eControlledWorker: e2eSessionFixture, e2eSessionFixture: e2eControlledWorker}[kind]
				},
			}
			if kind == e2eSessionFixture {
				changes["other-runtime-image"] = func(a []string) { a[7] = "sha256:" + fixtureSHA }
			}
			for name, change := range changes {
				t.Run(name, func(t *testing.T) {
					args := e2eArgs(kind, e2eArtifact(t, kind))
					change(args)
					code, out, _ := run(t, "e2e-candidate", args, "")
					if code == 0 || out != "" {
						t.Fatalf("accepted %s: code=%d", name, code)
					}
				})
			}
			payloads := []string{e2eCandidateRecord, sessionFixtureJAR, sessionFixtureRecord}
			if kind == e2eControlledWorker {
				payloads = []string{e2eCandidateRecord, controlledWorkerTar, "image-id.txt", "image-ref.txt", "image-tar.sha256"}
			}
			for _, name := range payloads {
				t.Run("tampered-"+name, func(t *testing.T) {
					dir := e2eArtifact(t, kind)
					writeFile(t, filepath.Join(dir, name), []byte("private-input-marker"))
					rejected(t, "e2e-candidate", e2eArgs(kind, dir), "")
				})
				t.Run("missing-"+name, func(t *testing.T) {
					dir := e2eArtifact(t, kind)
					if err := os.Remove(filepath.Join(dir, name)); err != nil {
						t.Fatal(err)
					}
					rejected(t, "e2e-candidate", e2eArgs(kind, dir), "")
				})
				t.Run("symlink-"+name, func(t *testing.T) {
					dir := e2eArtifact(t, kind)
					path := filepath.Join(dir, name)
					if err := os.Rename(path, path+".real"); err != nil {
						t.Fatal(err)
					}
					if err := os.Symlink(path+".real", path); err != nil {
						t.Fatal(err)
					}
					rejected(t, "e2e-candidate", e2eArgs(kind, dir), "")
				})
			}
			candidate := fixtureCandidate(t, e2eArtifact(t, kind))
			for key := range candidate {
				t.Run("candidate-missing-"+key, func(t *testing.T) {
					dir := e2eArtifact(t, kind)
					data := mutated(t, fixtureFile(t, dir), func(o object) { delete(o, key) })
					writeFile(t, filepath.Join(dir, e2eCandidateRecord), data)
					rejected(t, "e2e-candidate", e2eArgs(kind, dir), "")
				})
			}
			t.Run("candidate-extra-field", func(t *testing.T) {
				dir := e2eArtifact(t, kind)
				data := mutated(t, fixtureFile(t, dir), func(o object) { o["unexpected"] = true })
				writeFile(t, filepath.Join(dir, e2eCandidateRecord), data)
				rejected(t, "e2e-candidate", e2eArgs(kind, dir), "")
			})
		})
	}
}

func TestE2ECandidateCreationRequiresKindSpecificBinding(t *testing.T) {
	session := e2eArtifact(t, e2eSessionFixture)
	base := []string{"--artifact-dir", session, "--run-id", "123456", "--run-attempt", "1", "--commit", fixtureCommit}
	for name, args := range map[string][]string{
		"fixture-without-runtime": append([]string{"--kind", e2eSessionFixture}, base...),
		"worker-with-runtime":     append(append([]string{"--kind", e2eControlledWorker}, base...), "--runtime-image-id", e2eRuntimeImageID),
		"unknown-kind":            append(append([]string{"--kind", "release"}, base...), "--runtime-image-id", e2eRuntimeImageID),
	} {
		if code, out, _ := run(t, "create-e2e-candidate", args, ""); code != 2 || out != "" {
			t.Fatalf("%s: code=%d", name, code)
		}
	}
	// The producer cannot bind the fixture to a Runtime image other than the one it built.
	args := append(append([]string{"--kind", e2eSessionFixture}, base...), "--runtime-image-id", "sha256:"+fixtureSHA)
	rejected(t, "create-e2e-candidate", args, "")
	// Arity is kind-specific for the consumer.
	for _, args := range [][]string{e2eArgs(e2eSessionFixture, session)[:7], append(e2eArgs(e2eControlledWorker, session), e2eRuntimeImageID)} {
		if code, out, _ := run(t, "e2e-candidate", args, ""); code != 2 || out != "" {
			t.Fatalf("arity accepted: code=%d", code)
		}
	}
}

func fixtureFile(t *testing.T, dir string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, e2eCandidateRecord))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func fixtureCandidate(t *testing.T, dir string) object {
	t.Helper()
	value, err := decodeObject(fixtureFile(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	return value
}
