#!/usr/bin/env bash
set -euo pipefail

api=false
web=false
analysis=false
analysis_image=false
runtime=false
# Assembled system inputs are independent of each application quality gate.
system_e2e=false
http4s_patch=false
actionlint=false
go_runtime=false
go_tools=false
policy_scripts=false
workflow=false

select_all() {
  api=true
  web=true
  analysis=true
  analysis_image=true
  runtime=true
  system_e2e=true
}

while IFS= read -r -d '' path; do
  [[ "${path}" == scripts/ci/* || "${path}" == scripts/ops/* ]] && policy_scripts=true
  [[ "${path}" == .github/workflows/* || "${path}" == .github/actions/* ]] && actionlint=true
  [[ "${path}" == apps/runtime/* ]] && go_runtime=true
  [[ "${path}" == scripts/tools/* ]] && go_tools=true

  case "${path}" in
    apps/api/openapi.yaml)
      system_e2e=true
      api=true
      web=true
      ;;
    apps/api/redocly.yaml)
      web=true
      ;;
    apps/api/src/test/scala/momo/api/e2e/*)
      api=true
      system_e2e=true
      ;;
    apps/api/src/test/*)
      api=true
      ;;
    apps/api/*)
      system_e2e=true
      api=true
      runtime=true
      ;;
    apps/web/e2e/ui/* | apps/web/playwright.ui.config.ts)
      # Browser-only contracts do not need production candidates or backing stores.
      web=true
      ;;
    apps/web/scripts/e2e/*.test.*)
      web=true
      ;;
    apps/web/scripts/e2e/runtime.mts | apps/web/scripts/e2e/ocr-fixtures.mts | apps/web/scripts/process.mts)
      system_e2e=true
      web=true
      runtime=true
      ;;
    apps/web/src/test/* | apps/web/src/*.test.* | apps/web/src/*.spec.* | \
      apps/web/scripts/* | apps/web/oxlint.config.ts | apps/web/vitest.config.*)
      web=true
      ;;
    apps/web/*)
      system_e2e=true
      web=true
      runtime=true
      ;;
    apps/processing-worker/tests/*)
      analysis=true
      ;;
    apps/processing-worker/* | fly.analysis.toml | rust-toolchain.toml)
      # The assembled worker imports fixtures from src/**/tests.rs too.
      system_e2e=true
      analysis=true
      analysis_image=true
      ;;
    Dockerfile | deploy/* | fly.toml)
      system_e2e=true
      runtime=true
      ;;
    contracts/runtime-db-contract.json)
      system_e2e=true
      runtime=true
      go_runtime=true
      ;;
    contracts/runtime-tool-characterization-v1.json)
      go_runtime=true
      ;;
    apps/runtime/*_test.go)
      runtime=true
      ;;
    apps/runtime/*)
      system_e2e=true
      runtime=true
      ;;
    .dockerignore)
      system_e2e=true
      runtime=true
      analysis=true
      analysis_image=true
      ;;
    .momo-db-ref | scripts/ci/apply-momo-db-migrations.sh | scripts/ci/resolve-momo-db-migrations.sh)
      system_e2e=true
      api=true
      web=true
      analysis=true
      analysis_image=true
      runtime=true
      ;;
    .http4s-ref | scripts/ci/build-http4s-patch.sh)
      system_e2e=true
      api=true
      runtime=true
      http4s_patch=true
      ;;
    docs/schemas/*)
      select_all
      ;;
    package.json | pnpm-lock.yaml | pnpm-workspace.yaml)
      system_e2e=true
      web=true
      runtime=true
      [[ "${path}" != package.json ]] || policy_scripts=true
      ;;
    mise.toml)
      go_runtime=true
      go_tools=true
      select_all
      ;;
    scripts/e2e/runtime-smoke*.test.*)
      web=true
      runtime=true
      ;;
    scripts/e2e/*.test.*)
      web=true
      analysis=true
      analysis_image=true
      ;;
    scripts/e2e/runtime-smoke*)
      system_e2e=true
      web=true
      runtime=true
      ;;
    scripts/e2e/*)
      system_e2e=true
      web=true
      analysis=true
      analysis_image=true
      ;;
    scripts/ci/analysis-* | scripts/ci/ocr-rust-* | scripts/ci/processing-worker-* | \
      scripts/ci/series-analysis-*)
      analysis=true
      analysis_image=true
      ;;
    scripts/ci/check-pr-branch-policy.sh | scripts/ci/check-pr-ready.sh | \
      scripts/ci/classify-changes.sh | scripts/ci/classify-git-range.sh | \
      scripts/ci/extract-release-notes.sh | scripts/ci/runtime-release-notes.sh)
      ;;
    scripts/ci/runtime-* | scripts/ci/start-runtime-container.sh | \
      scripts/ci/validate-runtime-image.sh | scripts/ci/dockerfile-lint.sh)
      runtime=true
      ;;
    scripts/ci/ci-tool.sh | scripts/ci/build-ci-tool.sh | \
      scripts/ci/test-* | scripts/ci/check-policy.sh | \
      scripts/ci/load-analysis-candidate.sh | scripts/ci/load-runtime-image-artifact.sh | \
      scripts/ci/resolve-pushed-runtime-image.sh)
      ;;
    scripts/ci/actionlint.sh | scripts/ci/install-actionlint.sh | \
      scripts/ci/public-repo-safety-check.sh)
      [[ "${path}" == scripts/ci/public-repo-safety-check.sh ]] || actionlint=true
      ;;
    scripts/ci/*)
      go_runtime=true
      go_tools=true
      select_all
      ;;
    scripts/ops/analysis.sh | scripts/ops/analysis-maintain.sh)
      ;;
    .github/workflows/api.yml)
      api=true
      ;;
    .summit-ref | .github/workflows/system-e2e.yml)
      web=true
      system_e2e=true
      ;;
    .github/workflows/web.yml)
      web=true
      ;;
    .github/workflows/processing-worker.yml)
      analysis=true
      analysis_image=true
      ;;
    .github/workflows/analysis-production.yml)
      ;;
    .github/workflows/deploy.yml)
      runtime=true
      ;;
    .github/workflows/runtime-rollback.yml)
      ;;
    .github/workflows/runtime-release.yml)
      ;;
    .github/workflows/pr.yml)
      select_all
      ;;
    .github/workflows/workflow-lint.yml)
      go_runtime=true
      go_tools=true
      policy_scripts=true
      ;;
    .github/actions/setup-ci-tool/*)
      go_tools=true
      policy_scripts=true
      ;;
    .github/workflows/public-safety.yml | .github/actions/*)
      ;;
    scripts/tools/cmd/ci-tool/* | scripts/tools/internal/ci*/* | scripts/tools/go.mod | scripts/tools/go.sum)
      policy_scripts=true
      ;;
    scripts/tools/*)
      ;;

    .github/dependabot.yml | docs/* | *.md)
      ;;
    *)
      # Unknown paths fail closed by exercising every release-relevant gate.
      go_runtime=true
      go_tools=true
      select_all
      ;;
  esac
done

if [[ "${system_e2e}" == true ]]; then
  runtime=true
  analysis=true
  analysis_image=true
fi

if [[ "${actionlint}" == true || "${go_runtime}" == true || "${go_tools}" == true || "${policy_scripts}" == true ]]; then
  workflow=true
fi

printf 'api=%s\n' "${api}"
printf 'web=%s\n' "${web}"
printf 'analysis=%s\n' "${analysis}"
printf 'analysis_image=%s\n' "${analysis_image}"
printf 'runtime=%s\n' "${runtime}"
printf 'system_e2e=%s\n' "${system_e2e}"
printf 'http4s_patch=%s\n' "${http4s_patch}"
printf 'workflow=%s\n' "${workflow}"
printf 'actionlint=%s\n' "${actionlint}"
printf 'go_runtime=%s\n' "${go_runtime}"
printf 'go_tools=%s\n' "${go_tools}"
printf 'policy_scripts=%s\n' "${policy_scripts}"
