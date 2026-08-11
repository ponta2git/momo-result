#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 4 ]]; then
  echo "Usage: $0 <deployment.json> <run-id> <run-attempt> <commit>" >&2
  exit 2
fi

metadata_file="$1"
expected_run_id="$2"
expected_run_attempt="$3"
expected_commit="$4"

[[ -f "${metadata_file}" && ! -L "${metadata_file}" ]] || exit 1
[[ "${expected_run_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_run_attempt}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_commit}" =~ ^[0-9a-f]{40}$ ]] || exit 1

expected_image_ref="registry.fly.io/momo-result:${expected_commit}-${expected_run_id}-${expected_run_attempt}"
expected_source_name="runtime-image-${expected_run_id}-${expected_run_attempt}"
expected_manifest_name="runtime-image-registry-manifest-${expected_run_id}-${expected_run_attempt}"

jq -e \
  --arg commit "${expected_commit}" \
  --arg imageRef "${expected_image_ref}" \
  --arg manifestName "${expected_manifest_name}" \
  --arg runAttempt "${expected_run_attempt}" \
  --arg runId "${expected_run_id}" \
  --arg sourceName "${expected_source_name}" '
    type == "object" and
    keys == [
      "commit",
      "configSha256",
      "imageId",
      "imageRef",
      "manifestArtifactDigest",
      "manifestArtifactId",
      "manifestArtifactName",
      "manifestSha256",
      "registryDigest",
      "registryRef",
      "runAttempt",
      "runId",
      "schemaVersion",
      "sourceArtifactDigest",
      "sourceArtifactId",
      "sourceArtifactName"
    ] and
    .schemaVersion == 1 and
    .commit == $commit and
    .runId == $runId and
    .runAttempt == $runAttempt and
    .imageRef == $imageRef and
    .sourceArtifactName == $sourceName and
    .manifestArtifactName == $manifestName and
    (.imageId | type == "string" and test("^sha256:[0-9a-f]{64}$")) and
    (.registryDigest | type == "string" and test("^sha256:[0-9a-f]{64}$")) and
    .registryRef == ("registry.fly.io/momo-result@" + .registryDigest) and
    (.configSha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.manifestSha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.sourceArtifactId | type == "string" and test("^[1-9][0-9]*$")) and
    (.manifestArtifactId | type == "string" and test("^[1-9][0-9]*$")) and
    (.sourceArtifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$")) and
    (.manifestArtifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
  ' "${metadata_file}" > /dev/null || {
    echo "Runtime deployment metadata failed its immutable provenance contract." >&2
    exit 1
  }

printf 'candidate_sha=%s\n' "${expected_commit}"
jq -r '
  "config_sha256=\(.configSha256)",
  "image_ref=\(.imageRef)",
  "manifest_artifact_digest=\(.manifestArtifactDigest)",
  "manifest_artifact_id=\(.manifestArtifactId)",
  "manifest_artifact_name=\(.manifestArtifactName)",
  "manifest_sha256=\(.manifestSha256)",
  "registry_digest=\(.registryDigest)",
  "registry_ref=\(.registryRef)"
' "${metadata_file}"
