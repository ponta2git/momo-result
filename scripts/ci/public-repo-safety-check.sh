#!/usr/bin/env bash
set -euo pipefail

tracked_forbidden_paths="$(
  git ls-files | awk '
    ((($0 ~ /(^|\/)\.env($|\.)/) && ($0 !~ /(^|\/)\.env\.example$/)) ||
      ($0 ~ /^docs\/(ops|tmp)\//) ||
      ($0 ~ /^ocr_samples\//) ||
      ($0 ~ /^samples\//) ||
      ($0 ~ /^\.serena\//) ||
      ($0 ~ /^\.agents\//)) { print }
  ' || true
)"

if [[ -n "${tracked_forbidden_paths}" ]]; then
  echo "Forbidden private/local paths are tracked:" >&2
  echo "${tracked_forbidden_paths}" >&2
  exit 1
fi

tracked_secret_matches="$(
  git grep -n -I -E \
    '(BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{20,}|docs\.google\.com/spreadsheets/d/)' \
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
