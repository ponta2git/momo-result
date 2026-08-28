#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

if ! command -v trivy >/dev/null 2>&1; then
  echo "trivy is required; install the version pinned in mise.toml." >&2
  exit 1
fi

dockerfiles=()
while IFS= read -r -d '' path; do
  dockerfiles+=("${path}")
done < <(git ls-files -z -- Dockerfile ':(glob)**/Dockerfile')

if [[ "${#dockerfiles[@]}" -eq 0 ]]; then
  echo "No tracked Dockerfiles were found." >&2
  exit 1
fi

echo "Enforcing the MEDIUM, HIGH, and CRITICAL Dockerfile gate."
for dockerfile in "${dockerfiles[@]}"; do
  trivy config \
    --exit-code 1 \
    --format table \
    --quiet \
    --severity MEDIUM,HIGH,CRITICAL \
    --skip-version-check \
    "${dockerfile}"
done
