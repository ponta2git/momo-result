#!/usr/bin/env bash
set -euo pipefail

api=false
web=false
analysis=false
analysis_image=false
runtime=false
# Assembled OCR inputs are independent of each application quality gate.
ocr_notifications=false
http4s_patch=false
actionlint=false
go_tools=false
policy_scripts=false
workflow=false

select_all() {
  api=true
  web=true
  analysis=true
  analysis_image=true
  runtime=true
  ocr_notifications=true
}

while IFS= read -r -d '' path; do
  [[ "${path}" == scripts/ci/* || "${path}" == scripts/ops/* ]] && policy_scripts=true
  [[ "${path}" == .github/workflows/* || "${path}" == .github/actions/* ]] && actionlint=true
  [[ "${path}" == scripts/tools/* || "${path}" == apps/runtime/* ]] && go_tools=true

  case "${path}" in
    apps/api/openapi.yaml)
      ocr_notifications=true
      api=true
      web=true
      ;;
    apps/api/redocly.yaml)
      web=true
      ;;
    apps/api/src/test/*)
      api=true
      ;;
    apps/api/*)
      ocr_notifications=true
      api=true
      runtime=true
      ;;
    apps/web/src/test/factories/* | apps/web/src/test/msw/fixtures.ts | \
      apps/web/src/test/msw/seriesAnalysisFixtures.ts | apps/web/src/test/deferred.ts)
      ocr_notifications=true
      # Playwright imports these fixtures directly. Vitest cannot establish that
      # the assembled browser scenarios still accept the changed inputs.
      web=true
      runtime=true
      ;;
    apps/web/scripts/e2e/*.test.*)
      web=true
      runtime=true
      ;;
    apps/web/scripts/e2e/* | apps/web/scripts/process.mts)
      ocr_notifications=true
      web=true
      runtime=true
      ;;
    apps/web/src/test/* | apps/web/src/*.test.* | apps/web/src/*.spec.* | \
      apps/web/scripts/* | apps/web/oxlint.config.ts | apps/web/vitest.config.*)
      web=true
      ;;
    apps/web/*)
      ocr_notifications=true
      web=true
      runtime=true
      ;;
    apps/processing-worker/tests/*)
      analysis=true
      ;;
    apps/processing-worker/* | fly.analysis.toml | rust-toolchain.toml)
      # The assembled worker imports fixtures from src/**/tests.rs too.
      ocr_notifications=true
      analysis=true
      analysis_image=true
      ;;
    Dockerfile | deploy/* | fly.toml)
      ocr_notifications=true
      runtime=true
      ;;
    contracts/runtime-db-contract.json)
      ocr_notifications=true
      runtime=true
      go_tools=true
      ;;
    contracts/runtime-tool-characterization-v1.json)
      go_tools=true
      ;;
    apps/runtime/*_test.go)
      runtime=true
      ;;
    apps/runtime/*)
      ocr_notifications=true
      runtime=true
      ;;
    .dockerignore)
      ocr_notifications=true
      runtime=true
      analysis=true
      analysis_image=true
      ;;
    .momo-db-ref | scripts/ci/apply-momo-db-migrations.sh | scripts/ci/resolve-momo-db-migrations.sh)
      ocr_notifications=true
      api=true
      web=true
      analysis=true
      analysis_image=true
      runtime=true
      ;;
    .http4s-ref | scripts/ci/build-http4s-patch.sh)
      ocr_notifications=true
      api=true
      runtime=true
      http4s_patch=true
      ;;
    docs/schemas/*)
      select_all
      ;;
    package.json | pnpm-lock.yaml | pnpm-workspace.yaml)
      ocr_notifications=true
      web=true
      runtime=true
      [[ "${path}" != package.json ]] || policy_scripts=true
      ;;
    mise.toml)
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
      ocr_notifications=true
      web=true
      runtime=true
      ;;
    scripts/e2e/*)
      ocr_notifications=true
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
      scripts/ci/summarize-runtime-logs.sh | \
      scripts/ci/validate-runtime-image.sh | scripts/ci/dockerfile-lint.sh)
      runtime=true
      ;;
    scripts/ci/write-coverage-summary.sh)
      api=true
      web=true
      ;;
    scripts/ci/test-* | scripts/ci/check-policy.sh | scripts/ci/canonicalize-artifact-digest.sh | \
      scripts/ci/load-analysis-candidate.sh | scripts/ci/load-runtime-image-artifact.sh | \
      scripts/ci/resolve-pushed-runtime-image.sh | scripts/ci/sanitize-analysis-report.sh | \
      scripts/ci/validate-analysis-candidate.sh | scripts/ci/validate-analysis-worker-readiness.sh | \
      scripts/ci/validate-runtime-candidate.sh | scripts/ci/validate-runtime-deployment.sh | \
      scripts/ci/validate-runtime-release-selection.sh | scripts/ci/validate-postdeploy-evidence.sh)
      ;;
    scripts/ci/actionlint.sh | scripts/ci/install-actionlint.sh | \
      scripts/ci/public-repo-safety-check.sh)
      [[ "${path}" == scripts/ci/public-repo-safety-check.sh ]] || actionlint=true
      ;;
    scripts/ci/*)
      select_all
      ;;
    scripts/ops/analysis.sh | scripts/ops/analysis-maintain.sh)
      ;;
    .github/workflows/api.yml)
      api=true
      ;;
    .summit-ref | .github/workflows/ocr-notifications.yml)
      web=true
      ocr_notifications=true
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
      go_tools=true
      policy_scripts=true
      ;;
    .github/workflows/public-safety.yml | .github/actions/*)
      ;;
    scripts/tools/*)
      ;;
    .github/dependabot.yml | docs/* | *.md)
      ;;
    *)
      # Unknown paths fail closed by exercising every release-relevant gate.
      select_all
      ;;
  esac
done

if [[ "${actionlint}" == true || "${go_tools}" == true || "${policy_scripts}" == true ]]; then
  workflow=true
fi

printf 'api=%s\n' "${api}"
printf 'web=%s\n' "${web}"
printf 'analysis=%s\n' "${analysis}"
printf 'analysis_image=%s\n' "${analysis_image}"
printf 'runtime=%s\n' "${runtime}"
printf 'ocr_notifications=%s\n' "${ocr_notifications}"
printf 'http4s_patch=%s\n' "${http4s_patch}"
printf 'workflow=%s\n' "${workflow}"
printf 'actionlint=%s\n' "${actionlint}"
printf 'go_tools=%s\n' "${go_tools}"
printf 'policy_scripts=%s\n' "${policy_scripts}"
