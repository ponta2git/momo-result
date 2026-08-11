#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: $0 <artifact-digest>" >&2
  exit 2
fi

digest="$1"
if [[ "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'sha256:%s\n' "${digest}"
elif [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf '%s\n' "${digest}"
else
  echo "Artifact digest must be a lowercase SHA-256 value." >&2
  exit 1
fi
