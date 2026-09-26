#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

paths_file="$(mktemp "${TMPDIR:-/tmp}/momo-public-safety.XXXXXX")"
trap 'rm -f -- "${paths_file}"' EXIT

# Preserve arbitrary Git filenames, and finish enumeration successfully before
# checking them. A process substitution would hide a failed git ls-files.
git ls-files --cached --others --exclude-standard -z > "${paths_file}"
forbidden_paths=()
while IFS= read -r -d '' path; do
  [[ -e "${path}" || -L "${path}" ]] || continue
  case "${path}" in
    .env | .env.* | */.env | */.env.*)
      if [[ "${path##*/}" != .env.example ]]; then
        forbidden_paths+=("${path}")
        continue
      fi
      ;;
  esac
  case "${path}" in
    docs/*.env | docs/*.env.* | private/* | docs/tmp/* | \
      docs/post-mortem/[0-9][0-9][0-9][0-9]-* | \
      docs/post-mortem/follow-up-actions.md | ocr_samples/* | samples/* | .serena/*)
      forbidden_paths+=("${path}")
      ;;
    docs/ops/*)
      [[ "${path}" == docs/ops/README.md ]] || forbidden_paths+=("${path}")
      ;;
    .agents/*)
      [[ "${path}" == .agents/skills/postmortem/* ]] || forbidden_paths+=("${path}")
      ;;
  esac
done < "${paths_file}"

if [[ ${#forbidden_paths[@]} -gt 0 ]]; then
  echo "Forbidden private/local paths would be published:" >&2
  printf '%q\n' "${forbidden_paths[@]}" >&2
  exit 1
fi

search_status=0
git grep --untracked -l -z -I -E \
  '(BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{20,}|cfat_[A-Za-z0-9_-]{20,}|CLOUDFLARE_API_TOKEN="?[A-Za-z0-9_-]{20,}|docs\.google\.com/spreadsheets/d/)' \
  -- ':!pnpm-lock.yaml' > "${paths_file}" || search_status=$?

case "${search_status}" in
  0)
    echo "High-risk public repository content was found:" >&2
    while IFS= read -r -d '' path; do
      printf '%q\n' "${path}" >&2
    done < "${paths_file}"
    exit 1
    ;;
  1) ;; # No matches.
  *)
    echo "Public repository content could not be checked." >&2
    exit "${search_status}"
    ;;
esac
