#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  normal-status|normal-guard|bind-receipt|maintenance-guard) ;;
  *) echo 'Unsupported consumer maintenance control operation.' >&2; exit 2 ;;
esac
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
control_dir="${repo_root}/_deps/momo-maintenance-control"
revision="$(tr -d '\r\n' < "${repo_root}/scripts/ci/maintenance-control-ref.txt")"
[[ "${revision}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid maintenance control revision.' >&2; exit 1; }
actual="$(git -C "${control_dir}" rev-parse HEAD)"
[[ "${actual}" == "${revision}" ]] || { echo 'Maintenance control checkout does not match its pin.' >&2; exit 1; }
git -C "${control_dir}" diff --quiet HEAD -- scripts/maintenance
exec node "${control_dir}/scripts/maintenance/run.mjs" "$@"
