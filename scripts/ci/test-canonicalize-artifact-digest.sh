#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
canonicalizer=("${repo_root}/scripts/ci/ci-tool.sh" artifact-digest)
readonly digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly canonical="sha256:${digest}"

[[ "$("${canonicalizer[@]}" "${digest}")" == "${canonical}" ]]
[[ "$("${canonicalizer[@]}" "${canonical}")" == "${canonical}" ]]

expect_rejected() {
  local name="$1"
  shift
  if "${canonicalizer[@]}" "$@" > /dev/null 2>&1; then
    echo "Invalid artifact digest was accepted: ${name}" >&2
    exit 1
  fi
}

# Detailed digest partitions live in cievidence's Go tests. Keep executable
# dispatch, argument validation and one rejected value at the shell boundary.
expect_rejected missing
expect_rejected extra "${digest}" "${digest}"
expect_rejected wrong-algorithm "sha512:${digest}"

echo "Artifact digest canonicalization tests passed."
