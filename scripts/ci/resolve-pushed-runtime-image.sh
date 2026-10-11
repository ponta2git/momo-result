#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 1 ]] || { echo "Usage: $0 <candidate-image-tag>" >&2; exit 2; }
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker image inspect "$1" --format '{{json .RepoDigests}}' | "${script_dir}/ci-tool.sh" resolve-pushed-image "$1"
