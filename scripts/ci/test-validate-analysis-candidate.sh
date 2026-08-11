#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
canonicalizer="${repo_root}/scripts/ci/canonicalize-artifact-digest.sh"
validator="${repo_root}/scripts/ci/validate-analysis-candidate.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly run_id=123456
readonly run_attempt=2
readonly commit=0123456789abcdef0123456789abcdef01234567
readonly digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly artifact_digest="$("${canonicalizer}" "${digest}")"

write_valid_candidate() {
  jq -n \
    --arg commit "${commit}" \
    --arg artifactDigest "${artifact_digest}" \
    --arg digest "${digest}" \
    --arg runAttempt "${run_attempt}" \
    --arg runId "${run_id}" '
      {
        schemaVersion: 1,
        commit: $commit,
        runId: $runId,
        runAttempt: $runAttempt,
        imageRef: ("registry.fly.io/momo-result-analysis:" + $commit + "-" + $runId + "-" + $runAttempt),
        imageArtifactName: ("analysis-worker-image-" + $runId + "-" + $runAttempt),
        imageArtifactId: "987654",
        imageArtifactDigest: $artifactDigest,
        tarSha256: $digest,
        configSha256: $digest
      }
    ' > "${test_dir}/candidate.json"
}

expect_rejected() {
  local name="$1"
  if "${validator}" "${test_dir}/candidate.json" "${run_id}" "${run_attempt}" "${commit}" \
    > /dev/null 2>&1; then
    echo "Invalid candidate was accepted: ${name}" >&2
    exit 1
  fi
}

write_valid_candidate
actual="$("${validator}" "${test_dir}/candidate.json" "${run_id}" "${run_attempt}" "${commit}")"
grep -qx "candidate_sha=${commit}" <<< "${actual}"
grep -qx "image_artifact_name=analysis-worker-image-${run_id}-${run_attempt}" <<< "${actual}"
grep -qx "image_ref=registry.fly.io/momo-result-analysis:${commit}-${run_id}-${run_attempt}" <<< "${actual}"

jq '.commit = "ffffffffffffffffffffffffffffffffffffffff"' \
  "${test_dir}/candidate.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/candidate.json"
expect_rejected tampered-commit

write_valid_candidate
jq '.unexpected = true' "${test_dir}/candidate.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/candidate.json"
expect_rejected unknown-field

write_valid_candidate
jq '.imageArtifactDigest = "not-a-digest"' \
  "${test_dir}/candidate.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/candidate.json"
expect_rejected invalid-artifact-digest

write_valid_candidate
if "${validator}" "${test_dir}/candidate.json" 999 "${run_attempt}" "${commit}" \
  > /dev/null 2>&1; then
  echo "Candidate from a different run was accepted." >&2
  exit 1
fi

echo "Analysis candidate provenance tests passed."
