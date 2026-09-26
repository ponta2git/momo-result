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

expected_manifest_name="runtime-image-registry-manifest-${expected_run_id}-${expected_run_attempt}"

jq -ers \
  --arg commit "${expected_commit}" \
  --arg manifestName "${expected_manifest_name}" \
  --arg runAttempt "${expected_run_attempt}" \
  --arg runId "${expected_run_id}" '
    select(length == 1) | .[0] |
    select(type == "object") |
    .schemaVersion as $schemaVersion |
    select($schemaVersion == 1 or $schemaVersion == 2 or $schemaVersion == 3) |
    (if $schemaVersion == 1 then $runAttempt else .sourceRunAttempt end) as $sourceRunAttempt |
    select($sourceRunAttempt | type == "string" and test("^[1-9][0-9]*\\z")) |
    ([
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
    ] +
      (if $schemaVersion >= 2 then ["sourceRunAttempt"] else [] end) +
      (if $schemaVersion == 3 then [
          "http4sPatchRepository",
          "http4sPatchScalaVersion",
          "http4sPatchSourceSha",
          "http4sPatchVersion"
        ] else [] end) | sort) as $expectedKeys |
    select(keys == $expectedKeys and
    .commit == $commit and
    .runId == $runId and
    .runAttempt == $runAttempt and
    .imageRef == ("registry.fly.io/momo-result:" + $commit + "-" + $runId + "-" + $sourceRunAttempt) and
    ($schemaVersion != 3 or
      (
        .http4sPatchRepository == "https://github.com/ponta2git/http4s.git" and
        .http4sPatchScalaVersion == "3.3.6" and
        (.http4sPatchSourceSha | type == "string" and test("^[0-9a-f]{40}\\z")) and
        (.http4sPatchVersion | type == "string" and test("^[0-9A-Za-z][0-9A-Za-z.+-]*\\z"))
      )) and
    .sourceArtifactName == ("runtime-image-" + $runId + "-" + $sourceRunAttempt) and
    .manifestArtifactName == $manifestName and
    (.imageId | type == "string" and test("^sha256:[0-9a-f]{64}\\z")) and
    (.registryDigest | type == "string" and test("^sha256:[0-9a-f]{64}\\z")) and
    .registryRef == ("registry.fly.io/momo-result@" + .registryDigest) and
    (.configSha256 | type == "string" and test("^[0-9a-f]{64}\\z")) and
    (.manifestSha256 | type == "string" and test("^[0-9a-f]{64}\\z")) and
    (.sourceArtifactId | type == "string" and test("^[1-9][0-9]*\\z")) and
    (.manifestArtifactId | type == "string" and test("^[1-9][0-9]*\\z")) and
    (.sourceArtifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}\\z")) and
    (.manifestArtifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}\\z"))) |
    "candidate_sha=\(.commit)",
    "source_run_attempt=\($sourceRunAttempt)",
    "config_sha256=\(.configSha256)",
    "image_ref=\(.imageRef)",
    "manifest_artifact_digest=\(.manifestArtifactDigest)",
    "manifest_artifact_id=\(.manifestArtifactId)",
    "manifest_artifact_name=\(.manifestArtifactName)",
    "manifest_sha256=\(.manifestSha256)",
    "registry_digest=\(.registryDigest)",
    "registry_ref=\(.registryRef)"
  ' "${metadata_file}" || {
    echo "Runtime deployment metadata failed its immutable provenance contract." >&2
    exit 1
  }
