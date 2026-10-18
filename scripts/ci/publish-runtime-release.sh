#!/usr/bin/env bash
set -euo pipefail
mode="${1:-}"
receipt="${2:-}"
: "${RELEASE_SHA:?required}"
: "${RUN_URL:?required}"
: "${GITHUB_REPOSITORY:?required}"
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release commit.' >&2; exit 1; }
permission() {
  case "${mode}" in
    normal) scripts/ci/maintenance-control.sh normal-guard ;;
    maintenance) scripts/ci/maintenance-control.sh maintenance-guard publish "${receipt}" ;;
    *) echo 'Unknown publication mode.' >&2; exit 2 ;;
  esac
}
permission
gh api -H 'Accept: application/vnd.github+json' \
  "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_SHA}/pulls" > associated-pull-requests.json
scripts/ci/runtime-release-notes.sh associated-pull-requests.json "${GITHUB_REPOSITORY}" \
  "${RELEASE_SHA}" "${RUN_URL}" runtime-release-notes.md > /dev/null
commit_date="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_SHA}" --jq '.commit.committer.date')"
[[ "${commit_date}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || { echo 'Invalid release commit timestamp.' >&2; exit 1; }
release_date="${commit_date:0:10}"
release_date="${release_date//-/}"
short_sha="${RELEASE_SHA:0:12}"
tag="runtime-${release_date}-${short_sha}"
title="Runtime ${release_date} (${short_sha})"
ref_exists=false
if ref_json="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${tag}" 2>/dev/null)"; then
  ref_exists=true
  ref_type="$(jq -r '.object.type' <<< "${ref_json}")"
  ref_sha="$(jq -r '.object.sha' <<< "${ref_json}")"
  [[ "${ref_type}" == commit && "${ref_sha}" == "${RELEASE_SHA}" ]] || {
    echo 'Release tag already exists for a different or indirect object.' >&2
    exit 1
  }
fi
if gh release view "${tag}" --repo "${GITHUB_REPOSITORY}" >/dev/null 2>&1; then
  [[ "${ref_exists}" == true ]] || { echo 'Release exists without its expected tag ref.' >&2; exit 1; }
  echo "Release ${tag} already exists for ${RELEASE_SHA}."
  exit 0
fi
permission
if [[ "${ref_exists}" == true ]]; then
  gh release create "${tag}" --repo "${GITHUB_REPOSITORY}" --verify-tag --title "${title}" --notes-file runtime-release-notes.md
else
  gh release create "${tag}" --repo "${GITHUB_REPOSITORY}" --target "${RELEASE_SHA}" --title "${title}" --notes-file runtime-release-notes.md
fi
