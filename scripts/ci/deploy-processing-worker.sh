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
if ! jq -e 'any(.[]; .name == "MOMO_ANALYSIS_OUTBOX_LISTENER_DATABASE_URL" and
    (.status == "Deployed" or .status == "Staged"))' <<< "${secret_state}" > /dev/null; then
  echo "Required worker connection configuration is not ready." >&2
  exit 1
fi
flyctl auth docker
docker push "${ANALYSIS_IMAGE_REF}"
ANALYSIS_IMAGE_REF="$(scripts/ci/resolve-pushed-runtime-image.sh "${ANALYSIS_IMAGE_REF}")"
docker manifest inspect "${ANALYSIS_IMAGE_REF}" > analysis-production-artifact/registry-manifest.json
# A matching image alone does not prove matching configuration. Reuse only a
# started, enabled immutable deployment with no relevant source/config changes
# and no staged secrets waiting for activation.
current_state="$(flyctl machine list --app "${ANALYSIS_APP}" --json)"
previous_sha="$(jq -r --arg image "${ANALYSIS_IMAGE_REF}" '
  if length == 1 and all(.[]; .state == "started" and .config.image == $image and
    .config.env.MOMO_ANALYSIS_PUBLICATION_MODE == "enabled" and
    .config.env.MOMO_OCR_V2_CONSUMER_MODE == "enabled" and
    .config.guest.cpu_kind == "shared" and .config.guest.cpus == 1 and
    .config.guest.memory_mb == 256) then
    .[0].config.env.MOMO_ANALYSIS_CONFIG_VERSION | ltrimstr("series-analysis-v1-")
  else "" end' <<< "${current_state}")"
if [[ "${previous_sha}" =~ ^[0-9a-f]{40}$ ]] &&
  git merge-base --is-ancestor "${previous_sha}" "${ANALYSIS_RELEASE_SHA}" &&
  ! jq -e 'any(.[]; .status == "Staged")' <<< "${secret_state}" > /dev/null; then
  scope="$(scripts/ci/classify-git-range.sh "${previous_sha}" "${ANALYSIS_RELEASE_SHA}")"
  if [[ "$(sed -n 's/^analysis_image=//p' <<< "${scope}")" == false ]]; then
    jq -n '{schemaVersion:1,status:"not_needed",reason:"verified_worker_unchanged"}' \
      > analysis-production-artifact/worker-deployment.json
    echo "Verified worker image and configuration are unchanged."
    exit 0
  fi
fi
flyctl deploy --config fly.analysis.toml --image "${ANALYSIS_IMAGE_REF}" \
  --env MOMO_ANALYSIS_PUBLICATION_MODE=enabled \
  --env MOMO_ANALYSIS_CONFIG_VERSION="series-analysis-v1-${ANALYSIS_RELEASE_SHA}" \
  --env MOMO_ANALYSIS_WORKER_ID="${ANALYSIS_WORKER_ID}" \
  --env MOMO_OCR_V2_CONSUMER_MODE=enabled \
  --env MOMO_OCR_V2_WORKER_ID="${OCR_WORKER_ID}" --ha=false --yes

deployment_state="${RUNNER_TEMP}/analysis-machine-state.json"
readiness_log="${RUNNER_TEMP}/analysis-worker-readiness.json"
readiness_evidence="analysis-production-artifact/worker-readiness.json"

verify_machine_state() {
  flyctl machine list --app "${ANALYSIS_APP}" --json |
    jq -e \
      --arg image "${ANALYSIS_IMAGE_REF}" \
      --arg analysisWorkerId "${ANALYSIS_WORKER_ID}" \
      --arg ocrWorkerId "${OCR_WORKER_ID}" \
      --arg configVersion "series-analysis-v1-${ANALYSIS_RELEASE_SHA}" '
        select(
          length == 1 and
          all(.[];
            .state == "started" and
            .config.image == $image and
            .config.env.MOMO_ANALYSIS_PUBLICATION_MODE == "enabled" and
            .config.env.MOMO_OCR_V2_CONSUMER_MODE == "enabled" and
            .config.env.MOMO_ANALYSIS_WORKER_ID == $analysisWorkerId and
            .config.env.MOMO_OCR_V2_WORKER_ID == $ocrWorkerId and
            .config.env.MOMO_ANALYSIS_CONFIG_VERSION == $configVersion and
            .config.guest.cpu_kind == "shared" and
            .config.guest.cpus == 1 and
            .config.guest.memory_mb == 256
          )
        ) |
        {
          schemaVersion: 1,
          machineId: .[0].id,
          state: .[0].state,
          image: .[0].config.image,
          analysisWorkerId: .[0].config.env.MOMO_ANALYSIS_WORKER_ID,
          ocrWorkerId: .[0].config.env.MOMO_OCR_V2_WORKER_ID
        }
      ' > "${deployment_state}"
}

verify_machine_state
machine_id="$(jq -er '.machineId' "${deployment_state}")"
deadline=$((SECONDS + 120))
until flyctl logs \
    --app "${ANALYSIS_APP}" \
    --machine "${machine_id}" \
    --no-tail \
    --json > "${readiness_log}" 2> /dev/null &&
  scripts/ci/validate-analysis-worker-readiness.sh \
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
