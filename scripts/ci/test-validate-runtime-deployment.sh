#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
canonicalizer="${repo_root}/scripts/ci/canonicalize-artifact-digest.sh"
validator="${repo_root}/scripts/ci/validate-runtime-deployment.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly run_id=123456
readonly run_attempt=3
readonly source_run_attempt=2
readonly commit=0123456789abcdef0123456789abcdef01234567
readonly digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly artifact_digest="$("${canonicalizer}" "${digest}")"
# A rollback target records its own patch revision, not the current checkout revision.
readonly http4s_ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

write_valid_metadata_v2() {
  jq -n \
    --arg commit "${commit}" \
    --arg artifactDigest "${artifact_digest}" \
    --arg digest "${digest}" \
    --arg runAttempt "${run_attempt}" \
    --arg runId "${run_id}" \
    --arg sourceRunAttempt "${source_run_attempt}" '
      {
        schemaVersion: 2,
        commit: $commit,
        runId: $runId,
        runAttempt: $runAttempt,
        sourceRunAttempt: $sourceRunAttempt,
        imageRef: ("registry.fly.io/momo-result:" + $commit + "-" + $runId + "-" + $sourceRunAttempt),
        imageId: ("sha256:" + $digest),
        registryDigest: ("sha256:" + $digest),
        registryRef: ("registry.fly.io/momo-result@sha256:" + $digest),
        configSha256: $digest,
        sourceArtifactName: ("runtime-image-" + $runId + "-" + $sourceRunAttempt),
        sourceArtifactId: "111",
        sourceArtifactDigest: $artifactDigest,
        manifestArtifactName: ("runtime-image-registry-manifest-" + $runId + "-" + $runAttempt),
        manifestArtifactId: "222",
        manifestArtifactDigest: $artifactDigest,
        manifestSha256: $digest
      }
    ' > "${test_dir}/deployment.json"
}

write_valid_metadata_v1() {
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
        imageRef: ("registry.fly.io/momo-result:" + $commit + "-" + $runId + "-" + $runAttempt),
        imageId: ("sha256:" + $digest),
        registryDigest: ("sha256:" + $digest),
        registryRef: ("registry.fly.io/momo-result@sha256:" + $digest),
        configSha256: $digest,
        sourceArtifactName: ("runtime-image-" + $runId + "-" + $runAttempt),
        sourceArtifactId: "111",
        sourceArtifactDigest: $artifactDigest,
        manifestArtifactName: ("runtime-image-registry-manifest-" + $runId + "-" + $runAttempt),
        manifestArtifactId: "222",
        manifestArtifactDigest: $artifactDigest,
        manifestSha256: $digest
      }
    ' > "${test_dir}/deployment.json"
}

write_valid_metadata_v3() {
  write_valid_metadata_v2
  jq \
    --arg http4sRef "${http4s_ref}" \
    '.schemaVersion = 3 |
      .http4sPatchRepository = "https://github.com/ponta2git/http4s.git" |
      .http4sPatchScalaVersion = "3.3.6" |
      .http4sPatchSourceSha = $http4sRef |
      .http4sPatchVersion = "0.23.36-5-23a6bcd-SNAPSHOT"' \
    "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
  mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
}

expect_rejected() {
  local name="$1"
  if "${validator}" "${test_dir}/deployment.json" "${run_id}" "${run_attempt}" "${commit}" \
    > "${test_dir}/rejected-output" 2> /dev/null; then
    echo "Invalid runtime deployment was accepted: ${name}" >&2
    exit 1
  fi
  [[ ! -s "${test_dir}/rejected-output" ]]
}

write_valid_metadata_v2
actual="$("${validator}" "${test_dir}/deployment.json" "${run_id}" "${run_attempt}" "${commit}")"
expected="$(cat <<EOF
candidate_sha=${commit}
source_run_attempt=${source_run_attempt}
config_sha256=${digest}
image_ref=registry.fly.io/momo-result:${commit}-${run_id}-${source_run_attempt}
manifest_artifact_digest=${artifact_digest}
manifest_artifact_id=222
manifest_artifact_name=runtime-image-registry-manifest-${run_id}-${run_attempt}
manifest_sha256=${digest}
registry_digest=sha256:${digest}
registry_ref=registry.fly.io/momo-result@sha256:${digest}
EOF
)"
[[ "${actual}" == "${expected}" ]]

write_valid_metadata_v3
actual="$("${validator}" "${test_dir}/deployment.json" "${run_id}" "${run_attempt}" "${commit}")"
[[ "${actual}" == "${expected}" ]]

jq '{}, .' "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected multiple-json-documents

write_valid_metadata_v3
jq '.configSha256 += "\n"' "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected multiline-config-digest

write_valid_metadata_v3
jq '.http4sPatchSourceSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' \
  "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected invalid-http4s-patch-ref

write_valid_metadata_v3
jq '.registryRef = "registry.fly.io/momo-result@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' \
  "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected mismatched-registry-digest

write_valid_metadata_v2
jq '.unexpected = true' "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected unknown-field

write_valid_metadata_v2
deployment_image_ref="registry.fly.io/momo-result:${commit}-${run_id}-${run_attempt}"
jq --arg imageRef "${deployment_image_ref}" '.sourceRunAttempt = .runAttempt | .imageRef = $imageRef' \
  "${test_dir}/deployment.json" > "${test_dir}/tampered.json"
mv "${test_dir}/tampered.json" "${test_dir}/deployment.json"
expect_rejected mismatched-source-attempt

write_valid_metadata_v2
if "${validator}" "${test_dir}/deployment.json" 999 "${run_attempt}" "${commit}" \
  > /dev/null 2>&1; then
  echo "Deployment metadata from a different run was accepted." >&2
  exit 1
fi

write_valid_metadata_v1
legacy_actual="$(
  "${validator}" "${test_dir}/deployment.json" "${run_id}" "${run_attempt}" "${commit}"
)"
grep -qx "source_run_attempt=${run_attempt}" <<< "${legacy_actual}"
grep -qx "image_ref=registry.fly.io/momo-result:${commit}-${run_id}-${run_attempt}" \
  <<< "${legacy_actual}"

echo "Runtime deployment provenance tests passed."
