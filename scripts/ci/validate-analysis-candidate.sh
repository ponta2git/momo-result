#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 4 ]]; then
  echo "Usage: $0 <candidate.json> <run-id> <run-attempt> <commit>" >&2
  exit 2
fi

metadata_file="$1"
expected_run_id="$2"
expected_run_attempt="$3"
expected_commit="$4"

[[ -f "${metadata_file}" && ! -L "${metadata_file}" ]] || {
  echo "Candidate metadata must be a regular file." >&2
  exit 1
}
[[ "${expected_run_id}" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid expected candidate run ID." >&2
  exit 1
}
[[ "${expected_run_attempt}" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid expected candidate run attempt." >&2
  exit 1
}
[[ "${expected_commit}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Invalid expected candidate commit." >&2
  exit 1
}

expected_artifact_name="analysis-worker-image-${expected_run_id}-${expected_run_attempt}"
expected_image_ref="registry.fly.io/momo-result-analysis:${expected_commit}-${expected_run_id}-${expected_run_attempt}"

jq -e \
  --arg artifactName "${expected_artifact_name}" \
  --arg commit "${expected_commit}" \
  --arg imageRef "${expected_image_ref}" \
  --arg runAttempt "${expected_run_attempt}" \
  --arg runId "${expected_run_id}" '
    type == "object" and
    keys == [
      "commit",
      "configSha256",
      "imageArtifactDigest",
      "imageArtifactId",
      "imageArtifactName",
      "imageRef",
      "runAttempt",
      "runId",
      "schemaVersion",
      "tarSha256"
    ] and
    .schemaVersion == 1 and
    .commit == $commit and
    .runId == $runId and
    .runAttempt == $runAttempt and
    .imageRef == $imageRef and
    .imageArtifactName == $artifactName and
    (.imageArtifactId | type == "string" and test("^[1-9][0-9]*$")) and
    (.imageArtifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$")) and
    (.tarSha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.configSha256 | type == "string" and test("^[0-9a-f]{64}$"))
  ' "${metadata_file}" > /dev/null || {
    echo "Candidate metadata failed its immutable provenance contract." >&2
    exit 1
  }

printf 'candidate_sha=%s\n' "${expected_commit}"
printf 'candidate_run_attempt=%s\n' "${expected_run_attempt}"
printf 'config_sha256=%s\n' "$(jq -r '.configSha256' "${metadata_file}")"
printf 'image_artifact_digest=%s\n' "$(jq -r '.imageArtifactDigest' "${metadata_file}")"
printf 'image_artifact_id=%s\n' "$(jq -r '.imageArtifactId' "${metadata_file}")"
printf 'image_artifact_name=%s\n' "${expected_artifact_name}"
printf 'image_ref=%s\n' "${expected_image_ref}"
printf 'tar_sha256=%s\n' "$(jq -r '.tarSha256' "${metadata_file}")"
