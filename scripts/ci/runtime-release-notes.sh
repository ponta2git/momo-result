#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: $0 <associated-prs-json> <repository> <master-commit> <run-url> <notes-file>" >&2
  exit 2
fi

pull_requests_file="$1"
repository="$2"
master_commit="$3"
run_url="$4"
notes_file="$5"

[[ -f "${pull_requests_file}" ]] || {
  echo "Associated pull requests JSON does not exist." >&2
  exit 1
}
[[ "${repository}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "Invalid GitHub repository name." >&2
  exit 1
}
[[ "${master_commit}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Invalid master commit." >&2
  exit 1
}
[[ "${run_url}" == "https://github.com/${repository}/actions/runs/"* ]] || {
  echo "Invalid GitHub Actions run URL." >&2
  exit 1
}

candidate_file="$(mktemp "${TMPDIR:-/tmp}/momo-release-pr.XXXXXX")"
body_file="$(mktemp "${TMPDIR:-/tmp}/momo-release-body.XXXXXX")"
extracted_notes="$(mktemp "${TMPDIR:-/tmp}/momo-release-extracted.XXXXXX")"
trap 'rm -f -- "${candidate_file}" "${body_file}" "${extracted_notes}"' EXIT

jq --arg repository "${repository}" --arg commit "${master_commit}" '
  [
    .[] |
    select(
      .merged_at != null and
      .base.ref == "master" and
      (.head.ref | startswith("release/")) and
      .head.repo.full_name == $repository and
      .merge_commit_sha == $commit
    )
  ]
' "${pull_requests_file}" > "${candidate_file}"

candidate_count="$(jq 'length' "${candidate_file}")"
[[ "${candidate_count}" == "1" ]] || {
  echo "Expected exactly one merged release PR for ${master_commit}; found ${candidate_count}." >&2
  exit 1
}

pull_request_number="$(jq -r '.[0].number' "${candidate_file}")"
[[ "${pull_request_number}" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid release PR number." >&2
  exit 1
}
jq -r '.[0].body // ""' "${candidate_file}" > "${body_file}"
"$(dirname "${BASH_SOURCE[0]}")/extract-release-notes.sh" \
  "${body_file}" "${extracted_notes}"

pull_request_url="https://github.com/${repository}/pull/${pull_request_number}"
{
  cat "${extracted_notes}"
  printf '\n\n---\n\n'
  printf 'Release PR: [#%s](%s)\n\n' "${pull_request_number}" "${pull_request_url}"
  printf 'Commit: `%s`\n\n' "${master_commit}"
  printf 'Deployment: [GitHub Actions run](%s)\n' "${run_url}"
} > "${notes_file}"

printf 'pull_request_number=%s\n' "${pull_request_number}"
