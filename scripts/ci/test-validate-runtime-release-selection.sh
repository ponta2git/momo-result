#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="${repo_root}/scripts/ci/validate-runtime-release-selection.sh"

readonly run_id=123456
readonly commit=0123456789abcdef0123456789abcdef01234567
readonly source_run_attempt=2
readonly consumer_run_attempt=3
readonly artifact_name="runtime-image-${run_id}-${source_run_attempt}"
readonly artifact_id=789012
readonly artifact_digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly image_ref="registry.fly.io/momo-result:${commit}-${run_id}-${source_run_attempt}"

actual="$(
  GITHUB_RUN_ATTEMPT="${consumer_run_attempt}" \
    "${validator}" "${run_id}" "${commit}" "${source_run_attempt}" \
      "${artifact_name}" "${artifact_id}" "${artifact_digest}" "${image_ref}"
)"
grep -qx "artifact_id=${artifact_id}" <<< "${actual}"
grep -qx "artifact_name=${artifact_name}" <<< "${actual}"
grep -qx "candidate_run_attempt=${source_run_attempt}" <<< "${actual}"
grep -qx "image_ref=${image_ref}" <<< "${actual}"

if "${validator}" "${run_id}" "${commit}" "${consumer_run_attempt}" \
  "${artifact_name}" "${artifact_id}" "${artifact_digest}" "${image_ref}" \
  > /dev/null 2>&1; then
  echo "A consumer attempt was accepted as the producer candidate identity." >&2
  exit 1
fi

if "${validator}" "${run_id}" "${commit}" "${source_run_attempt}" \
  "${artifact_name}" "${artifact_id}" "invalid" "${image_ref}" \
  > /dev/null 2>&1; then
  echo "An invalid artifact digest was accepted." >&2
  exit 1
fi

echo "Runtime release candidate selection tests passed."
