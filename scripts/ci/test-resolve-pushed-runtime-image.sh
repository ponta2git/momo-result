#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
resolver="${repo_root}/scripts/ci/resolve-pushed-runtime-image.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

fake_bin="${test_dir}/bin"
mkdir -p "${fake_bin}"
printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  '[[ "$1" == "image" && "$2" == "inspect" ]]' \
  'printf '\''%s\n'\'' "${FAKE_REPO_DIGESTS}"' \
  > "${fake_bin}/docker"
chmod +x "${fake_bin}/docker"

readonly commit=0123456789abcdef0123456789abcdef01234567
readonly image_ref="registry.fly.io/momo-result:${commit}-123456-2"
readonly digest_a=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly digest_b=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
readonly registry_ref="registry.fly.io/momo-result@sha256:${digest_a}"

resolve_with() {
  PATH="${fake_bin}:${PATH}" FAKE_REPO_DIGESTS="$1" "${resolver}" "${image_ref}"
}

actual="$(resolve_with "[\"${registry_ref}\"]")"
[[ "${actual}" == "${registry_ref}" ]]

for invalid in \
  'null' \
  '[]' \
  "[\"registry.fly.io/other@sha256:${digest_a}\"]" \
  "[\"${registry_ref}\",\"registry.fly.io/momo-result@sha256:${digest_b}\"]"; do
  if resolve_with "${invalid}" > /dev/null 2>&1; then
    echo "Invalid pushed repository digests were accepted: ${invalid}" >&2
    exit 1
  fi
done

if PATH="${fake_bin}:${PATH}" FAKE_REPO_DIGESTS="[\"${registry_ref}\"]" \
  "${resolver}" "registry.fly.io/momo-result:latest" > /dev/null 2>&1; then
  echo "An untrusted runtime image tag was accepted." >&2
  exit 1
fi

echo "Pushed runtime image resolution tests passed."
