#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 7 ]]; then
  echo "Usage: $0 <run-id> <commit> <candidate-run-attempt> <artifact-name> <artifact-id> <artifact-digest> <image-ref>" >&2
  exit 2
fi

run_id="$1"
commit="$2"
candidate_run_attempt="$3"
artifact_name="$4"
artifact_id="$5"
artifact_digest="$6"
image_ref="$7"

[[ "${run_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "${candidate_run_attempt}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${artifact_id}" =~ ^[1-9][0-9]*$ ]] || exit 1

expected_artifact_name="runtime-image-${run_id}-${candidate_run_attempt}"
expected_image_ref="registry.fly.io/momo-result:${commit}-${run_id}-${candidate_run_attempt}"
[[ "${artifact_name}" == "${expected_artifact_name}" ]] || {
  echo "Runtime artifact name does not match the producer candidate identity." >&2
  exit 1
}
[[ "${image_ref}" == "${expected_image_ref}" ]] || {
  echo "Runtime image reference does not match the producer candidate identity." >&2
  exit 1
}

canonical_digest="$(scripts/ci/canonicalize-artifact-digest.sh "${artifact_digest}")"
[[ "${canonical_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1

printf 'artifact_id=%s\n' "${artifact_id}"
printf 'artifact_name=%s\n' "${artifact_name}"
printf 'candidate_run_attempt=%s\n' "${candidate_run_attempt}"
printf 'image_ref=%s\n' "${image_ref}"
