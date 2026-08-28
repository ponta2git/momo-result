#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="${repo_root}/scripts/ci/check-pr-ready.sh"

run_checker() {
  CLASSIFY_RESULT="${CLASSIFY_RESULT:-success}" \
    PUBLIC_SAFETY_RESULT="${PUBLIC_SAFETY_RESULT:-success}" \
    WORKFLOW_LINT_EXPECTED="${WORKFLOW_LINT_EXPECTED:-false}" \
    WORKFLOW_LINT_RESULT="${WORKFLOW_LINT_RESULT:-skipped}" \
    API_EXPECTED="${API_EXPECTED:-false}" API_RESULT="${API_RESULT:-skipped}" \
    WEB_EXPECTED="${WEB_EXPECTED:-false}" WEB_RESULT="${WEB_RESULT:-skipped}" \
    ANALYSIS_EXPECTED="${ANALYSIS_EXPECTED:-false}" ANALYSIS_RESULT="${ANALYSIS_RESULT:-skipped}" \
    RUNTIME_EXPECTED="${RUNTIME_EXPECTED:-false}" RUNTIME_RESULT="${RUNTIME_RESULT:-skipped}" \
    "${checker}"
}

run_checker >/dev/null
API_EXPECTED=true API_RESULT=success run_checker >/dev/null
WORKFLOW_LINT_EXPECTED=true WORKFLOW_LINT_RESULT=success run_checker >/dev/null
if API_EXPECTED=true API_RESULT=skipped run_checker >/dev/null 2>&1; then
  echo "Expected checker to reject a skipped required API gate." >&2
  exit 1
fi
if PUBLIC_SAFETY_RESULT=failure run_checker >/dev/null 2>&1; then
  echo "Expected checker to reject a failed always-required gate." >&2
  exit 1
fi
if WORKFLOW_LINT_EXPECTED=true WORKFLOW_LINT_RESULT=skipped run_checker >/dev/null 2>&1; then
  echo "Expected checker to reject skipped workflow tooling checks." >&2
  exit 1
fi

echo "PR readiness checker tests passed."
