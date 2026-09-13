#!/usr/bin/env bash
set -euo pipefail

require_success() {
  local name="$1"
  local result="$2"
  if [[ "${result}" != "success" ]]; then
    echo "Required PR gate did not succeed: ${name}=${result}" >&2
    return 1
  fi
}

require_optional() {
  local name="$1"
  local expected="$2"
  local result="$3"
  local required_result="skipped"
  if [[ "${expected}" == "true" ]]; then
    required_result="success"
  elif [[ "${expected}" != "false" ]]; then
    echo "Invalid classifier output: ${name}=${expected}" >&2
    return 1
  fi
  if [[ "${result}" != "${required_result}" ]]; then
    echo "PR gate result mismatch: ${name} expected=${required_result} actual=${result}" >&2
    return 1
  fi
}

require_success classify "${CLASSIFY_RESULT:?}"
require_success branch-policy "${BRANCH_POLICY_RESULT:?}"
require_success public-safety "${PUBLIC_SAFETY_RESULT:?}"

# Release branches contain only a verified develop snapshot (and possibly its
# tree-preserving base sync). The exact master commit receives the final gates
# before any production mutation; do not repeat the application suites here.
if [[ "${PR_BASE_REF:-develop}" == "master" ]]; then
  for result in "${WORKFLOW_LINT_RESULT:?}" "${API_RESULT:?}" "${WEB_RESULT:?}" \
    "${ANALYSIS_RESULT:?}" "${RUNTIME_RESULT:?}"; do
    require_optional release-suite false "${result}"
  done
  echo "Release snapshot and public release information passed. Production gates run after merge."
  exit 0
fi

require_optional workflow-lint "${WORKFLOW_LINT_EXPECTED:?}" "${WORKFLOW_LINT_RESULT:?}"
require_optional api "${API_EXPECTED:?}" "${API_RESULT:?}"
require_optional web "${WEB_EXPECTED:?}" "${WEB_RESULT:?}"
require_optional analysis "${ANALYSIS_EXPECTED:?}" "${ANALYSIS_RESULT:?}"
require_optional runtime "${RUNTIME_EXPECTED:?}" "${RUNTIME_RESULT:?}"

echo "All required PR gates passed."
