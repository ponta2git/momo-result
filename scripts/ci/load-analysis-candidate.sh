#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 3 ]] || { echo "Usage: $0 <artifact-directory> <expected-image-ref> <expected-tar-sha256>" >&2; exit 2; }
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
expected_id="$("${script_dir}/ci-tool.sh" analysis-archive "$@")"
# pipefail rejects gzip checksum/truncation errors from this single pass.
gzip -dc "$1/analysis-worker-image.tar.gz" | docker load
actual_id="$(docker image inspect "$2" --format '{{.Id}}')"
"${script_dir}/ci-tool.sh" image-id-match "${expected_id}" "${actual_id}"
