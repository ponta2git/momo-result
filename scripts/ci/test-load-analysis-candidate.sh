#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
loader="${repo_root}/scripts/ci/load-analysis-candidate.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

readonly commit=0123456789abcdef0123456789abcdef01234567
readonly image_ref="registry.fly.io/momo-result-analysis:${commit}-123456-2"
readonly image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
artifact_dir="${test_dir}/artifact"
fake_bin="${test_dir}/bin"
mkdir -p "${artifact_dir}" "${fake_bin}"

printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "$1" == "load" ]]; then' \
  '  consume="$(mktemp)"' \
  '  trap '\''rm -f "${consume}"'\'' EXIT' \
  '  tee "${consume}" > /dev/null' \
  '  grep -qx "verified image bytes" "${consume}"' \
  'elif [[ "$1" == "image" && "$2" == "inspect" ]]; then' \
  '  printf '\''%s\n'\'' "${FAKE_IMAGE_ID}"' \
  'else' \
  '  echo "Unexpected fake docker invocation: $*" >&2' \
  '  exit 1' \
  'fi' > "${fake_bin}/docker"
chmod +x "${fake_bin}/docker"

write_valid_artifact() {
  printf '%s\n' 'verified image bytes' | gzip -1 \
    > "${artifact_dir}/analysis-worker-image.tar.gz"
  printf '%s\n' "${image_id}" > "${artifact_dir}/image-id.txt"
  printf '%s\n' "${image_ref}" > "${artifact_dir}/image-ref.txt"
  archive_sha="$(sha256sum "${artifact_dir}/analysis-worker-image.tar.gz" | cut -d ' ' -f 1)"
  printf '%s  %s\n' "${archive_sha}" analysis-worker-image.tar.gz \
    > "${artifact_dir}/image-tar.sha256"
}

run_loader() {
  PATH="${fake_bin}:${PATH}" FAKE_IMAGE_ID="${1:-${image_id}}" \
    "${loader}" "${artifact_dir}" "${image_ref}" "${archive_sha}"
}

expect_rejected() {
  local name="$1"
  shift
  if run_loader "$@" > /dev/null 2>&1; then
    echo "Invalid analysis image artifact was accepted: ${name}" >&2
    exit 1
  fi
}

write_valid_artifact
run_loader
expect_rejected mismatched-image-id sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

printf '%s\n' tampered >> "${artifact_dir}/analysis-worker-image.tar.gz"
expect_rejected tampered-archive

write_valid_artifact
printf '%s\n' unexpected >> "${artifact_dir}/image-ref.txt"
expect_rejected multiline-image-ref

# Keep the trusted digest in sync to reach the gzip failure rather than the hash guard.
write_valid_artifact
archive="${artifact_dir}/analysis-worker-image.tar.gz"
archive_size="$(wc -c < "${archive}")"
dd if="${archive}" of="${archive}.truncated" bs=1 count="$((archive_size - 8))" 2> /dev/null
mv "${archive}.truncated" "${archive}"
archive_sha="$(sha256sum "${archive}" | cut -d ' ' -f 1)"
printf '%s  %s\n' "${archive_sha}" analysis-worker-image.tar.gz > "${artifact_dir}/image-tar.sha256"
expect_rejected truncated-gzip

echo "Analysis candidate image loading tests passed."
