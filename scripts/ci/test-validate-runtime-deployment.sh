#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="${repo_root}/scripts/ci/validate-runtime-deployment.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly run_id=123456
readonly run_attempt=2
readonly commit=0123456789abcdef0123456789abcdef01234567
readonly digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

write_valid_metadata() {
  jq -n \
    --arg commit "${commit}" \
    --arg digest "${digest}" \
    --arg runAttempt "${run_attempt}" \
    --arg runId "${run_id}" '
      {
        schemaVersion: 1,
        commit: $commit,
        runId: $runId,
        runAttempt: $runAttempt,
        imageRef: ("registry.fly.io/momo-result:" + $commit + "-" + $runId + "-" + $runAttempt),
        imageId: ("sha256:" + $digest),
        registryDigest: ("sha256:" + $digest),
        registryRef: ("registry.fly.io/momo-result@sha256:" + $digest),
        configSha256: $digest,
        sourceArtifactName: ("runtime-image-" + $runId + "-" + $runAttempt),
        sourceArtifactId: "111",
        sourceArtifactDigest: ("sha256:" + $digest),
        manifestArtifactName: ("runtime-image-registry-manifest-" + $runId + "-" + $runAttempt),
        manifestArtifactId: "222",
        manifestArtifactDigest: ("sha256:" + $digest),
        manifestSha256: $digest
      }
    ' > "${test_dir}/deployment.json"
}

expect_rejected() {
  local name="$1"
  if "${validator}" "${test_dir}/deployment.json" "${run_id}" "${run_attempt}" "${commit}" \
    > /dev/null 2>&1; then
    echo "Invalid runtime deployment was accepted: ${name}" >&2
    exit 1
  fi
}

write_valid_metadata
actual="$("${validator}" "${test_dir}/deployment.json" "${run_id}" "${run_attempt}" "${commit}")"
grep -qx "candidate_sha=${commit}" <<< "${actual}"
grep -qx "registry_ref=registry.fly.io/momo-result@sha256:${digest}" <<< "${actual}"

jq '.registryRef = "registry.fly.io/momo-result@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' \
  "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected mismatched-registry-digest

write_valid_metadata
jq '.unexpected = true' "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected unknown-field

write_valid_metadata
if "${validator}" "${test_dir}/deployment.json" 999 "${run_attempt}" "${commit}" \
  > /dev/null 2>&1; then
  echo "Deployment metadata from a different run was accepted." >&2
  exit 1
fi

echo "Runtime deployment provenance tests passed."
