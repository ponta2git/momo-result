#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
loader="${repo_root}/scripts/ci/load-e2e-artifacts.sh"
ci_tool="${repo_root}/scripts/ci/ci-tool.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly run_id=123456
readonly commit=0123456789abcdef0123456789abcdef01234567
readonly runtime_image="registry.fly.io/momo-result:${commit}-${run_id}-1"
readonly runtime_id=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
readonly worker_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
# Different producers may finish on different attempts; neither is the consumer's attempt.
readonly worker_attempt=2
readonly fixture_attempt=1
readonly worker_ref="momo-e2e-controlled-worker:${commit}-${run_id}-${worker_attempt}"
worker_dir="${test_dir}/worker"
fixture_dir="${test_dir}/fixture"
fake_bin="${test_dir}/bin"
mkdir -p "${fake_bin}"

printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "$1" == "load" ]]; then' \
  '  grep -qx "controlled worker bytes"' \
  '  touch "${FAKE_LOADED}"' \
  'elif [[ "$1 $2" == "image inspect" && "$3" == "${FAKE_RUNTIME_IMAGE}" ]]; then' \
  '  printf '\''%s\n'\'' "${FAKE_RUNTIME_ID}"' \
  'elif [[ "$1 $2" == "image inspect" && -e "${FAKE_LOADED}" ]]; then' \
  '  printf '\''%s\n'\'' "${FAKE_WORKER_ID}"' \
  'else' \
  '  echo "Unexpected fake docker invocation: $*" >&2' \
  '  exit 1' \
  'fi' > "${fake_bin}/docker"
chmod +x "${fake_bin}/docker"

sha() { sha256sum "$1" | cut -d ' ' -f 1; }

write_valid_artifacts() {
  rm -rf "${worker_dir}" "${fixture_dir}" "${test_dir}/loaded"
  mkdir -p "${worker_dir}" "${fixture_dir}"
  printf '%s\n' 'controlled worker bytes' | gzip -1 > "${worker_dir}/controlled-worker-image.tar.gz"
  printf '%s\n' "${worker_id}" > "${worker_dir}/image-id.txt"
  printf '%s\n' "${worker_ref}" > "${worker_dir}/image-ref.txt"
  printf '%s  %s\n' "$(sha "${worker_dir}/controlled-worker-image.tar.gz")" controlled-worker-image.tar.gz \
    > "${worker_dir}/image-tar.sha256"
  "${ci_tool}" create-e2e-candidate --kind controlled-worker --artifact-dir "${worker_dir}" \
    --run-id "${run_id}" --run-attempt "${worker_attempt}" --commit "${commit}" \
    > "${worker_dir}/candidate.json"
  printf '%s\n' 'fixture classes' > "${fixture_dir}/session-fixture.jar"
  printf '{"schemaVersion":1,"runtimeImageId":"%s","jarSha256":"%s"}\n' \
    "${runtime_id}" "$(sha "${fixture_dir}/session-fixture.jar")" > "${fixture_dir}/session-fixture.json"
  "${ci_tool}" create-e2e-candidate --kind session-fixture --artifact-dir "${fixture_dir}" \
    --run-id "${run_id}" --run-attempt "${fixture_attempt}" --commit "${commit}" \
    --runtime-image-id "${runtime_id}" > "${fixture_dir}/candidate.json"
}

run_loader() {
  PATH="${fake_bin}:${PATH}" FAKE_LOADED="${test_dir}/loaded" \
    FAKE_RUNTIME_IMAGE="${runtime_image}" FAKE_RUNTIME_ID="${RUNTIME_ID_OVERRIDE:-${runtime_id}}" \
    FAKE_WORKER_ID="${WORKER_ID_OVERRIDE:-${worker_id}}" \
    GITHUB_RUN_ID="${run_id}" GITHUB_SHA="${SHA_OVERRIDE:-${commit}}" \
    RUNTIME_IMAGE="${runtime_image}" \
    CONTROLLED_WORKER_DIR="${worker_dir}" CONTROLLED_WORKER_RUN_ATTEMPT="${WORKER_ATTEMPT_OVERRIDE:-${worker_attempt}}" \
    CONTROLLED_WORKER_ARTIFACT_ID=777 CONTROLLED_WORKER_ARTIFACT_DIGEST="sha256:$(printf 'e%.0s' {1..64})" \
    SESSION_FIXTURE_DIR="${fixture_dir}" SESSION_FIXTURE_RUN_ATTEMPT="${FIXTURE_ATTEMPT_OVERRIDE:-${fixture_attempt}}" \
    SESSION_FIXTURE_ARTIFACT_ID=778 SESSION_FIXTURE_ARTIFACT_DIGEST="$(printf 'f%.0s' {1..64})" \
    "${loader}"
}

expect_rejected() {
  local name="$1"
  if (run_loader) > "${test_dir}/out" 2>&1; then
    echo "Invalid E2E artifact was accepted: ${name}" >&2
    exit 1
  fi
  if [[ -e "${test_dir}/loaded" && "${name}" == fixture-* ]]; then
    echo "The Worker was loaded before the fixture was rejected: ${name}" >&2
    exit 1
  fi
  write_valid_artifacts
}

write_valid_artifacts
expected="$(printf 'MOMO_E2E_CONTROLLED_WORKER_IMAGE=%s\nMOMO_E2E_SESSION_FIXTURE_DIR=%s\n' \
  "${worker_id}" "$(cd "${fixture_dir}" && pwd)")"
[[ "$(run_loader)" == "${expected}" ]] || { echo 'Valid E2E artifacts were not loaded.' >&2; exit 1; }
write_valid_artifacts

RUNTIME_ID_OVERRIDE="sha256:$(printf 'c%.0s' {1..64})" expect_rejected fixture-for-other-runtime
SHA_OVERRIDE="$(printf 'f%.0s' {1..40})" expect_rejected fixture-from-other-commit
FIXTURE_ATTEMPT_OVERRIDE=3 expect_rejected fixture-consumer-attempt
WORKER_ATTEMPT_OVERRIDE="${fixture_attempt}" expect_rejected worker-other-producer-attempt
WORKER_ID_OVERRIDE="sha256:$(printf 'b%.0s' {1..64})" expect_rejected worker-loaded-other-image
printf '%s\n' tampered >> "${fixture_dir}/session-fixture.jar"
expect_rejected fixture-tampered-jar
rm "${fixture_dir}/candidate.json"
expect_rejected fixture-missing-provenance
printf '%s\n' tampered >> "${worker_dir}/controlled-worker-image.tar.gz"
expect_rejected worker-tampered-archive

# Keep the recorded digest in sync to reach the gzip failure rather than the hash guard.
archive="${worker_dir}/controlled-worker-image.tar.gz"
head -c "$(($(wc -c < "${archive}") - 8))" "${archive}" > "${archive}.truncated"
mv "${archive}.truncated" "${archive}"
printf '%s  %s\n' "$(sha "${archive}")" controlled-worker-image.tar.gz > "${worker_dir}/image-tar.sha256"
"${ci_tool}" create-e2e-candidate --kind controlled-worker --artifact-dir "${worker_dir}" \
  --run-id "${run_id}" --run-attempt "${worker_attempt}" --commit "${commit}" > "${worker_dir}/candidate.json"
expect_rejected worker-truncated-gzip

echo "E2E artifact loading tests passed."
