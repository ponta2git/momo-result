#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
cat <<'LOGS' | "${repo_root}/scripts/ci/ci-tool.sh" runtime-logs > "${test_dir}/summary"
{"app":"api","level":"ERROR","message":"private content","exception_classes":["RuntimeException"]}
{"app":"api","level":"ERROR","message":"private content","exception_classes":["RuntimeException",17]}
unstructured private content
null
[]
{"app":"invalid\n","exception_classes":"not-an-array"}
LOGS
jq -e '.schemaVersion == 1 and .unstructuredLineCount == 3 and
  .exceptionClasses == {RuntimeException: 2, UnknownError: 1} and
  .records == [
    {app:"api",component:"unknown",level:"ERROR",event:"none",count:2},
    {app:"unknown",component:"unknown",level:"unknown",event:"none",count:1}
  ]' "${test_dir}/summary" >/dev/null
! grep -q private "${test_dir}/summary"
"${repo_root}/scripts/ci/ci-tool.sh" runtime-logs < /dev/null |
  jq -e '.records == [] and .exceptionClasses == {} and .unstructuredLineCount == 0' >/dev/null
echo 'Runtime log summary tests passed.'
