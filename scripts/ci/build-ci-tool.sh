#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 1 && "$1" == /* ]] || { echo "Usage: $0 <absolute-output-path>" >&2; exit 2; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$(dirname "$1")"
# Always build from this checkout; callers reuse the binary within one job.
(cd "${repo_root}/scripts/tools" && go build -trimpath -o "$1" ./cmd/ci-tool)
