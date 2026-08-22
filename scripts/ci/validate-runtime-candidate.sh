#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: $0 <artifact-directory> <run-id> <run-attempt> <commit> <image-ref>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
http4s_patch_file="${artifact_dir}/http4s-patch.json"

[[ "${expected_run_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_run_attempt}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_commit}" =~ ^[0-9a-f]{40}$ ]] || exit 1
expected_ref="registry.fly.io/momo-result:${expected_commit}-${expected_run_id}-${expected_run_attempt}"
[[ "${expected_image_ref}" == "${expected_ref}" ]] || {
  echo "Runtime image reference does not match the selected workflow run." >&2
  exit 1
}

for file in \
  "${candidate_file}" "${image_archive}" "${image_id_file}" "${image_ref_file}" \
  "${tar_sha_file}" "${http4s_patch_file}"; do
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

expected_http4s_ref="$(tr -d '[:space:]' < "${repo_root}/.http4s-ref")"
[[ "${expected_http4s_ref}" =~ ^[0-9a-f]{40}$ ]] || exit 1

jq -e \
  --arg expectedRepository "https://github.com/ponta2git/http4s.git" \
  --arg expectedRef "${expected_http4s_ref}" '
    type == "object" and
    keys == ["repository", "scalaVersion", "sourceSha", "version"] and
    .repository == $expectedRepository and
    .scalaVersion == "3.3.6" and
    .sourceSha == $expectedRef and
    (.version | type == "string" and test("^[0-9A-Za-z][0-9A-Za-z.+-]*$"))
  ' "${http4s_patch_file}" > /dev/null || {
    echo "Runtime image does not contain the expected http4s patch provenance." >&2
    exit 1
  }

jq -e \
  --arg commit "${expected_commit}" \
  --arg imageId "${recorded_id}" \
  --arg imageRef "${expected_ref}" \
  --arg runAttempt "${expected_run_attempt}" \
  --arg runId "${expected_run_id}" \
  --arg tarSha256 "${actual_tar_sha}" \
  --arg http4sRepository "$(jq -r '.repository' "${http4s_patch_file}")" \
  --arg http4sScalaVersion "$(jq -r '.scalaVersion' "${http4s_patch_file}")" \
  --arg http4sSourceSha "$(jq -r '.sourceSha' "${http4s_patch_file}")" \
  --arg http4sVersion "$(jq -r '.version' "${http4s_patch_file}")" '
    type == "object" and
    keys == [
      "commit",
      "configSha256",
      "http4sPatchRepository",
      "http4sPatchScalaVersion",
      "http4sPatchSourceSha",
      "http4sPatchVersion",
      "imageId",
      "imageRef",
      "runAttempt",
      "runId",
      "schemaVersion",
      "tarSha256"
    ] and
    .schemaVersion == 2 and
    .commit == $commit and
    .runId == $runId and
    .runAttempt == $runAttempt and
    .imageRef == $imageRef and
    .imageId == $imageId and
    .tarSha256 == $tarSha256 and
    .http4sPatchRepository == $http4sRepository and
    .http4sPatchScalaVersion == $http4sScalaVersion and
    .http4sPatchSourceSha == $http4sSourceSha and
    .http4sPatchVersion == $http4sVersion and
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
