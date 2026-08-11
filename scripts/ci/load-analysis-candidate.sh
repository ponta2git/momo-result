#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "Usage: $0 <artifact-directory> <expected-image-ref> <expected-tar-sha256>" >&2
  exit 2
fi

artifact_dir="$1"
expected_image_ref="$2"
expected_tar_sha="$3"
image_archive="${artifact_dir}/analysis-worker-image.tar.gz"
image_id_file="${artifact_dir}/image-id.txt"
image_ref_file="${artifact_dir}/image-ref.txt"
tar_sha_file="${artifact_dir}/image-tar.sha256"

[[ "${expected_image_ref}" =~ ^registry\.fly\.io/momo-result-analysis:[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$ ]] || {
  echo "Invalid expected analysis image reference." >&2
  exit 1
}
[[ "${expected_tar_sha}" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Invalid expected analysis image archive digest." >&2
  exit 1
}

for file in "${image_archive}" "${image_id_file}" "${image_ref_file}" "${tar_sha_file}"; do
  [[ -f "${file}" && ! -L "${file}" ]] || {
    echo "Missing or unsafe candidate artifact file: ${file}" >&2
    exit 1
  }
done

recorded_ref="$(sed -n '1p' "${image_ref_file}")"
recorded_id="$(sed -n '1p' "${image_id_file}")"
recorded_tar_sha="$(cut -d ' ' -f 1 "${tar_sha_file}")"
actual_tar_sha="$(sha256sum "${image_archive}" | cut -d ' ' -f 1)"

[[ "${recorded_ref}" == "${expected_image_ref}" ]] || {
  echo "The packaged image reference does not match the selected candidate." >&2
  exit 1
}
[[ "${recorded_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "The packaged image ID is invalid." >&2
  exit 1
}
[[ "${recorded_tar_sha}" == "${expected_tar_sha}" ]] || {
  echo "The packaged archive digest does not match candidate provenance." >&2
  exit 1
}
[[ "${actual_tar_sha}" == "${expected_tar_sha}" ]] || {
  echo "The downloaded image archive digest does not match candidate provenance." >&2
  exit 1
}

gzip -t "${image_archive}"
gzip -dc "${image_archive}" | docker load
actual_id="$(docker image inspect "${expected_image_ref}" --format '{{.Id}}')"
[[ "${actual_id}" == "${recorded_id}" ]] || {
  echo "The loaded image ID does not match the verified candidate image ID." >&2
  exit 1
}
