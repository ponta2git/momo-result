#!/usr/bin/env bash
set -euo pipefail

: "${ANALYSIS_APP:=momo-result-analysis}"
: "${ANALYSIS_IMAGE_REF:?required}"
: "${ANALYSIS_RELEASE_SHA:?required}"
: "${GITHUB_RUN_ID:?required}"
: "${GITHUB_RUN_ATTEMPT:?required}"
: "${RUNNER_TEMP:?required}"
[[ "${ANALYSIS_RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || exit 2
ANALYSIS_WORKER_ID="worker-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
OCR_WORKER_ID="ocr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
mkdir -p analysis-production-artifact

flyctl config validate --strict --config fly.analysis.toml
secret_state="$(flyctl secrets list --app "${ANALYSIS_APP}" --json)"
scripts/ci/ci-tool.sh analysis-secrets ready <<< "${secret_state}"
flyctl auth docker
docker push "${ANALYSIS_IMAGE_REF}"
ANALYSIS_IMAGE_REF="$(scripts/ci/resolve-pushed-runtime-image.sh "${ANALYSIS_IMAGE_REF}")"
docker manifest inspect "${ANALYSIS_IMAGE_REF}" > analysis-production-artifact/registry-manifest.json
# A matching image alone does not prove matching configuration. Reuse only a
# started, enabled immutable deployment with no relevant source/config changes
# and no staged secrets waiting for activation.
current_state="$(flyctl machine list --app "${ANALYSIS_APP}" --json)"
previous_sha="$(scripts/ci/ci-tool.sh analysis-reusable-release "${ANALYSIS_IMAGE_REF}" <<< "${current_state}")"
if [[ -n "${previous_sha}" ]] &&
  git merge-base --is-ancestor "${previous_sha}" "${ANALYSIS_RELEASE_SHA}" &&
  scripts/ci/ci-tool.sh analysis-secrets unstaged <<< "${secret_state}"; then
  scope="$(scripts/ci/classify-git-range.sh "${previous_sha}" "${ANALYSIS_RELEASE_SHA}")"
  if [[ "$(sed -n 's/^analysis_image=//p' <<< "${scope}")" == false ]]; then
    printf '%s\n' '{"schemaVersion":1,"status":"not_needed","reason":"verified_worker_unchanged"}' \
      > analysis-production-artifact/worker-deployment.json
    echo "Verified worker image and configuration are unchanged."
    exit 0
  fi
fi
flyctl deploy --app "${ANALYSIS_APP}" --config fly.analysis.toml --image "${ANALYSIS_IMAGE_REF}" \
  --env MOMO_ANALYSIS_PUBLICATION_MODE=enabled \
  --env MOMO_ANALYSIS_CONFIG_VERSION="series-analysis-v1-${ANALYSIS_RELEASE_SHA}" \
  --env MOMO_ANALYSIS_WORKER_ID="${ANALYSIS_WORKER_ID}" \
  --env MOMO_OCR_V2_CONSUMER_MODE=enabled \
  --env MOMO_OCR_V2_WORKER_ID="${OCR_WORKER_ID}" --ha=false --yes

scripts/ci/start-deployed-machine.sh analysis "${ANALYSIS_APP}" \
  "${ANALYSIS_IMAGE_REF}" "${ANALYSIS_RELEASE_SHA}" "${ANALYSIS_WORKER_ID}" "${OCR_WORKER_ID}"

deployment_state="${RUNNER_TEMP}/analysis-machine-state.json"
readiness_log="${RUNNER_TEMP}/analysis-worker-readiness.json"
readiness_evidence="analysis-production-artifact/worker-readiness.json"

verify_machine_state() {
  local machine_state identity
  machine_state="$(flyctl machine list --app "${ANALYSIS_APP}" --json)"
  scripts/ci/ci-tool.sh analysis-machine-evidence \
    "${ANALYSIS_IMAGE_REF}" "${ANALYSIS_RELEASE_SHA}" "${ANALYSIS_WORKER_ID}" "${OCR_WORKER_ID}" \
    <<< "${machine_state}" > "${deployment_state}"
  identity="$(scripts/ci/ci-tool.sh analysis-machine-identity <<< "${machine_state}")"
  IFS=$'\t' read -r machine_id _ <<< "${identity}"
}

verify_machine_state
deadline=$((SECONDS + 120))
until flyctl logs \
    --app "${ANALYSIS_APP}" \
    --machine "${machine_id}" \
    --no-tail \
    --json > "${readiness_log}" 2> /dev/null &&
  scripts/ci/ci-tool.sh worker-readiness \
    "${readiness_log}" \
    "${machine_id}" \
    "${ANALYSIS_WORKER_ID}" \
    "${OCR_WORKER_ID}" > "${readiness_evidence}"; do
  if (( SECONDS >= deadline )); then
    echo "Combined analysis worker did not establish fresh dependency connections." >&2
    exit 1
  fi
  sleep 5
done

sleep 10
verify_machine_state
mv "${deployment_state}" \
  analysis-production-artifact/enabled-deployment-state.json
