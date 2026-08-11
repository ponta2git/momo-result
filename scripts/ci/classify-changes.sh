#!/usr/bin/env bash
set -euo pipefail

api=false
web=false
ocr=false
analysis=false
runtime=false

select_all() {
  api=true
  web=true
  ocr=true
  analysis=true
  runtime=true
}

while IFS= read -r -d '' path; do
  case "${path}" in
    apps/api/openapi.yaml)
      api=true
      web=true
      runtime=true
      ;;
    apps/api/*)
      api=true
      runtime=true
      ;;
    apps/web/*)
      web=true
      runtime=true
      ;;
    apps/ocr-worker/*)
      ocr=true
      runtime=true
      ;;
    apps/analysis-worker/* | fly.analysis.toml | rust-toolchain.toml)
      analysis=true
      ;;
    Dockerfile | deploy/* | fly.toml)
      runtime=true
      ;;
    contracts/runtime-db-contract.json | contracts/runtime-tool-characterization-v1.json | \
      tools/cmd/momo-runtime-tool/*)
      runtime=true
      ;;
    .dockerignore)
      runtime=true
      analysis=true
      ;;
    .momo-db-ref | scripts/ci/apply-momo-db-migrations.sh)
      api=true
      ocr=true
      analysis=true
      runtime=true
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
    scripts/ci/analysis-*)
      analysis=true
      ;;
    scripts/ci/runtime-* | scripts/ci/test-runtime-evidence-scripts.py | \
      scripts/ci/start-runtime-container.sh | \
      scripts/ci/load-runtime-image-artifact.sh | scripts/ci/validate-runtime-image.sh | \
      scripts/ci/check-runtime-config.sh | scripts/ci/dockerfile-lint.sh)
      runtime=true
      ;;
    scripts/ci/actionlint.sh | scripts/ci/install-actionlint.sh | \
      scripts/ci/public-repo-safety-check.sh)
      ;;
    scripts/ci/*)
      select_all
      ;;
    .github/workflows/api.yml)
      api=true
      ;;
    .github/workflows/web.yml)
      web=true
      ;;
    .github/workflows/ocr-worker.yml)
      ocr=true
      ;;
    .github/workflows/analysis-worker.yml | .github/workflows/analysis-candidate.yml | \
      .github/workflows/analysis-production.yml)
      analysis=true
      ;;
    .github/workflows/deploy.yml | .github/workflows/runtime-rollback.yml)
      runtime=true
      ;;
    .github/workflows/pr.yml | .github/workflows/public-safety.yml | \
      .github/workflows/workflow-lint.yml | .github/actions/*)
      select_all
      ;;
    .github/dependabot.yml | docs/* | *.md)
      ;;
    *)
      # Unknown paths fail closed by exercising every release-relevant gate.
      select_all
      ;;
  esac
done

printf 'api=%s\n' "${api}"
printf 'web=%s\n' "${web}"
printf 'ocr=%s\n' "${ocr}"
printf 'analysis=%s\n' "${analysis}"
printf 'runtime=%s\n' "${runtime}"
