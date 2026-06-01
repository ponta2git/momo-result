#!/usr/bin/env bash
set -euo pipefail

tracked_forbidden_paths="$(
  git ls-files --cached --others --exclude-standard | while IFS= read -r path; do
    [[ -e "${path}" ]] && printf '%s\n' "${path}"
  done | awk '
    ((($0 ~ /(^|\/)\.env($|\.)/) && ($0 !~ /(^|\/)\.env\.example$/)) ||
      ($0 ~ /^docs\/.*\.env($|\.)/) ||
      ($0 ~ /^private\//) ||
      (($0 ~ /^docs\/ops\//) && ($0 != "docs/ops/README.md")) ||
      ($0 ~ /^docs\/tmp\//) ||
      ($0 ~ /^docs\/post-mortem\/[0-9][0-9][0-9][0-9]-/) ||
      ($0 == "docs/post-mortem/follow-up-actions.md") ||
      ($0 ~ /^ocr_samples\//) ||
      ($0 ~ /^samples\//) ||
      ($0 ~ /^\.serena\//) ||
      (($0 ~ /^\.agents\//) && ($0 !~ /^\.agents\/skills\/postmortem\//))) { print }
  ' || true
)"

if [[ -n "${tracked_forbidden_paths}" ]]; then
  echo "Forbidden private/local paths are tracked:" >&2
  echo "${tracked_forbidden_paths}" >&2
  exit 1
fi

tracked_secret_matches="$(
  git grep --untracked -n -I -E \
    '(BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{20,}|cfat_[A-Za-z0-9_-]{20,}|CLOUDFLARE_API_TOKEN="?[A-Za-z0-9_-]{20,}|docs\.google\.com/spreadsheets/d/)' \
    -- \
    ':!pnpm-lock.yaml' \
    ':!apps/ocr-worker/uv.lock' \
    || true
)"

if [[ -n "${tracked_secret_matches}" ]]; then
  echo "High-risk public repository content was found:" >&2
  echo "${tracked_secret_matches}" >&2
  exit 1
fi
