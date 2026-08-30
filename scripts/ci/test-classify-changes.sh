#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
classifier="${repo_root}/scripts/ci/classify-changes.sh"
range_classifier="${repo_root}/scripts/ci/classify-git-range.sh"
release_validator="${repo_root}/scripts/ci/validate-current-runtime-release.sh"

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
  local expected_api="$1" expected_web="$2" expected_analysis="$3"
  local expected_analysis_image="$4" expected_runtime="$5" expected_http4s_patch="$6"
  local expected_workflow="$7" expected_actionlint="$8" expected_go_tools="$9"
  local expected_policy_scripts="${10}"
  printf '%s\n' \
    "api=${expected_api}" \
    "web=${expected_web}" \
    "analysis=${expected_analysis}" \
    "analysis_image=${expected_analysis_image}" \
    "runtime=${expected_runtime}" \
    "http4s_patch=${expected_http4s_patch}" \
    "workflow=${expected_workflow}" \
    "actionlint=${expected_actionlint}" \
    "go_tools=${expected_go_tools}" \
    "policy_scripts=${expected_policy_scripts}"
}

readonly none="$(expected false false false false false false false false false false)"
readonly api_only="$(expected true false false false false false false false false false)"
readonly web_only="$(expected false true false false false false false false false false)"
readonly api_runtime="$(expected true false false false true false false false false false)"
readonly api_web="$(expected true true false false false false false false false false)"
readonly analysis_only="$(expected false false true false false false false false false false)"
readonly analysis_image="$(expected false false true true false false false false false false)"
readonly runtime_only="$(expected false false false false true false false false false false)"
readonly runtime_go="$(expected false false false false true false true false true false)"
readonly go_only="$(expected false false false false false false true false true false)"
readonly http4s_ref="$(expected true false false false true true false false false false)"
readonly http4s_builder="$(expected true false false false true true true false false true)"
readonly all="$(expected true true true true true false false false false false)"
readonly orchestrator="$(expected true true true true true false true true false false)"
readonly actionlint_policy="$(expected false false false false false false true true false true)"
readonly policy_only="$(expected false false false false false false true false false true)"

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

release_repo="${test_root}/release-repo"
git init --quiet "${release_repo}"
git -C "${release_repo}" config user.email fixture@example.invalid
git -C "${release_repo}" config user.name Fixture
printf '%s\n' base > "${release_repo}/README.md"
git -C "${release_repo}" add .
git -C "${release_repo}" commit --quiet -m base
release_candidate="$(git -C "${release_repo}" rev-parse HEAD)"
(
  cd "${release_repo}"
  "${release_validator}" "${release_candidate}" "${release_candidate}"
)

mkdir -p "${release_repo}/docs"
printf '%s\n' docs > "${release_repo}/docs/note.md"
git -C "${release_repo}" add .
git -C "${release_repo}" commit --quiet -m docs
docs_head="$(git -C "${release_repo}" rev-parse HEAD)"
(
  cd "${release_repo}"
  "${release_validator}" "${release_candidate}" "${docs_head}"
)

mkdir -p "${release_repo}/apps/api"
printf '%s\n' 'object RuntimeChange' > "${release_repo}/apps/api/RuntimeChange.scala"
git -C "${release_repo}" add .
git -C "${release_repo}" commit --quiet -m runtime
runtime_head="$(git -C "${release_repo}" rev-parse HEAD)"
if (
  cd "${release_repo}"
  "${release_validator}" "${release_candidate}" "${runtime_head}"
) > /dev/null 2>&1; then
  echo "A runtime-stale release candidate was accepted." >&2
  exit 1
fi

git -C "${release_repo}" checkout --quiet --orphan rewritten
git -C "${release_repo}" rm -q -rf .
printf '%s\n' rewritten > "${release_repo}/README.md"
git -C "${release_repo}" add .
git -C "${release_repo}" commit --quiet -m rewritten
rewritten_head="$(git -C "${release_repo}" rev-parse HEAD)"
if (
  cd "${release_repo}"
  "${release_validator}" "${release_candidate}" "${rewritten_head}"
) > /dev/null 2>&1; then
  echo "A non-ancestor release candidate was accepted." >&2
  exit 1
fi

assert_case docs-only "${none}" docs/README.md
assert_case actionlint-only "${actionlint_policy}" scripts/ci/actionlint.sh
assert_case dev-launcher "${policy_only}" scripts/dev-local.mjs
assert_case policy-fixture "${policy_only}" scripts/ci/test-validate-runtime-deployment.sh
assert_case release-policy "${policy_only}" scripts/ci/check-pr-branch-policy.sh
assert_case release-notes-extractor "${policy_only}" scripts/ci/extract-release-notes.sh
assert_case range-classifier \
  "$(expected true true true true true false true false false true)" \
  scripts/ci/classify-git-range.sh
assert_case coverage-summary \
  "$(expected true true false false false false true false false true)" \
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
assert_case analysis-candidate-workflow \
  "$(expected false false false false false false true true false false)" \
  .github/workflows/analysis-candidate.yml
assert_case analysis-production-workflow \
  "$(expected false false false false false false true true false false)" \
  .github/workflows/analysis-production.yml
assert_case processing-worker-workflow \
  "$(expected false false true true false false true true false false)" \
  .github/workflows/processing-worker.yml
assert_case processing-worker-script \
  "$(expected false false true true false false true false false true)" \
  scripts/ci/processing-worker-image-smoke.sh
assert_case series-analysis-script \
  "$(expected false false true true false false true false false true)" \
  scripts/ci/series-analysis-control-plane-smoke.sh
assert_case runtime-tool "${runtime_go}" tools/cmd/momo-runtime-tool/main.go
assert_case runtime-tool-go-mod "${runtime_go}" tools/go.mod
assert_case runtime-tool-go-sum "${runtime_go}" tools/go.sum
assert_case runtime-db-contract "${runtime_go}" contracts/runtime-db-contract.json
assert_case runtime-tool-characterization \
  "${go_only}" contracts/runtime-tool-characterization-v1.json
assert_case runtime-log-summary \
  "$(expected false false false false true false true false false true)" \
  scripts/ci/summarize-runtime-logs.sh
assert_case runtime-memory-smoke \
  "$(expected false false false false true false true false false true)" \
  scripts/ci/runtime-memory-smoke.sh
assert_case runtime-rollback-workflow \
  "$(expected false false false false false false true true false false)" \
  .github/workflows/runtime-rollback.yml
assert_case runtime-release-workflow \
  "$(expected false false false false false false true true false false)" \
  .github/workflows/runtime-release.yml
assert_case deploy-workflow \
  "$(expected false false false false true false true true false false)" \
  .github/workflows/deploy.yml
assert_case shared-schema "${all}" docs/schemas/series-analysis-v1.json
assert_case orchestrator "${orchestrator}" .github/workflows/pr.yml
assert_case unknown-path "${all}" config/unknown-release-input.toml

echo "Change classifier tests passed."
