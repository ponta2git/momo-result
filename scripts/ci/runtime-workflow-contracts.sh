#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy_workflow="${repo_root}/.github/workflows/deploy.yml"
rollback_workflow="${repo_root}/.github/workflows/runtime-rollback.yml"

grep -Fq 'validate-postdeploy-evidence' "${deploy_workflow}"
grep -Fq -- '--require-check publicEdge' "${deploy_workflow}"
grep -Fq 'validate-postdeploy-evidence' "${rollback_workflow}"
grep -Fq 'MOMO_POSTDEPLOY_PUBLIC_EDGE=deferred' "${rollback_workflow}"
grep -Fq 'flyctl ssh sftp put' "${rollback_workflow}"
grep -Fq 'momo-runtime-tool smoke edge' "${rollback_workflow}"
grep -Fq -- '--machine "${{ steps.deployment-state.outputs.machine_id }}"' \
  "${rollback_workflow}"

if [[ "$(grep -Fc 'RUNTIME_MEMORY_LIMIT: "512m"' "${deploy_workflow}")" != "2" ]] ||
  [[ "$(grep -Fc 'RUNTIME_CPU_LIMIT: "2"' "${deploy_workflow}")" != "2" ]] ||
  [[ "$(grep -Fc 'run: scripts/ci/runtime-memory-smoke.sh' "${deploy_workflow}")" != "2" ]]; then
  echo "Every runtime E2E job must enforce the bounded JVM resource gate." >&2
  exit 1
fi

if [[ "$(grep -Fc 'artifact-ids: ${{ needs.runtime-image.outputs.artifact_id }}' \
  "${deploy_workflow}")" != "2" ]] ||
  [[ "$(grep -Fc 'RUNTIME_CANDIDATE_RUN_ATTEMPT: ${{ needs.runtime-image.outputs.run_attempt }}' \
  "${deploy_workflow}")" != "3" ]]; then
  echo "Runtime candidate consumers must use the producer artifact ID and candidate attempt." >&2
  exit 1
fi
grep -Fq 'scripts/ci/validate-runtime-release-selection.sh' "${deploy_workflow}"
grep -Fq 'sourceRunAttempt: $sourceRunAttempt' "${deploy_workflow}"
if grep -Fq '"${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required.}"' \
  "${repo_root}/scripts/ci/load-runtime-image-artifact.sh"; then
  echo "Runtime candidate loading must not derive producer identity from the consumer attempt." >&2
  exit 1
fi

if grep -Fq 'curl -fsS --retry' "${rollback_workflow}"; then
  echo "Runtime rollback must not use a shared CI runner as the public-edge oracle." >&2
  exit 1
fi

if grep -Fq '.checks == ["database", "http", "processes", "redis", "web"]' \
  "${rollback_workflow}"; then
  echo "Runtime rollback must not hard-code one target image's smoke check list." >&2
  exit 1
fi

echo "Runtime workflow contract tests passed."
