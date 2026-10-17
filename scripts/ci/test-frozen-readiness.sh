#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{frozen-readiness,ci-tool}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}"
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'machine list') cat "${TEST_STATE}/machine.json" ;;
  'ssh console')
    [[ "$5 $6 $7" == '--machine a123 --pty=false' ]]
    [[ "$8" == --command ]]
    printf '%s\n' "$9" > "${TEST_STATE}/command"
    cat "${TEST_STATE}/readiness.json"
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/flyctl"
cd "${task_tmp}"
for role in runtime analysis; do
  repository=momo-result
  [[ "${role}" != analysis ]] || repository=momo-result-analysis
  image="registry.fly.io/${repository}@sha256:$(printf '%064d' 1)"
  jq -n --arg image "${image}" '[{id:"a123",state:"started",config:{image:$image,
    guest:{cpu_kind:"shared",cpus:1,memory_mb:256},env:{MOMO_MAINTENANCE_MODE:"frozen"}}}]' > baseline.json
  cp baseline.json machine.json
  if [[ "${role}" == runtime ]]; then
    printf '%s\n' '{"event":"runtime_maintenance_readiness","schemaVersion":1,"status":"ok","checks":["frozen_readiness","normal_routes_closed","database_contract","runtime_processes"]}' > readiness.json
  else
    printf '%s\n' '{"event":"worker_maintenance_readiness","schemaVersion":1,"status":"ready","mode":"frozen"}' > readiness.json
  fi
  scripts/ci/frozen-readiness.sh "${role}" "${image}" evidence.json
  jq -e --arg role "${role}" '.consumer == $role and .mode == "frozen" and .status == "ready"' evidence.json > /dev/null
  ! grep -q 'MOMO_MAINTENANCE_MODE=' command
  rm command evidence.json
  jq '.[0].config.env.MOMO_MAINTENANCE_MODE = "normal"' baseline.json > machine.json
  if scripts/ci/frozen-readiness.sh "${role}" "${image}" evidence.json > output 2>&1; then exit 1; fi
  test ! -f command
  test ! -f evidence.json
  cp baseline.json machine.json
  printf '%s\n' '{"schemaVersion":1,"status":"failed","private":"never-print"}' > readiness.json
  if scripts/ci/frozen-readiness.sh "${role}" "${image}" evidence.json > output 2>&1; then exit 1; fi
  test ! -f evidence.json
  ! grep -q never-print output
done
echo 'Frozen readiness uses persistent configuration and dedicated probes.'
