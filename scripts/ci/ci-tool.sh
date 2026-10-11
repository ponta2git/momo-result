#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${MOMO_CI_TOOL:?Build scripts/ci/build-ci-tool.sh once and set MOMO_CI_TOOL to its absolute output path.}"
[[ "${MOMO_CI_TOOL}" == /* && -f "${MOMO_CI_TOOL}" && -x "${MOMO_CI_TOOL}" ]] || { echo 'MOMO_CI_TOOL must name an executable file at an absolute path.' >&2; exit 1; }
exec "${MOMO_CI_TOOL}" --repo-root "${repo_root}" "$@"
