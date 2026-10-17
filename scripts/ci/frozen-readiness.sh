#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 3 ]] || { echo 'Usage: frozen-readiness.sh runtime|analysis IMAGE_REF OUTPUT_FILE' >&2; exit 2; }
role="$1" image_ref="$2" output="$3"
complete=false
trap 'if [[ "${complete}" != true ]]; then rm -f "${output}"; fi' EXIT
case "${role}" in
  runtime) app=momo-result; command='/opt/momo-result/bin/momo-runtime-tool smoke maintenance' ;;
  analysis) app=momo-result-analysis; command='/usr/local/bin/momo-processing-worker bootstrap -- maintenance-readiness' ;;
  *) exit 2 ;;
esac
# Inspect the persistent machine mode. The SSH command does not override it.
machine_id="$(flyctl machine list --app "${app}" --json |
  scripts/ci/ci-tool.sh frozen-machine-id "${role}" "${image_ref}")"
flyctl ssh console --app "${app}" --machine "${machine_id}" --pty=false --command "${command}" |
  scripts/ci/ci-tool.sh frozen-readiness-evidence "${role}" > "${output}"
# Recheck the selected machine, image, and persistent mode after the probe.
verified_id="$(flyctl machine list --app "${app}" --json |
  scripts/ci/ci-tool.sh frozen-machine-id "${role}" "${image_ref}")"
[[ "${machine_id}" == "${verified_id}" ]] || { rm -f "${output}"; echo 'Frozen machine identity changed during readiness.' >&2; exit 1; }
complete=true
