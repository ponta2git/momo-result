#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
mkdir -p "${task_tmp}/scripts/ci" "${task_tmp}/_deps/momo-maintenance-control/scripts/maintenance"
cp "${repo_root}/scripts/ci/maintenance-control.sh" "${task_tmp}/scripts/ci/"
control="${task_tmp}/_deps/momo-maintenance-control"
cat > "${control}/scripts/maintenance/run.mjs" <<'JS'
process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\n');
JS
git -C "${control}" init -q
git -C "${control}" add scripts/maintenance/run.mjs
git -C "${control}" -c user.name=Fixture -c user.email=fixture@example.invalid \
  -c commit.gpgsign=false commit -qm fixture
git -C "${control}" rev-parse HEAD > "${task_tmp}/scripts/ci/maintenance-control-ref.txt"
wrapper="${task_tmp}/scripts/ci/maintenance-control.sh"
actual="$("${wrapper}" bind-receipt consumers 'input with spaces.json' 'output with spaces.json')"
[[ "${actual}" == '["bind-receipt","consumers","input with spaces.json","output with spaces.json"]' ]]
[[ "$("${wrapper}" normal-status)" == '["normal-status"]' ]]
[[ "$("${wrapper}" status)" == '["status"]' ]]

reject() {
  if "${wrapper}" "$@" > "${task_tmp}/output" 2> "${task_tmp}/error"; then
    echo 'An unpinned or unsupported control invocation was accepted.' >&2
    exit 1
  fi
  test ! -s "${task_tmp}/output"
}
reject transition 1 close payload.json
printf '%s\n' 'process.stdout.write("unreviewed-control");' >> "${control}/scripts/maintenance/run.mjs"
reject normal-guard
git -C "${control}" restore scripts/maintenance/run.mjs
printf '%040d\n' 0 > "${task_tmp}/scripts/ci/maintenance-control-ref.txt"
reject maintenance-guard consumers receipt.json
printf '%s\n' master > "${task_tmp}/scripts/ci/maintenance-control-ref.txt"
reject normal-status
rm "${task_tmp}/scripts/ci/maintenance-control-ref.txt"
reject normal-status
echo 'Pinned maintenance control invocation contracts passed.'
