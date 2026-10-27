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
  for key in api web analysis analysis_image runtime system_e2e http4s_patch workflow actionlint go_runtime go_tools policy_scripts; do
    value=false
    case " $* " in *" ${key} "*) value=true ;; esac
    if [[ " $* " == *" system_e2e "* ]]; then
      case "${key}" in runtime | analysis | analysis_image) value=true ;; esac
    fi
    printf '%s=%s\n' "${key}" "${value}"
  done
}

readonly none="$(expected)"
readonly api_only="$(expected api)"
readonly web_only="$(expected web)"
readonly api_runtime="$(expected system_e2e api runtime)"
readonly api_web="$(expected system_e2e api web)"
readonly analysis_only="$(expected analysis)"
readonly analysis_image="$(expected system_e2e analysis analysis_image)"
readonly runtime_only="$(expected runtime)"
readonly runtime_go="$(expected system_e2e runtime workflow go_runtime)"
readonly go_only="$(expected workflow go_tools)"
readonly http4s_ref="$(expected system_e2e api runtime http4s_patch)"
readonly http4s_builder="$(expected system_e2e api runtime http4s_patch workflow policy_scripts)"
readonly all="$(expected system_e2e api web analysis analysis_image runtime)"
readonly orchestrator="$(expected system_e2e api web analysis analysis_image runtime workflow actionlint)"
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

# Match the PR checkout: a synthetic merge plus its two parents, without their
# shared ancestor. Classification compares endpoint trees, not a merge base.
git -C "${rename_repo}" checkout --quiet -b updated-base "${rename_base}"
mkdir -p "${rename_repo}/docs"
printf '%s\n' base-only > "${rename_repo}/docs/base-only.md"
git -C "${rename_repo}" add .
git -C "${rename_repo}" commit --quiet -m updated-base
updated_base="$(git -C "${rename_repo}" rev-parse HEAD)"
git -C "${rename_repo}" merge --quiet --no-ff "${rename_head}" -m pull-request-merge
shallow_repo="${test_root}/shallow-pr"
git clone --quiet --no-checkout --depth=2 "file://${rename_repo}" "${shallow_repo}"
[[ "$(git -C "${shallow_repo}" rev-parse --is-shallow-repository)" == true ]]
if git -C "${shallow_repo}" cat-file -e "${rename_base}^{commit}" 2>/dev/null; then
  echo "Shallow PR fixture unexpectedly includes the shared ancestor." >&2
  exit 1
fi
shallow_actual="$(
  cd "${shallow_repo}"
  git diff --check "${updated_base}" "${rename_head}" -- &&
    "${range_classifier}" "${updated_base}" "${rename_head}"
)"
if [[ "${shallow_actual}" != "${api_runtime}" ]]; then
  echo "Shallow PR classification lost a renamed production input." >&2
  exit 1
fi
if (cd "${shallow_repo}" && "${range_classifier}" "${rename_base}" "${rename_head}") >/dev/null 2>&1; then
  echo "Missing comparison commits must fail closed." >&2
  exit 1
fi

assert_case docs-only "${none}" docs/README.md
assert_case actionlint-only "${actionlint_policy}" scripts/ci/actionlint.sh
assert_case dev-launcher "${web_only}" apps/web/scripts/dev-local.mts
assert_case shared-process "$(expected web runtime system_e2e)" apps/web/scripts/process.mts
assert_case browser-runner "$(expected web system_e2e)" scripts/e2e/run-system.mts
assert_case worker-e2e "$(expected web analysis analysis_image system_e2e)" scripts/e2e/series-analysis-control-plane-smoke.mts
assert_case runtime-e2e "$(expected web runtime system_e2e)" scripts/e2e/runtime-smoke.mts
assert_case ops-dispatcher "${policy_only}" scripts/ops/analysis.sh
assert_case ops-orchestration "${policy_only}" scripts/ops/analysis-maintain.sh
assert_case policy-runner "${policy_only}" scripts/ci/check-policy.sh
assert_case package-scripts \
  "$(expected web runtime workflow policy_scripts system_e2e)" package.json
assert_case unknown-ops-script \
  "$(expected api web analysis analysis_image runtime workflow go_runtime go_tools policy_scripts system_e2e)" \
  scripts/ops/new-operation.sh
assert_case policy-fixture "${policy_only}" scripts/ci/test-validate-runtime-deployment.sh
assert_case release-policy "${policy_only}" scripts/ci/check-pr-branch-policy.sh
assert_case release-notes-extractor "${policy_only}" scripts/ci/extract-release-notes.sh
assert_case range-classifier "${policy_only}" scripts/ci/classify-git-range.sh
assert_case migration-source \
  "$(expected api web analysis analysis_image runtime workflow policy_scripts system_e2e)" \
  scripts/ci/resolve-momo-db-migrations.sh
assert_case release-notes-renderer "${policy_only}" scripts/ci/runtime-release-notes.sh
assert_case image-validator \
  "$(expected runtime workflow policy_scripts)" \
  scripts/ci/validate-runtime-image.sh
assert_case unknown-validator \
  "$(expected api web analysis analysis_image runtime workflow go_runtime go_tools policy_scripts system_e2e)" \
  scripts/ci/validate-new-boundary.sh
assert_case api-source "${api_runtime}" apps/api/src/main/scala/momo/api/Main.scala
assert_case http4s-ref "${http4s_ref}" .http4s-ref
assert_case http4s-builder "${http4s_builder}" scripts/ci/build-http4s-patch.sh
assert_case api-test "${api_only}" apps/api/src/test/scala/momo/api/http/HttpAppSpec.scala
assert_case openapi "${api_web}" apps/api/openapi.yaml
assert_case openapi-policy "${web_only}" apps/api/redocly.yaml
assert_case web-test "${web_only}" apps/web/src/features/events/foo.test.tsx
assert_case web-test-support "${web_only}" apps/web/src/test/render.tsx
assert_case browser-shared-factory "${web_only}" \
  apps/web/src/test/factories/matchDetail.ts
assert_case browser-shared-masters "${web_only}" \
  apps/web/src/test/msw/fixtures.ts
assert_case browser-shared-analysis "${web_only}" \
  apps/web/src/test/msw/seriesAnalysisFixtures.ts
assert_case browser-shared-async-control "${web_only}" \
  apps/web/src/test/deferred.ts
assert_case web-quality-script "${web_only}" apps/web/scripts/generate-api.mts
assert_case web-lint-config "${web_only}" apps/web/oxlint.config.ts
assert_case analysis-test "${analysis_only}" apps/processing-worker/tests/parent_liveness.rs
assert_case analysis-source "${analysis_image}" apps/processing-worker/src/main.rs
assert_case analysis-production-workflow \
  "$(expected workflow actionlint)" \
  .github/workflows/analysis-production.yml
assert_case processing-worker-workflow \
  "$(expected system_e2e analysis analysis_image workflow actionlint)" \
  .github/workflows/processing-worker.yml
assert_case processing-worker-script \
  "$(expected analysis analysis_image workflow policy_scripts)" \
  scripts/ci/processing-worker-image-smoke.sh
assert_case series-analysis-script \
  "$(expected web analysis analysis_image system_e2e)" \
  scripts/e2e/series-analysis-control-plane-smoke.mts
assert_case runtime-tool "${runtime_go}" apps/runtime/cmd/momo-runtime-tool/main.go
assert_case runtime-tool-go-mod "${runtime_go}" apps/runtime/go.mod
assert_case runtime-tool-go-sum "${runtime_go}" apps/runtime/go.sum
assert_case runtime-unit "$(expected runtime workflow go_runtime)" apps/runtime/cmd/momo-runtime-tool/main_test.go
assert_case development-go-mod "$(expected workflow go_tools policy_scripts)" scripts/tools/go.mod
assert_case development-go-sum "$(expected workflow go_tools policy_scripts)" scripts/tools/go.sum
assert_case development-tool "${go_only}" scripts/tools/cmd/ocr-evaluation-audit/main.go
assert_case runtime-db-contract "${runtime_go}" contracts/runtime-db-contract.json
assert_case runtime-tool-characterization \
  "$(expected workflow go_runtime)" contracts/runtime-tool-characterization-v1.json
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
  "$(expected system_e2e runtime workflow actionlint)" \
  .github/workflows/deploy.yml
assert_case shared-schema "${all}" docs/schemas/series-analysis-v1.json
assert_case orchestrator "${orchestrator}" .github/workflows/pr.yml
assert_case unknown-path "$(expected api web analysis analysis_image runtime system_e2e workflow go_runtime go_tools)" config/unknown-release-input.toml

assert_case 'Summit contract pin selects assembled Web gate' "$(expected web system_e2e)" '.summit-ref'
assert_case 'System workflow selects both candidate producers' \
  "$(expected web workflow actionlint system_e2e)" \
  '.github/workflows/system-e2e.yml'

assert_case web-production "$(expected web runtime system_e2e)" apps/web/src/features/ocr/Upload.tsx
assert_case worker-assembled-fixture "${analysis_image}" apps/processing-worker/src/ocr/control/tests.rs
assert_case worker-testdata "${analysis_image}" apps/processing-worker/testdata/ocr-submission-v2.json
assert_case browser-runner-unit "${web_only}" apps/web/scripts/e2e/ocr-fixtures.test.mts
assert_case runtime-smoke-unit "$(expected web runtime)" scripts/e2e/runtime-smoke.test.mts
assert_case worker-smoke-unit "$(expected web analysis analysis_image)" scripts/e2e/worker-smoke-support.test.mts
assert_case docker-runtime "$(expected runtime system_e2e)" Dockerfile
assert_case deployment-config "$(expected runtime system_e2e)" deploy/entrypoint.sh
assert_case runtime-config "$(expected runtime system_e2e)" fly.toml
assert_case browser-config "$(expected web runtime system_e2e)" apps/web/playwright.system.config.ts
assert_case mixed-test-and-source "$(expected api web runtime system_e2e)" apps/api/src/test/Unit.scala apps/web/src/main.tsx
assert_case mixed-units "$(expected api web analysis)" apps/api/src/test/Unit.scala apps/web/src/features/Foo.test.tsx apps/processing-worker/tests/parent_liveness.rs

assert_case shared-toolchain "$(expected api web analysis analysis_image runtime system_e2e workflow go_runtime go_tools)" mise.toml
assert_case unknown-go-workspace "$(expected api web analysis analysis_image runtime system_e2e workflow go_runtime go_tools)" go.work
assert_case both-go-modules "$(expected runtime system_e2e workflow go_runtime go_tools policy_scripts)" \
  apps/runtime/go.mod scripts/tools/go.mod
assert_case both-go-test-modules "$(expected runtime workflow go_runtime go_tools)" \
  apps/runtime/cmd/momo-runtime-tool/main_test.go scripts/tools/cmd/linux-memory-snapshot/main_test.go
assert_case workflow-lint-selects-both-modules "$(expected workflow actionlint go_runtime go_tools policy_scripts)" \
  .github/workflows/workflow-lint.yml

echo "Change classifier tests passed."

assert_case ci-data-command "$(expected workflow go_tools policy_scripts)" scripts/tools/cmd/ci-tool/main.go
assert_case ci-data-validator "$(expected workflow go_tools policy_scripts)" scripts/tools/internal/cievidence/provenance.go
assert_case ci-tool-setup "$(expected workflow actionlint go_tools policy_scripts)" .github/actions/setup-ci-tool/action.yml
assert_case ci-tool-build "${policy_only}" scripts/ci/build-ci-tool.sh

assert_case ui-browser-test "${web_only}" apps/web/e2e/ui/design-system.spec.ts
assert_case ui-browser-config "${web_only}" apps/web/playwright.ui.config.ts
assert_case system-browser-test "$(expected web system_e2e)" apps/web/e2e/system/records.spec.ts
assert_case recovery-browser-test "$(expected web system_e2e)" apps/web/e2e/recovery/ocr.spec.ts
assert_case system-session-fixture "${api_runtime}" apps/api/src/e2e-fixture/scala/momo/api/e2e/SessionFixture.scala
assert_case e2e-artifact-loader "$(expected system_e2e workflow policy_scripts)" scripts/ci/load-e2e-artifacts.sh
assert_case e2e-artifact-loader-test "${policy_only}" scripts/ci/test-load-e2e-artifacts.sh
assert_case e2e-artifact-validator "$(expected system_e2e workflow go_tools policy_scripts)" \
  scripts/tools/internal/cievidence/e2e.go
assert_case e2e-artifact-validator-test "$(expected workflow go_tools policy_scripts)" \
  scripts/tools/internal/cievidence/e2e_test.go
assert_case e2e-local-preparation "$(expected web analysis analysis_image system_e2e)" scripts/e2e/prepare.mts
assert_case e2e-fixture-contract-test "$(expected web analysis analysis_image)" scripts/e2e/session-fixture.test.mts
