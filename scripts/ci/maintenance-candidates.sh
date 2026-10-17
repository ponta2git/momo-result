#!/usr/bin/env bash
# Selection follows shared receipt binding; this never grants mutation permission.
set -euo pipefail
[[ "$#" == 1 ]] || exit 2
receipt="$1"
run_id="$(jq -er '.producer.runId' "${receipt}")"
attempt="$(jq -er '.producer.runAttempt' "${receipt}")"
sha="$(jq -er '.candidates.result' "${receipt}")"
runtime_id='' runtime_digest='' worker_id='' worker_digest=''
runtime_name="runtime-image-${run_id}-${attempt}"
worker_name="analysis-candidate-metadata-${run_id}-${attempt}"
artifacts="$(jq -er '.producer.artifacts[] | [.id,.digest] | @tsv' "${receipt}")"
while IFS=$'\t' read -r artifact_id artifact_digest; do
  [[ "${artifact_id}" =~ ^[1-9][0-9]{0,19}$ && "${artifact_digest}" =~ ^[a-f0-9]{64}$ ]] || exit 1
  name="$(gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}" --jq '.name')"
  case "${name}" in
    "${runtime_name}")
      [[ -z "${runtime_id}" ]] || exit 1
      runtime_id="${artifact_id}" runtime_digest="sha256:${artifact_digest}"
      ;;
    "${worker_name}")
      [[ -z "${worker_id}" ]] || exit 1
      worker_id="${artifact_id}" worker_digest="sha256:${artifact_digest}"
      ;;
    "analysis-worker-image-${run_id}-${attempt}") ;;
    *) echo 'Unexpected maintenance producer artifact.' >&2; exit 1 ;;
  esac
done <<< "${artifacts}"
image_ref="registry.fly.io/momo-result:${sha}-${run_id}-${attempt}"
scripts/ci/ci-tool.sh runtime-release-selection "${run_id}" "${sha}" "${attempt}" \
  "${runtime_name}" "${runtime_id}" "${runtime_digest}" "${image_ref}" > /dev/null
scripts/ci/ci-tool.sh analysis-release-selection "${run_id}" "${attempt}" \
  "${worker_name}" "${worker_id}" "${worker_digest}"
printf 'producer_run_id=%s\nproducer_run_attempt=%s\n' "${run_id}" "${attempt}"
printf 'runtime_artifact_id=%s\nruntime_artifact_digest=%s\nruntime_artifact_name=%s\nruntime_image_ref=%s\n' \
  "${runtime_id}" "${runtime_digest}" "${runtime_name}" "${image_ref}"
printf 'worker_metadata_id=%s\nworker_metadata_digest=%s\nworker_metadata_name=%s\n' \
  "${worker_id}" "${worker_digest}" "${worker_name}"
