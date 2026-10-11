#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"
shopt -s nullglob
shell_files=(scripts/ci/*.sh scripts/ops/*.sh)
contracts=(scripts/ci/test-*.sh)
[[ ${#contracts[@]} -gt 0 ]] || { echo 'No shell contract suites were discovered.' >&2; exit 1; }

status=0
for script in "${shell_files[@]}"; do
  bash -n "${script}" || status=1
done

# Each contract isolates its fixtures and command doubles. Keep output separate,
# report every failure, and bound the number of concurrent child processes.
logs="$(mktemp -d)"
trap 'rm -rf "${logs}"' EXIT
if [[ -z "${MOMO_CI_TOOL:-}" ]]; then
  scripts/ci/build-ci-tool.sh "${logs}/ci-tool"
  export MOMO_CI_TOOL="${logs}/ci-tool"
fi
pids=()
paths=()
collect() {
  local index
  for index in "${!pids[@]}"; do
    if wait "${pids[index]}"; then
      printf 'PASS %s\n' "${paths[index]}"
    else
      printf 'FAIL %s\n' "${paths[index]}" >&2
      cat "${logs}/${index}" >&2
      status=1
    fi
  done
  pids=()
  paths=()
}
for script in "${contracts[@]}"; do
  bash "${script}" > "${logs}/${#pids[@]}" 2>&1 &
  pids+=("$!")
  paths+=("${script}")
  if [[ ${#pids[@]} -eq 4 ]]; then collect; fi
done
if [[ ${#pids[@]} -gt 0 ]]; then collect; fi
exit "${status}"
