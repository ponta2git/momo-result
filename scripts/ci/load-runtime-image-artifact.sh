#!/usr/bin/env bash
set -euo pipefail

image_artifact_dir="${IMAGE_ARTIFACT_NAME:?IMAGE_ARTIFACT_NAME is required.}"
image_ref="${IMAGE_REF:?IMAGE_REF is required.}"

expected_ref="$(cat "${image_artifact_dir}/image-ref.txt")"
if [[ "${expected_ref}" != "${image_ref}" ]]; then
  echo "Expected image ref ${expected_ref}, got ${image_ref}." >&2
  exit 1
fi

gunzip -c "${image_artifact_dir}/momo-result-image.tar.gz" | docker load

expected_id="$(cat "${image_artifact_dir}/image-id.txt")"
loaded_id="$(docker image inspect "${image_ref}" --format '{{.Id}}')"
if [[ "${loaded_id}" != "${expected_id}" ]]; then
  echo "Loaded image id ${loaded_id} does not match packaged image id ${expected_id}." >&2
  exit 1
fi
