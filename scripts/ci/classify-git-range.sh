#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <base-commit> <head-commit>" >&2
  exit 2
fi

base_commit="$1"
head_commit="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

git cat-file -e "${base_commit}^{commit}"
git cat-file -e "${head_commit}^{commit}"
git diff --no-renames --name-only -z "${base_commit}" "${head_commit}" -- |
  "${script_dir}/classify-changes.sh"
