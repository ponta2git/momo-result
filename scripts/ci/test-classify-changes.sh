#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
classifier="${repo_root}/scripts/ci/classify-changes.sh"

assert_case() {
  local name="$1"
  local expected="$2"
  shift 2
  local actual
  actual="$(printf '%s\0' "$@" | "${classifier}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Classifier case failed: ${name}" >&2
    diff -u <(printf '%s\n' "${expected}") <(printf '%s\n' "${actual}") >&2 || true
    exit 1
  fi
}

readonly none=$'api=false\nweb=false\nocr=false\nanalysis=false\nruntime=false'
readonly api_runtime=$'api=true\nweb=false\nocr=false\nanalysis=false\nruntime=true'
readonly api_web_runtime=$'api=true\nweb=true\nocr=false\nanalysis=false\nruntime=true'
readonly analysis_only=$'api=false\nweb=false\nocr=false\nanalysis=true\nruntime=false'
readonly all=$'api=true\nweb=true\nocr=true\nanalysis=true\nruntime=true'

assert_case docs-only "${none}" docs/README.md
assert_case actionlint-only "${none}" scripts/ci/actionlint.sh
assert_case api-source "${api_runtime}" apps/api/src/main/scala/momo/api/Main.scala
assert_case openapi "${api_web_runtime}" apps/api/openapi.yaml
assert_case analysis-source "${analysis_only}" apps/analysis-worker/src/main.rs
assert_case analysis-candidate-workflow "${analysis_only}" .github/workflows/analysis-candidate.yml
assert_case shared-schema "${all}" docs/schemas/series-analysis-v1.json
assert_case orchestrator "${all}" .github/workflows/pr.yml
assert_case unknown-path "${all}" config/unknown-release-input.toml

echo "Change classifier tests passed."
