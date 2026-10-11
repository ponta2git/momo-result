package cievidence

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	fixtureCommit    = "0123456789abcdef0123456789abcdef01234567"
	fixtureSHA       = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	fixturePin       = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	fixtureTarSHA    = "2e8d205e86354f4cc09d54a8d7af7302879ab53df8f0f60d06f495cde5d2c3c0"
	fixtureConfigSHA = "cccc1e830bd7e323505e8603178a14066a83fdcf305704b7e20fc71c977b1c50"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func mutated(t *testing.T, data []byte, change func(object)) []byte {
	t.Helper()
	value, err := decodeObject(data)
	if err != nil {
		t.Fatal(err)
	}
	change(value)
	result, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func run(t *testing.T, command string, args []string, repoRoot string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Run(command, args, strings.NewReader(""), &out, &errOut, repoRoot)
	return code, out.String(), errOut.String()
}

func rejected(t *testing.T, command string, args []string, root string) {
	t.Helper()
	code, out, stderr := run(t, command, args, root)
	if code != 1 || out != "" {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out, stderr)
	}
	if strings.Contains(stderr, "private-input-marker") {
		t.Fatal("untrusted evidence leaked through an error")
	}
}

func TestAnalysisCandidateBaselineAndOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "candidate.json")
	writeFile(t, path, fixture(t, "analysis-candidate.json"))
	code, out, stderr := run(t, "analysis-candidate", []string{path, "123456", "2", fixtureCommit}, "")
	expected := "candidate_sha=" + fixtureCommit + "\ncandidate_run_attempt=2\nconfig_sha256=" + fixtureConfigSHA +
		"\nimage_artifact_digest=sha256:" + fixtureSHA + "\nimage_artifact_id=987654\nimage_artifact_name=analysis-worker-image-123456-2\nimage_ref=registry.fly.io/momo-result-analysis:" +
		fixtureCommit + "-123456-2\ntar_sha256=" + fixtureTarSHA + "\n"
	if code != 0 || out != expected || stderr != "" {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out, stderr)
	}
	args := []string{path, "123456", "2", fixtureCommit, "--config", filepath.Join("testdata", "fly.toml")}
	if code, _, stderr := run(t, "analysis-candidate", args, ""); code != 0 {
		t.Fatal(stderr)
	}
	args[5] = filepath.Join("testdata", "archive-bytes.txt")
	rejected(t, "analysis-candidate", args, "")
}

func TestProvenanceRejectsMissingTypesStreamsAndUnknownFields(t *testing.T) {
	cases := []struct {
		name     string
		expected Identity
		validate func([]byte, Identity) error
	}{
		{"analysis-candidate.json", Identity{"123456", "2", fixtureCommit}, ValidateAnalysisCandidate},
		{"runtime-deployment-v1.json", Identity{"123456", "3", fixtureCommit}, ValidateRuntimeDeployment},
		{"runtime-deployment-v2.json", Identity{"123456", "3", fixtureCommit}, ValidateRuntimeDeployment},
		{"runtime-deployment-v3.json", Identity{"123456", "3", fixtureCommit}, ValidateRuntimeDeployment},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := fixture(t, tc.name)
			if err := tc.validate(data, tc.expected); err != nil {
				t.Fatal(err)
			}
			value, err := decodeObject(data)
			if err != nil {
				t.Fatal(err)
			}
			for key := range value {
				t.Run("missing-"+key, func(t *testing.T) {
					if err := tc.validate(mutated(t, data, func(o object) { delete(o, key) }), tc.expected); err == nil {
						t.Fatal("missing field accepted")
					}
				})
			}
			for _, key := range []string{"schemaVersion", "runId", "runAttempt", "commit", "configSha256"} {
				for _, wrong := range []any{nil, true, []any{}, object{}} {
					if tc.validate(mutated(t, data, func(o object) { o[key] = wrong }), tc.expected) == nil {
						t.Fatalf("wrong type accepted: %s", key)
					}
				}
			}
			for name, bad := range map[string][]byte{
				"empty": nil, "null": []byte("null"), "array": []byte("[]"),
				"unknown": mutated(t, data, func(o object) { o["unexpected"] = true }),
				"prefix":  append([]byte("{}\n"), data...), "suffix": append(append([]byte{}, data...), []byte("{}")...),
				"malformed-suffix": append(append([]byte{}, data...), []byte("private-input-marker")...),
				"string-version":   mutated(t, data, func(o object) { o["schemaVersion"] = "1" }),
				"newline-digest":   mutated(t, data, func(o object) { o["configSha256"] = fixtureConfigSHA + "\n" }),
				"wrong-run":        mutated(t, data, func(o object) { o["runId"] = "999" }),
			} {
				if tc.validate(bad, tc.expected) == nil {
					t.Errorf("accepted %s", name)
				}
			}
			wrongIdentity := tc.expected
			wrongIdentity.RunAttempt = "99"
			if tc.validate(data, wrongIdentity) == nil {
				t.Fatal("consumer attempt accepted as candidate producer")
			}
		})
	}
}

func TestRuntimeDeploymentPreservesProducerAttemptAndHistoricalPatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "deployment.json")
	for _, version := range []string{"1", "2", "3"} {
		writeFile(t, path, fixture(t, "runtime-deployment-v"+version+".json"))
		code, out, stderr := run(t, "runtime-deployment", []string{path, "123456", "3", fixtureCommit}, t.TempDir())
		attempt := "2"
		if version == "1" {
			attempt = "3"
		}
		expected := "candidate_sha=" + fixtureCommit + "\nsource_run_attempt=" + attempt + "\nconfig_sha256=" + fixtureConfigSHA +
			"\nimage_ref=registry.fly.io/momo-result:" + fixtureCommit + "-123456-" + attempt +
			"\nmanifest_artifact_digest=sha256:" + fixtureSHA + "\nmanifest_artifact_id=222\nmanifest_artifact_name=runtime-image-registry-manifest-123456-3\nmanifest_sha256=" +
			fixtureSHA + "\nregistry_digest=sha256:" + fixtureSHA + "\nregistry_ref=registry.fly.io/momo-result@sha256:" + fixtureSHA + "\n"
		if code != 0 || out != expected || stderr != "" {
			t.Fatalf("v%s code=%d stdout=%q stderr=%q", version, code, out, stderr)
		}
	}
	args := []string{path, "123456", "3", fixtureCommit, "--config", filepath.Join("testdata", "fly.toml")}
	if code, _, stderr := run(t, "runtime-deployment", args, ""); code != 0 {
		t.Fatal(stderr)
	}
	args[5] = filepath.Join("testdata", "archive-bytes.txt")
	rejected(t, "runtime-deployment", args, "")
	data := fixture(t, "runtime-deployment-v3.json")
	for _, change := range []func(object){
		func(o object) {
			o["sourceRunAttempt"] = "3"
			o["imageRef"] = "registry.fly.io/momo-result:" + fixtureCommit + "-123456-3"
		},
		func(o object) { o["registryRef"] = "registry.fly.io/momo-result@sha256:" + strings.Repeat("b", 64) },
		func(o object) { o["http4sPatchSourceSha"] = strings.Repeat("b", 64) },
		func(o object) { o["http4sPatchRepository"] = "https://example.invalid/http4s" },
	} {
		writeFile(t, path, mutated(t, data, change))
		rejected(t, "runtime-deployment", args[:4], "")
	}
}

func archiveFixture(t *testing.T, runtime bool) (string, string) {
	t.Helper()
	dir, root := t.TempDir(), t.TempDir()
	archiveName, ref := "analysis-worker-image.tar.gz", "registry.fly.io/momo-result-analysis:"+fixtureCommit+"-123456-2"
	if runtime {
		archiveName = "momo-result-image.tar.gz"
		ref = "registry.fly.io/momo-result:" + fixtureCommit + "-123456-2"
	}
	writeFile(t, filepath.Join(dir, archiveName), fixture(t, "archive-bytes.txt"))
	writeFile(t, filepath.Join(dir, "image-id.txt"), []byte("sha256:"+fixtureSHA+"\n"))
	writeFile(t, filepath.Join(dir, "image-ref.txt"), []byte(ref+"\n"))
	writeFile(t, filepath.Join(dir, "image-tar.sha256"), []byte(fixtureTarSHA+"  "+archiveName+"\n"))
	if runtime {
		writeFile(t, filepath.Join(dir, "candidate.json"), fixture(t, "runtime-candidate.json"))
		writeFile(t, filepath.Join(dir, "http4s-patch.json"), fixture(t, "http4s-patch.json"))
		writeFile(t, filepath.Join(root, "fly.toml"), fixture(t, "fly.toml"))
		writeFile(t, filepath.Join(root, ".http4s-ref"), []byte(fixturePin+"\n"))
	}
	return dir, root
}

func TestRuntimeCandidateChecksActualFilesAndPatch(t *testing.T) {
	dir, root := archiveFixture(t, true)
	args := []string{dir, "123456", "2", fixtureCommit, "registry.fly.io/momo-result:" + fixtureCommit + "-123456-2"}
	if code, out, stderr := run(t, "runtime-candidate", args, root); code != 0 || out != "" || stderr != "" {
		t.Fatalf("%d %q %q", code, out, stderr)
	}
	for _, name := range []string{"candidate.json", "http4s-patch.json", "momo-result-image.tar.gz", "image-id.txt", "image-ref.txt", "image-tar.sha256"} {
		t.Run("tampered-"+name, func(t *testing.T) {
			dir, root := archiveFixture(t, true)
			args := append([]string{}, args...)
			args[0] = dir
			writeFile(t, filepath.Join(dir, name), []byte("private-input-marker"))
			rejected(t, "runtime-candidate", args, root)
		})
		t.Run("symlink-"+name, func(t *testing.T) {
			dir, root := archiveFixture(t, true)
			args := append([]string{}, args...)
			args[0] = dir
			path := filepath.Join(dir, name)
			if err := os.Rename(path, path+".real"); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(path+".real", path); err != nil {
				t.Fatal(err)
			}
			rejected(t, "runtime-candidate", args, root)
		})
	}
	for _, name := range []string{".http4s-ref", "fly.toml"} {
		dir, root := archiveFixture(t, true)
		args := append([]string{}, args...)
		args[0] = dir
		writeFile(t, filepath.Join(root, name), []byte("private-input-marker"))
		rejected(t, "runtime-candidate", args, root)
	}
}

func TestRuntimeCandidateAndPatchExactShape(t *testing.T) {
	expected := RuntimeCandidateInputs{Identity: Identity{"123456", "2", fixtureCommit}, ImageID: "sha256:" + fixtureSHA, TarSHA256: fixtureTarSHA, ConfigSHA256: fixtureConfigSHA, HTTP4SSourceSHA: fixturePin}
	data, patch := fixture(t, "runtime-candidate.json"), fixture(t, "http4s-patch.json")
	if err := ValidateRuntimeCandidate(data, patch, expected); err != nil {
		t.Fatal(err)
	}
	for _, target := range []struct {
		data     []byte
		validate func([]byte) error
	}{
		{data, func(b []byte) error { return ValidateRuntimeCandidate(b, patch, expected) }},
		{patch, func(b []byte) error { return ValidateHTTP4SPatch(b, fixturePin) }},
	} {
		value, _ := decodeObject(target.data)
		for key := range value {
			if target.validate(mutated(t, target.data, func(o object) { delete(o, key) })) == nil {
				t.Fatalf("missing %s accepted", key)
			}
		}
		for _, bad := range [][]byte{append(append([]byte{}, target.data...), []byte("{}")...), mutated(t, target.data, func(o object) { o["extra"] = true })} {
			if target.validate(bad) == nil {
				t.Fatal("ambiguous metadata accepted")
			}
		}
	}
}
