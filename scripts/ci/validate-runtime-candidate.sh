#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: $0 <artifact-directory> <run-id> <run-attempt> <commit> <image-ref>" >&2
  exit 2
fi

artifact_dir="$1"
expected_run_id="$2"
expected_run_attempt="$3"
expected_commit="$4"
expected_image_ref="$5"
candidate_file="${artifact_dir}/candidate.json"
image_archive="${artifact_dir}/momo-result-image.tar.gz"
image_id_file="${artifact_dir}/image-id.txt"
image_ref_file="${artifact_dir}/image-ref.txt"
tar_sha_file="${artifact_dir}/image-tar.sha256"

[[ "${expected_run_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_run_attempt}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_commit}" =~ ^[0-9a-f]{40}$ ]] || exit 1
expected_ref="registry.fly.io/momo-result:${expected_commit}-${expected_run_id}-${expected_run_attempt}"
[[ "${expected_image_ref}" == "${expected_ref}" ]] || {
  echo "Runtime image reference does not match the selected workflow run." >&2
  exit 1
}

for file in \
  "${candidate_file}" "${image_archive}" "${image_id_file}" "${image_ref_file}" "${tar_sha_file}"; do
  [[ -f "${file}" && ! -L "${file}" ]] || {
    echo "Missing or unsafe runtime candidate file: ${file}" >&2
    exit 1
  }
done

recorded_ref="$(sed -n '1p' "${image_ref_file}")"
recorded_id="$(sed -n '1p' "${image_id_file}")"
recorded_tar_sha="$(cut -d ' ' -f 1 "${tar_sha_file}")"
actual_tar_sha="$(sha256sum "${image_archive}" | cut -d ' ' -f 1)"
[[ "${recorded_ref}" == "${expected_ref}" ]] || exit 1
[[ "${recorded_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "${recorded_tar_sha}" == "${actual_tar_sha}" ]] || {
  echo "Runtime image archive digest mismatch." >&2
  exit 1
}

jq -e \
  --arg commit "${expected_commit}" \
  --arg imageId "${recorded_id}" \
  --arg imageRef "${expected_ref}" \
  --arg runAttempt "${expected_run_attempt}" \
  --arg runId "${expected_run_id}" \
  --arg tarSha256 "${actual_tar_sha}" '
    type == "object" and
    keys == [
      "commit",
      "configSha256",
      "imageId",
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
    .imageId == $imageId and
    .tarSha256 == $tarSha256 and
    (.configSha256 | type == "string" and test("^[0-9a-f]{64}$"))
  ' "${candidate_file}" > /dev/null || {
    echo "Runtime candidate failed its immutable provenance contract." >&2
    exit 1
  }

actual_config_sha="$(sha256sum fly.toml | cut -d ' ' -f 1)"
expected_config_sha="$(jq -r '.configSha256' "${candidate_file}")"
[[ "${actual_config_sha}" == "${expected_config_sha}" ]] || {
  echo "fly.toml changed after runtime candidate validation." >&2
  exit 1
}
