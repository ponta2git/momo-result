#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/bin" "${task_tmp}/scripts/ci"
cp "${repo_root}/scripts/ci/"{deploy-processing-worker,resolve-pushed-runtime-image,classify-git-range,classify-changes}.sh "${task_tmp}/scripts/ci/"
export TEST_STATE="${task_tmp}" PATH="${task_tmp}/bin:${PATH}" RUNNER_TEMP="${task_tmp}"
export ANALYSIS_RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
export ANALYSIS_IMAGE_REF="registry.fly.io/momo-result-analysis:${ANALYSIS_RELEASE_SHA}-101-2"
export GITHUB_RUN_ID=101 GITHUB_RUN_ATTEMPT=2
cat > "${task_tmp}/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1 $2" in
  'image inspect') printf '["registry.fly.io/momo-result-analysis@sha256:%064d"]\n' 1 ;;
  'manifest inspect') echo '{}' ;;
  'push '*) : ;;
  *) exit 1 ;;
esac
MOCK
cat > "${task_tmp}/bin/git" <<'MOCK'
#!/usr/bin/env bash
case "$1" in diff) [[ ! -f "${TEST_STATE}/changed" ]] || printf 'fly.analysis.toml\0' ;; esac
exit 0
MOCK
cat > "${task_tmp}/bin/flyctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  config|auth) : ;;
  secrets)
    status=Deployed
    [[ ! -f "${TEST_STATE}/staged" ]] || status=Staged
    jq -n --arg status "${status}" '[{name:"MOMO_ANALYSIS_OUTBOX_LISTENER_DATABASE_URL",status:$status}]'
    ;;
  machine)
    digest=1
    [[ ! -f "${TEST_STATE}/different" ]] || digest=2
    printf '{"state":"started","config":{"image":"registry.fly.io/momo-result-analysis@sha256:%064d","guest":{"cpu_kind":"shared","cpus":1,"memory_mb":256},"env":{"MOMO_ANALYSIS_CONFIG_VERSION":"series-analysis-v1-%040d","MOMO_ANALYSIS_PUBLICATION_MODE":"enabled","MOMO_OCR_V2_CONSUMER_MODE":"enabled"}}}\n' "${digest}" 1 | jq -s .
    ;;
  deploy)
    printf '%s\n' "$*" > "${TEST_STATE}/deploy"
    exit 42 # Stop at the mutation boundary. No provider calls occur in this test.
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "${task_tmp}/bin/"*
cd "${task_tmp}"
scripts/ci/deploy-processing-worker.sh > output 2>&1
test ! -f deploy
jq -e '.status == "not_needed"' analysis-production-artifact/worker-deployment.json > /dev/null
for condition in staged changed different; do
  : > "${condition}"
  status=0
  scripts/ci/deploy-processing-worker.sh > output 2>&1 || status=$?
  test "${status}" = 42
  grep -qF -- '--image registry.fly.io/momo-result-analysis@sha256:' deploy
  rm "${condition}" deploy
done
printf 'Worker deployment reuse and immutable rollout tests passed.\n'
