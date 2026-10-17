#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{start-deployed-machine,ci-tool}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}"
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'machine list')
    [[ "$3 $4 $5" == '--app fixture-app --json' ]]
    cat "${TEST_STATE}/machines.json"
    ;;
  'machine start')
    [[ "$3 $4 $5" == 'abc123 --app fixture-app' ]]
    cp "${TEST_STATE}/machines.json" "${TEST_STATE}/started.json"
    [[ ! -f "${TEST_STATE}/fail-start" ]] || exit 1
    jq '.[0].state = "started"' "${TEST_STATE}/machines.json" > "${TEST_STATE}/next.json"
    mv "${TEST_STATE}/next.json" "${TEST_STATE}/machines.json"
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/flyctl"
cd "${task_tmp}"
sha=0123456789abcdef0123456789abcdef01234567
for kind in runtime analysis frozen-runtime frozen-analysis; do
  repository=momo-result
  [[ "${kind}" != *analysis ]] || repository=momo-result-analysis
  image="registry.fly.io/${repository}@sha256:$(printf '%064d' 1)"
  args=("${kind}" fixture-app "${image}")
  if [[ "${kind}" == analysis ]]; then args+=("${sha}" worker-101-2 ocr-101-2); fi
  jq -n --arg image "${image}" --arg sha "${sha}" '[{
    id:"abc123",state:"stopped",config:{image:$image,
      guest:{cpu_kind:"shared",cpus:1,memory_mb:256},env:{
        MOMO_ANALYSIS_CONFIG_VERSION:("series-analysis-v1-"+$sha),
        MOMO_ANALYSIS_PUBLICATION_MODE:"enabled",MOMO_OCR_V2_CONSUMER_MODE:"enabled",
        MOMO_ANALYSIS_WORKER_ID:"worker-101-2",MOMO_OCR_V2_WORKER_ID:"ocr-101-2",MOMO_MAINTENANCE_MODE:"frozen"
      }}
  }]' > baseline.json
  cp baseline.json machines.json
  scripts/ci/start-deployed-machine.sh "${args[@]}"
  jq -e '.[0].state == "stopped"' started.json > /dev/null
  jq -e '.[0].state == "started"' machines.json > /dev/null
  rm started.json
  scripts/ci/start-deployed-machine.sh "${args[@]}"
  test ! -f started.json
  # Reject ambiguity and stale candidates before any start call.
  mutations=('.[0].config.image += "bad"' '. += .' '[]' '.[0].id = "--all"' '.[0].state = "suspended"')
  if [[ "${kind}" == analysis ]]; then
    mutations+=('.[0].config.env.MOMO_ANALYSIS_WORKER_ID = "worker-101-1"'
      '.[0].config.env.MOMO_OCR_V2_CONSUMER_MODE = "disabled"'
      '.[0].config.env.MOMO_ANALYSIS_CONFIG_VERSION = "old"')
  fi
  if [[ "${kind}" == frozen-* ]]; then
    mutations+=('.[0].config.env.MOMO_MAINTENANCE_MODE = "normal"')
  fi
  for mutation in "${mutations[@]}"; do
    jq "${mutation}" baseline.json > machines.json
    if scripts/ci/start-deployed-machine.sh "${args[@]}" > output 2>&1; then
      echo "An invalid ${kind} deployment was accepted." >&2
      exit 1
    fi
    test ! -f started.json
  done
  cp baseline.json machines.json
  touch fail-start
  if scripts/ci/start-deployed-machine.sh "${args[@]}" > output 2>&1; then
    echo 'A failed start was accepted.' >&2
    exit 1
  fi
  jq -e '.[0].state == "stopped"' machines.json > /dev/null
  rm fail-start started.json
done
echo 'Verified deployment start contracts passed.'
