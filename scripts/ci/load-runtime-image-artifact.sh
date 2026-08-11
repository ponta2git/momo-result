#!/usr/bin/env bash
set -euo pipefail

image_artifact_dir="${IMAGE_ARTIFACT_NAME:?IMAGE_ARTIFACT_NAME is required.}"
image_ref="${IMAGE_REF:?IMAGE_REF is required.}"

scripts/ci/validate-runtime-candidate.sh \
  "${image_artifact_dir}" "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required.}" \
  "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required.}" \
  "${GITHUB_SHA:?GITHUB_SHA is required.}" "${image_ref}"

gzip -t "${image_artifact_dir}/momo-result-image.tar.gz"
gzip -dc "${image_artifact_dir}/momo-result-image.tar.gz" | docker load

expected_id="$(cat "${image_artifact_dir}/image-id.txt")"
loaded_id="$(docker image inspect "${image_ref}" --format '{{.Id}}')"
if [[ "${loaded_id}" != "${expected_id}" ]]; then
  echo "Loaded image id ${loaded_id} does not match packaged image id ${expected_id}." >&2
  exit 1
fi
