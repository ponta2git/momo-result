#!/usr/bin/env bash
set -euo pipefail
# Verifies the System E2E test artifacts against their producer runs and the
# already loaded Runtime candidate, loads the controlled Worker, and prints the
# runner inputs as KEY=VALUE lines. Nothing is rebuilt as a fallback.

worker_dir="${CONTROLLED_WORKER_DIR:?CONTROLLED_WORKER_DIR is required.}"
fixture_dir="${SESSION_FIXTURE_DIR:?SESSION_FIXTURE_DIR is required.}"
runtime_image="${RUNTIME_IMAGE:?RUNTIME_IMAGE is required.}"
run_id="${GITHUB_RUN_ID:?GITHUB_RUN_ID is required.}"
commit="${GITHUB_SHA:?GITHUB_SHA is required.}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

runtime_id="$(docker image inspect "${runtime_image}" --format '{{.Id}}')"
"${script_dir}/ci-tool.sh" e2e-candidate session-fixture "${fixture_dir}" "${run_id}" \
  "${SESSION_FIXTURE_RUN_ATTEMPT:?SESSION_FIXTURE_RUN_ATTEMPT is required.}" "${commit}" \
  "${SESSION_FIXTURE_ARTIFACT_ID:?SESSION_FIXTURE_ARTIFACT_ID is required.}" \
  "${SESSION_FIXTURE_ARTIFACT_DIGEST:?SESSION_FIXTURE_ARTIFACT_DIGEST is required.}" "${runtime_id}"

worker="$("${script_dir}/ci-tool.sh" e2e-candidate controlled-worker "${worker_dir}" "${run_id}" \
  "${CONTROLLED_WORKER_RUN_ATTEMPT:?CONTROLLED_WORKER_RUN_ATTEMPT is required.}" "${commit}" \
  "${CONTROLLED_WORKER_ARTIFACT_ID:?CONTROLLED_WORKER_ARTIFACT_ID is required.}" \
  "${CONTROLLED_WORKER_ARTIFACT_DIGEST:?CONTROLLED_WORKER_ARTIFACT_DIGEST is required.}")"
image_ref="$(sed -n 's/^image_ref=//p' <<< "${worker}")"
expected_id="$(sed -n 's/^image_id=//p' <<< "${worker}")"
# pipefail rejects gzip checksum/truncation errors from this single pass.
gzip -dc "${worker_dir}/controlled-worker-image.tar.gz" | docker load > /dev/null
"${script_dir}/ci-tool.sh" image-id-match "${expected_id}" \
  "$(docker image inspect "${image_ref}" --format '{{.Id}}')"

printf 'MOMO_E2E_CONTROLLED_WORKER_IMAGE=%s\n' "${expected_id}"
printf 'MOMO_E2E_SESSION_FIXTURE_DIR=%s\n' "$(cd "${fixture_dir}" && pwd)"
