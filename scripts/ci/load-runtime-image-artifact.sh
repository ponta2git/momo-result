#!/usr/bin/env bash
set -euo pipefail

image_artifact_dir="${IMAGE_ARTIFACT_NAME:?IMAGE_ARTIFACT_NAME is required.}"
image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${script_dir}/validate-runtime-candidate.sh" \
  "${image_artifact_dir}" "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required.}" \
  "${RUNTIME_CANDIDATE_RUN_ATTEMPT:?RUNTIME_CANDIDATE_RUN_ATTEMPT is required.}" \
  "${GITHUB_SHA:?GITHUB_SHA is required.}" "${image_ref}"

# pipefail also rejects gzip checksum/truncation errors from this single pass.
gzip -dc "${image_artifact_dir}/momo-result-image.tar.gz" | docker load

expected_id="$(< "${image_artifact_dir}/image-id.txt")"
loaded_id="$(docker image inspect "${image_ref}" --format '{{.Id}}')"
"${script_dir}/ci-tool.sh" image-id-match "${expected_id}" "${loaded_id}"
