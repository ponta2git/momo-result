#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy_workflow="${repo_root}/.github/workflows/deploy.yml"
rollback_workflow="${repo_root}/.github/workflows/runtime-rollback.yml"

grep -Fq 'scripts/ci/runtime-postdeploy-contract.py' "${deploy_workflow}"
grep -Fq -- '--require-check publicEdge' "${deploy_workflow}"
grep -Fq 'scripts/ci/runtime-postdeploy-contract.py' "${rollback_workflow}"
grep -Fq 'MOMO_POSTDEPLOY_PUBLIC_EDGE=deferred' "${rollback_workflow}"
grep -Fq 'flyctl ssh sftp put' "${rollback_workflow}"
grep -Fq 'deploy/public_edge_probe.py' "${rollback_workflow}"
grep -Fq -- '--machine "${{ steps.deployment-state.outputs.machine_id }}"' \
  "${rollback_workflow}"

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
