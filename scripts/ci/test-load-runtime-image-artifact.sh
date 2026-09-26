#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
loader="${repo_root}/scripts/ci/load-runtime-image-artifact.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly run_id=123456
readonly run_attempt=2
readonly current_run_attempt=3
readonly commit=0123456789abcdef0123456789abcdef01234567
readonly image_ref="registry.fly.io/momo-result:${commit}-${run_id}-${run_attempt}"
readonly image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly http4s_ref="$(tr -d '[:space:]' < "${repo_root}/.http4s-ref")"
readonly http4s_version=0.23.36-5-23a6bcd-SNAPSHOT
readonly http4s_scala_version=3.3.6
artifact_dir="${test_dir}/runtime-image-${run_id}-${run_attempt}"
fake_bin="${test_dir}/bin"
mkdir -p "${artifact_dir}" "${fake_bin}"

printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "$1" == "load" ]]; then' \
  '  grep -qx "verified runtime bytes"' \
  'elif [[ "$1" == "image" && "$2" == "inspect" ]]; then' \
  '  printf '\''%s\n'\'' "${FAKE_IMAGE_ID}"' \
  'else' \
  '  exit 1' \
  'fi' > "${fake_bin}/docker"
chmod +x "${fake_bin}/docker"

write_valid_artifact() {
  printf '%s\n' 'verified runtime bytes' | gzip -1 \
    > "${artifact_dir}/momo-result-image.tar.gz"
  tar_sha="$(sha256sum "${artifact_dir}/momo-result-image.tar.gz" | cut -d ' ' -f 1)"
  config_sha="$(sha256sum "${repo_root}/fly.toml" | cut -d ' ' -f 1)"
  printf '%s\n' "${image_id}" > "${artifact_dir}/image-id.txt"
  printf '%s\n' "${image_ref}" > "${artifact_dir}/image-ref.txt"
  printf '%s  %s\n' "${tar_sha}" momo-result-image.tar.gz \
    > "${artifact_dir}/image-tar.sha256"
  jq -n \
    '{repository: "https://github.com/ponta2git/http4s.git",
      scalaVersion: $scalaVersion, sourceSha: $ref, version: $version}' \
    --arg ref "${http4s_ref}" --arg scalaVersion "${http4s_scala_version}" \
    --arg version "${http4s_version}" \
    > "${artifact_dir}/http4s-patch.json"
  jq -n \
    --arg commit "${commit}" \
    --arg configSha256 "${config_sha}" \
    --arg imageId "${image_id}" \
    --arg imageRef "${image_ref}" \
    --arg runAttempt "${run_attempt}" \
    --arg runId "${run_id}" \
    --arg tarSha256 "${tar_sha}" '
      {
        schemaVersion: 2,
        commit: $commit,
        runId: $runId,
        runAttempt: $runAttempt,
        imageRef: $imageRef,
        imageId: $imageId,
        tarSha256: $tarSha256,
        configSha256: $configSha256,
        http4sPatchRepository: "https://github.com/ponta2git/http4s.git",
        http4sPatchScalaVersion: $http4sScalaVersion,
        http4sPatchSourceSha: $http4sRef,
        http4sPatchVersion: $http4sVersion
      }
    ' --arg http4sRef "${http4s_ref}" \
    --arg http4sScalaVersion "${http4s_scala_version}" \
    --arg http4sVersion "${http4s_version}" \
    > "${artifact_dir}/candidate.json"
}

run_loader() {
  (
    cd "${test_dir}"
    PATH="${fake_bin}:${PATH}" FAKE_IMAGE_ID="${1:-${image_id}}" \
      IMAGE_ARTIFACT_NAME="${artifact_dir}" IMAGE_REF="${image_ref}" \
      GITHUB_RUN_ID="${run_id}" GITHUB_RUN_ATTEMPT="${current_run_attempt}" \
      GITHUB_SHA="${commit}" RUNTIME_CANDIDATE_RUN_ATTEMPT="${run_attempt}" \
      "${loader}"
  )
}

expect_rejected() {
  local name="$1"
  shift
  if run_loader "$@" > /dev/null 2>&1; then
    echo "Invalid runtime image artifact was accepted: ${name}" >&2
    exit 1
  fi
}

write_valid_artifact
run_loader
expect_rejected mismatched-image-id sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

printf '%s\n' tampered >> "${artifact_dir}/momo-result-image.tar.gz"
expect_rejected tampered-archive

# The digest can match an incomplete producer archive; decompression must still fail.
write_valid_artifact
archive="${artifact_dir}/momo-result-image.tar.gz"
archive_size="$(wc -c < "${archive}")"
dd if="${archive}" of="${archive}.truncated" bs=1 count="$((archive_size - 8))" 2> /dev/null
mv "${archive}.truncated" "${archive}"
tar_sha="$(sha256sum "${archive}" | cut -d ' ' -f 1)"
printf '%s  %s\n' "${tar_sha}" momo-result-image.tar.gz > "${artifact_dir}/image-tar.sha256"
jq --arg tarSha256 "${tar_sha}" '.tarSha256 = $tarSha256' \
  "${artifact_dir}/candidate.json" > "${artifact_dir}/tampered-candidate.json"
mv "${artifact_dir}/tampered-candidate.json" "${artifact_dir}/candidate.json"
expect_rejected truncated-gzip

write_valid_artifact
jq '.sourceSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' \
  "${artifact_dir}/http4s-patch.json" > "${artifact_dir}/tampered-patch.json"
mv "${artifact_dir}/tampered-patch.json" "${artifact_dir}/http4s-patch.json"
expect_rejected tampered-http4s-patch

write_valid_artifact
jq '.configSha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' \
  "${artifact_dir}/candidate.json" > "${artifact_dir}/tampered-candidate.json"
mv "${artifact_dir}/tampered-candidate.json" "${artifact_dir}/candidate.json"
expect_rejected mismatched-deploy-config

echo "Runtime candidate image loading tests passed."
