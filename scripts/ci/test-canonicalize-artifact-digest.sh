#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
canonicalizer="${repo_root}/scripts/ci/canonicalize-artifact-digest.sh"
readonly digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly canonical="sha256:${digest}"
readonly uppercase=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

[[ "$("${canonicalizer}" "${digest}")" == "${canonical}" ]]
[[ "$("${canonicalizer}" "${canonical}")" == "${canonical}" ]]

expect_rejected() {
  local name="$1"
  shift
  if "${canonicalizer}" "$@" > /dev/null 2>&1; then
    echo "Invalid artifact digest was accepted: ${name}" >&2
    exit 1
  fi
}

expect_rejected missing
expect_rejected extra "${digest}" "${digest}"
expect_rejected short "${digest:0:63}"
expect_rejected uppercase "${uppercase}"
expect_rejected wrong-algorithm "sha512:${digest}"
expect_rejected malformed-prefix "sha256-${digest}"

echo "Artifact digest canonicalization tests passed."
