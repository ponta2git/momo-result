#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
classifier="${repo_root}/scripts/ci/classify-changes.sh"
range_classifier="${repo_root}/scripts/ci/classify-git-range.sh"

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

expected() {
  local key value
  for key in api web analysis analysis_image runtime http4s_patch workflow actionlint go_tools policy_scripts; do
    value=false
    case " $* " in *" ${key} "*) value=true ;; esac
    printf '%s=%s\n' "${key}" "${value}"
  done
}

readonly none="$(expected)"
readonly api_only="$(expected api)"
readonly web_only="$(expected web)"
readonly api_runtime="$(expected api runtime)"
readonly api_web="$(expected api web)"
readonly analysis_only="$(expected analysis)"
readonly analysis_image="$(expected analysis analysis_image)"
readonly runtime_only="$(expected runtime)"
readonly runtime_go="$(expected runtime workflow go_tools)"
readonly go_only="$(expected workflow go_tools)"
readonly http4s_ref="$(expected api runtime http4s_patch)"
readonly http4s_builder="$(expected api runtime http4s_patch workflow policy_scripts)"
readonly all="$(expected api web analysis analysis_image runtime)"
readonly orchestrator="$(expected api web analysis analysis_image runtime workflow actionlint)"
readonly actionlint_policy="$(expected workflow actionlint policy_scripts)"
readonly policy_only="$(expected workflow policy_scripts)"

test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

rename_repo="${test_root}/rename-repo"
git init --quiet "${rename_repo}"
git -C "${rename_repo}" config user.email fixture@example.invalid
git -C "${rename_repo}" config user.name Fixture
mkdir -p "${rename_repo}/apps/api/src/main/scala" "${rename_repo}/docs"
printf '%s\n' 'object RemovedFromApi' \
  > "${rename_repo}/apps/api/src/main/scala/RemovedFromApi.scala"
git -C "${rename_repo}" add .
git -C "${rename_repo}" commit --quiet -m base
rename_base="$(git -C "${rename_repo}" rev-parse HEAD)"
mv "${rename_repo}/apps/api/src/main/scala/RemovedFromApi.scala" \
  "${rename_repo}/docs/RemovedFromApi.scala"
git -C "${rename_repo}" add -A
git -C "${rename_repo}" commit --quiet -m rename
rename_head="$(git -C "${rename_repo}" rev-parse HEAD)"
rename_actual="$(
  cd "${rename_repo}"
  "${range_classifier}" "${rename_base}" "${rename_head}"
)"
if [[ "${rename_actual}" != "${api_runtime}" ]]; then
  echo "Classifier failed closed-path handling for a source-to-docs rename." >&2
  diff -u <(printf '%s\n' "${api_runtime}") \
    <(printf '%s\n' "${rename_actual}") >&2 || true
  exit 1
fi

assert_case docs-only "${none}" docs/README.md
assert_case actionlint-only "${actionlint_policy}" scripts/ci/actionlint.sh
assert_case dev-launcher "${policy_only}" scripts/dev-local.mjs
assert_case ops-dispatcher "${policy_only}" scripts/ops/analysis.sh
assert_case ops-orchestration "${policy_only}" scripts/ops/analysis-maintain.sh
assert_case policy-runner "${policy_only}" scripts/ci/policy.test.mjs
assert_case package-scripts \
  "$(expected web runtime workflow policy_scripts)" package.json
assert_case unknown-ops-script \
  "$(expected api web analysis analysis_image runtime workflow policy_scripts)" \
  scripts/ops/new-operation.sh
assert_case policy-fixture "${policy_only}" scripts/ci/test-validate-runtime-deployment.sh
assert_case release-policy "${policy_only}" scripts/ci/check-pr-branch-policy.sh
assert_case release-notes-extractor "${policy_only}" scripts/ci/extract-release-notes.sh
assert_case range-classifier "${policy_only}" scripts/ci/classify-git-range.sh
assert_case release-notes-renderer "${policy_only}" scripts/ci/runtime-release-notes.sh
assert_case deployment-validator "${policy_only}" scripts/ci/validate-runtime-deployment.sh
assert_case image-validator \
  "$(expected runtime workflow policy_scripts)" \
  scripts/ci/validate-runtime-image.sh
assert_case unknown-validator \
  "$(expected api web analysis analysis_image runtime workflow policy_scripts)" \
  scripts/ci/validate-new-boundary.sh
assert_case coverage-summary \
  "$(expected api web workflow policy_scripts)" \
  scripts/ci/write-coverage-summary.py
assert_case api-source "${api_runtime}" apps/api/src/main/scala/momo/api/Main.scala
assert_case http4s-ref "${http4s_ref}" .http4s-ref
assert_case http4s-builder "${http4s_builder}" scripts/ci/build-http4s-patch.sh
assert_case api-test "${api_only}" apps/api/src/test/scala/momo/api/http/HttpAppSpec.scala
assert_case openapi "${api_web}" apps/api/openapi.yaml
assert_case openapi-policy "${web_only}" apps/api/redocly.yaml
assert_case web-test "${web_only}" apps/web/src/features/events/foo.test.tsx
assert_case web-test-support "${web_only}" apps/web/src/test/render.tsx
assert_case web-quality-script "${web_only}" apps/web/scripts/generate-api.mjs
assert_case web-lint-config "${web_only}" apps/web/oxlint.config.ts
assert_case analysis-test "${analysis_only}" apps/processing-worker/tests/parent_liveness.rs
assert_case analysis-source "${analysis_image}" apps/processing-worker/src/main.rs
assert_case analysis-production-workflow \
  "$(expected workflow actionlint)" \
  .github/workflows/analysis-production.yml
assert_case processing-worker-workflow \
  "$(expected analysis analysis_image workflow actionlint)" \
  .github/workflows/processing-worker.yml
assert_case processing-worker-script \
  "$(expected analysis analysis_image workflow policy_scripts)" \
  scripts/ci/processing-worker-image-smoke.sh
assert_case series-analysis-script \
  "$(expected analysis analysis_image workflow policy_scripts)" \
  scripts/ci/series-analysis-control-plane-smoke.sh
assert_case runtime-tool "${runtime_go}" scripts/tools/cmd/momo-runtime-tool/main.go
assert_case runtime-tool-go-mod "${runtime_go}" scripts/tools/go.mod
assert_case runtime-tool-go-sum "${runtime_go}" scripts/tools/go.sum
assert_case development-tool "${go_only}" scripts/tools/cmd/ocr-evaluation-audit/main.go
assert_case runtime-db-contract "${runtime_go}" contracts/runtime-db-contract.json
assert_case runtime-tool-characterization \
  "${go_only}" contracts/runtime-tool-characterization-v1.json
assert_case runtime-log-summary \
  "$(expected runtime workflow policy_scripts)" \
  scripts/ci/summarize-runtime-logs.sh
assert_case runtime-memory-smoke \
  "$(expected runtime workflow policy_scripts)" \
  scripts/ci/runtime-memory-smoke.sh
assert_case runtime-rollback-workflow \
  "$(expected workflow actionlint)" \
  .github/workflows/runtime-rollback.yml
assert_case runtime-release-workflow \
  "$(expected workflow actionlint)" \
  .github/workflows/runtime-release.yml
assert_case deploy-workflow \
  "$(expected runtime workflow actionlint)" \
  .github/workflows/deploy.yml
assert_case shared-schema "${all}" docs/schemas/series-analysis-v1.json
assert_case orchestrator "${orchestrator}" .github/workflows/pr.yml
assert_case unknown-path "${all}" config/unknown-release-input.toml

assert_case 'Summit contract pin selects assembled Web gate' "${web_only}" '.summit-ref'
assert_case 'OCR notification workflow selects its gate' \
  "$(expected web workflow actionlint)" \
  '.github/workflows/ocr-notifications.yml'

echo "Change classifier tests passed."
