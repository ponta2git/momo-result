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
    --arg commit "${commit}" \
    --arg configSha256 "${config_sha}" \
    --arg imageId "${image_id}" \
    --arg imageRef "${image_ref}" \
    --arg runAttempt "${run_attempt}" \
    --arg runId "${run_id}" \
    --arg tarSha256 "${tar_sha}" '
      {
        schemaVersion: 1,
        commit: $commit,
        runId: $runId,
        runAttempt: $runAttempt,
        imageRef: $imageRef,
        imageId: $imageId,
        tarSha256: $tarSha256,
        configSha256: $configSha256
      }
    ' > "${artifact_dir}/candidate.json"
}

run_loader() {
  (
    cd "${repo_root}"
    PATH="${fake_bin}:${PATH}" FAKE_IMAGE_ID="${image_id}" \
      IMAGE_ARTIFACT_NAME="${artifact_dir}" IMAGE_REF="${image_ref}" \
      GITHUB_RUN_ID="${run_id}" GITHUB_RUN_ATTEMPT="${current_run_attempt}" \
      GITHUB_SHA="${commit}" RUNTIME_CANDIDATE_RUN_ATTEMPT="${run_attempt}" \
      "${loader}"
  )
}

write_valid_artifact
run_loader

printf '%s\n' tampered >> "${artifact_dir}/momo-result-image.tar.gz"
if run_loader > /dev/null 2>&1; then
  echo "A tampered runtime image archive was accepted." >&2
  exit 1
fi

echo "Runtime candidate image loading tests passed."
