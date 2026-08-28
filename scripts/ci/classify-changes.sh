#!/usr/bin/env bash
set -euo pipefail

api=false
web=false
analysis=false
analysis_image=false
runtime=false
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
}

while IFS= read -r -d '' path; do
  [[ "${path}" == scripts/ci/* ]] && policy_scripts=true
  [[ "${path}" == .github/workflows/* || "${path}" == .github/actions/* ]] && actionlint=true
  [[ "${path}" == tools/* ]] && go_tools=true

  case "${path}" in
    apps/api/openapi.yaml)
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
      api=true
      runtime=true
      ;;
    apps/web/src/test/* | apps/web/src/*.test.* | apps/web/src/*.spec.* | \
      apps/web/scripts/* | apps/web/oxlint.config.ts | apps/web/vitest.config.*)
      web=true
      ;;
    apps/web/*)
      web=true
      runtime=true
      ;;
    apps/processing-worker/tests/*)
      analysis=true
      ;;
    apps/processing-worker/* | fly.analysis.toml | rust-toolchain.toml)
      analysis=true
      analysis_image=true
      ;;
    Dockerfile | deploy/* | fly.toml)
      runtime=true
      ;;
    contracts/runtime-db-contract.json)
      runtime=true
      go_tools=true
      ;;
    contracts/runtime-tool-characterization-v1.json)
      go_tools=true
      ;;
    tools/go.mod | tools/go.sum | tools/cmd/momo-runtime-tool/*)
      runtime=true
      ;;
    .dockerignore)
      runtime=true
      analysis=true
      analysis_image=true
      ;;
    .momo-db-ref | scripts/ci/apply-momo-db-migrations.sh)
      api=true
      analysis=true
      analysis_image=true
      runtime=true
      ;;
    .http4s-ref | scripts/ci/build-http4s-patch.sh)
      api=true
      runtime=true
      http4s_patch=true
      ;;
    docs/schemas/*)
      select_all
      ;;
    package.json | pnpm-lock.yaml | pnpm-workspace.yaml)
      web=true
      runtime=true
      ;;
    mise.toml)
      select_all
      ;;
    scripts/ci/analysis-* | scripts/ci/ocr-rust-* | scripts/ci/processing-worker-* | \
      scripts/ci/series-analysis-*)
      analysis=true
      analysis_image=true
      ;;
    scripts/ci/runtime-* | scripts/ci/start-runtime-container.sh | \
      scripts/ci/summarize-runtime-logs.sh | \
      scripts/ci/validate-runtime-image.sh | scripts/ci/dockerfile-lint.sh)
      runtime=true
      ;;
    scripts/ci/write-coverage-summary.py)
      api=true
      web=true
      ;;
    scripts/ci/test-* | scripts/ci/canonicalize-artifact-digest.sh | \
      scripts/ci/check-pr-ready.sh | scripts/ci/classify-changes.sh | \
      scripts/ci/load-* | scripts/ci/resolve-* | scripts/ci/sanitize-* | \
      scripts/ci/validate-*)
      ;;
    scripts/ci/actionlint.sh | scripts/ci/install-actionlint.sh | \
      scripts/ci/public-repo-safety-check.sh)
      [[ "${path}" == scripts/ci/public-repo-safety-check.sh ]] || actionlint=true
      ;;
    scripts/ci/*)
      select_all
      ;;
    scripts/dev-local.mjs | scripts/dev-local.test.mjs)
      policy_scripts=true
      ;;
    .github/workflows/api.yml)
      api=true
      ;;
    .github/workflows/web.yml)
      web=true
      ;;
    .github/workflows/processing-worker.yml)
      analysis=true
      analysis_image=true
      ;;
    .github/workflows/analysis-candidate.yml | .github/workflows/analysis-production.yml)
      ;;
    .github/workflows/deploy.yml)
      runtime=true
      ;;
    .github/workflows/runtime-rollback.yml)
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
    tools/*)
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
printf 'http4s_patch=%s\n' "${http4s_patch}"
printf 'workflow=%s\n' "${workflow}"
printf 'actionlint=%s\n' "${actionlint}"
printf 'go_tools=%s\n' "${go_tools}"
printf 'policy_scripts=%s\n' "${policy_scripts}"
