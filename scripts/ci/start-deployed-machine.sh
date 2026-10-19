#!/usr/bin/env bash
# fly deploy can preserve a stopped machine. Start only the verified candidate.
set -euo pipefail
[[ "$#" -ge 3 ]] || { echo 'Usage: start-deployed-machine.sh runtime|analysis APP IMAGE_REF [RELEASE_SHA ANALYSIS_WORKER_ID OCR_WORKER_ID]' >&2; exit 2; }
kind="$1" app="$2"
shift 2
case "${kind}" in
  runtime) evidence=runtime-machine-id ;;
  analysis) evidence=analysis-machine-evidence ;;
  *) exit 2 ;;
esac
machine_id="$(flyctl machine list --app "${app}" --json |
  scripts/ci/ci-tool.sh "${kind}-machine-start-id" "$@")"
[[ -n "${machine_id}" ]] || exit 0
flyctl machine start "${machine_id}" --app "${app}"
deadline=$((SECONDS + 120))
until flyctl machine list --app "${app}" --json |
  scripts/ci/ci-tool.sh "${evidence}" "$@" > /dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo 'The verified deployment did not reach started state.' >&2
    exit 1
  fi
  sleep 2
done
