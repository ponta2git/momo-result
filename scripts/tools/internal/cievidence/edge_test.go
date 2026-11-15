package cievidence

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func edgeFixture(t *testing.T, root string, source runIdentity) string {
	t.Helper()
	dir := filepath.Join(root, "web-edge")
	for _, path := range []string{"worker", "assets"} {
		if err := os.MkdirAll(filepath.Join(dir, "edge", path), 0700); err != nil {
			t.Fatal(err)
		}
	}
	put(t, filepath.Join(dir, "edge", "wrangler.json"), "{\"name\":\"fixture-web\",\"main\":\"worker/index.js\"}\n")
	put(t, filepath.Join(dir, "edge", "worker", "index.js"), "export default {};\n")
	put(t, filepath.Join(dir, "edge", "assets", "index.html"), "<html>fixture</html>\n")
	args := []string{"--artifact-dir", dir, "--run-id", source.RunID, "--run-attempt", source.RunAttempt, "--commit", source.Commit}
	code, out, diagnostics := call(t, "create-edge-candidate", args, "", root)
	if code != 0 {
		t.Fatal(diagnostics)
	}
	put(t, filepath.Join(dir, "candidate.json"), out)
	return dir
}

func TestEdgeCandidateBindsTreeAndProducer(t *testing.T) {
	source := runIdentity{"123", "1", testCommit}
	root := t.TempDir()
	dir := edgeFixture(t, root, source)
	args := []string{dir, source.RunID, source.RunAttempt, source.Commit, "333", testDigest}
	if code, out, diagnostics := call(t, "edge-candidate", args, "", root); code != 0 || out != "" || diagnostics != "" {
		t.Fatal(code, out, diagnostics)
	}
	for index := 1; index < len(args); index++ {
		wrong := append([]string{}, args...)
		wrong[index] = "private-input-marker"
		rejected(t, "edge-candidate", wrong, root)
	}
	for _, mutation := range []string{"worker", "asset", "config", "added", "removed", "renamed", "symlink", "metadata"} {
		t.Run(mutation, func(t *testing.T) {
			root := t.TempDir()
			dir := edgeFixture(t, root, source)
			asset := filepath.Join(dir, "edge", "assets", "index.html")
			switch mutation {
			case "worker":
				put(t, filepath.Join(dir, "edge", "worker", "index.js"), "private-input-marker")
			case "asset":
				put(t, asset, "private-input-marker")
			case "config":
				put(t, filepath.Join(dir, "edge", "wrangler.json"), "private-input-marker")
			case "added":
				put(t, filepath.Join(dir, "edge", "assets", "extra.js"), "private-input-marker")
			case "removed":
				if err := os.Remove(asset); err != nil {
					t.Fatal(err)
				}
			case "renamed", "symlink":
				if err := os.Rename(asset, asset+".real"); err != nil {
					t.Fatal(err)
				}
				if mutation == "symlink" {
					if err := os.Symlink(asset+".real", asset); err != nil {
						t.Fatal(err)
					}
				}
			case "metadata":
				put(t, filepath.Join(dir, "candidate.json"), "private-input-marker")
			}
			rejected(t, "edge-candidate", []string{dir, source.RunID, source.RunAttempt, source.Commit, "333", testDigest}, root)
		})
	}
}

func TestEdgeCandidateExactMetadata(t *testing.T) {
	root := t.TempDir()
	source := runIdentity{"123", "1", testCommit}
	dir := edgeFixture(t, root, source)
	path := filepath.Join(dir, "candidate.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	value, err := decodeObject(data)
	if err != nil {
		t.Fatal(err)
	}
	args := []string{dir, source.RunID, source.RunAttempt, source.Commit, "333", testDigest}
	for key := range value {
		writeFile(t, path, mutated(t, data, func(o object) { delete(o, key) }))
		rejected(t, "edge-candidate", args, root)
	}
	for _, change := range []func(object){
		func(o object) { o["unexpected"] = true },
		func(o object) { o["schemaVersion"] = json.Number("1.00000000000000001") },
		func(o object) { o["runAttempt"] = 1 },
		func(o object) { o["treeSha256"] = testDigest },
	} {
		writeFile(t, path, mutated(t, data, change))
		rejected(t, "edge-candidate", args, root)
	}
}

func TestEdgeDeploymentProviderWire(t *testing.T) {
	// Synthetic values in the installed Wrangler 4.162 deploy JSONL shape.
	provider := `{"type":"deploy","version":1,"worker_name":"fixture-web","worker_tag":"private-input-marker","version_id":"12345678-1234-1234-1234-123456789abc","targets":["https://private-input-marker.invalid"],"worker_name_overridden":false,"bundle_size":{"raw_bytes":123,"gzip_bytes":100},"timestamp":"2026-11-15T00:00:00.000Z"}` + "\n"
	path := filepath.Join(t.TempDir(), "provider.jsonl")
	put(t, path, `{"type":"build","version":1}`+"\n"+provider)
	args := []string{path, "fixture-web"}
	code, out, diagnostics := call(t, "edge-deployment", args, "", "")
	want := "{\"schemaVersion\":1,\"versionId\":\"12345678-1234-1234-1234-123456789abc\",\"workerName\":\"fixture-web\"}\n"
	if code != 0 || out != want || diagnostics != "" {
		t.Fatal(code, out, diagnostics)
	}
	for _, bad := range []string{
		"", "null", "[]", provider + provider, provider + "private-input-marker",
		strings.Replace(provider, `"type":"deploy"`, `"type":"version-upload"`, 1),
		strings.Replace(provider, `"worker_name":"fixture-web"`, `"worker_name":"other-web"`, 1),
		strings.Replace(provider, `"version":1`, `"version":2`, 1),
		strings.Replace(provider, `"version_id":"12345678-1234-1234-1234-123456789abc"`, `"version_id":null`, 1),
		strings.Replace(provider, "private-input-marker", "\xff", 1),
		provider + strings.Repeat(" ", 1048576),
	} {
		put(t, path, bad)
		rejected(t, "edge-deployment", args, "")
	}
}
