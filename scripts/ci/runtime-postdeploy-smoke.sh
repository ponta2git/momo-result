#!/usr/bin/env bash
set -euo pipefail

evidence_dir=runtime-production-evidence
mkdir -p "${evidence_dir}"
rm -f "${evidence_dir}/postdeploy-smoke.json" "${evidence_dir}/public-health.json"
smoke_pending="${evidence_dir}/postdeploy-smoke.pending.json"
health_pending="${evidence_dir}/public-health.pending.json"
trap 'rm -f "${smoke_pending}" "${health_pending}"' EXIT

# A started machine can still be initializing its application processes.
# Keep the full deployed-candidate smoke, including the public edge contract.
deadline=$((SECONDS + 120))
until flyctl ssh console --app momo-result --pty=false --quiet \
  --command "/opt/momo-result/bin/momo-runtime-tool smoke local" \
  > "${smoke_pending}"; do
  if (( SECONDS >= deadline )); then
    echo 'Runtime did not pass the full post-deploy smoke before the readiness deadline.' >&2
    exit 1
  fi
  sleep 2
done
scripts/ci/ci-tool.sh postdeploy-evidence "${smoke_pending}" \
  --require-check publicEdge > "${health_pending}"
mv "${smoke_pending}" "${evidence_dir}/postdeploy-smoke.json"
mv "${health_pending}" "${evidence_dir}/public-health.json"
