#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 1 && "$1" == /* ]] || { echo "Usage: $0 <absolute-output-path>" >&2; exit 2; }
[[ ! -L "$1" && ( ! -e "$1" || -f "$1" ) ]] || {
  echo 'The CI tool output must name a regular file, not a directory or symlink.' >&2
  exit 2
}
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$(dirname "$1")"
# Always build from this checkout; callers reuse the binary within one job.
(cd "${repo_root}/scripts/tools" && go build -trimpath -o "$1" ./cmd/ci-tool)
[[ -f "$1" && -x "$1" ]] || { echo 'The CI tool build did not produce an executable file.' >&2; exit 1; }
