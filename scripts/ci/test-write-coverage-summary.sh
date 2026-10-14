#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(mktemp -d)"
trap 'rm -rf "${root}"' EXIT
out="${root}/summary"
web="${root}/apps/web/coverage/coverage-summary.json"
api_dir="${root}/apps/api/target/out/jvm/scala-3.9.0/momo-result-api/scoverage-report"
api="${api_dir}/scoverage.xml"
mkdir -p "$(dirname "${web}")" "${api_dir}"

run() {
  local expected="$1" actual=0
  shift
  bash "${script_dir}/ci-tool.sh" coverage "$@" --root "${root}" --out "${out}" > /dev/null 2>&1 || actual=$?
  [[ "${actual}" == "${expected}" ]] || { echo "Expected ${expected}, got ${actual}: $*" >&2; exit 1; }
}
check() { jq -e "$1" "${out}/raw-summary.json" > /dev/null; }
web_report() {
  cat > "${web}" <<'JSON'
{"total": {
  "statements": {"covered": 1, "total": 3, "pct": 33.33},
  "branches": {"covered": 0, "total": 0, "pct": 100},
  "functions": {"covered": 0, "total": 0, "pct": "Unknown"},
  "lines": {"covered": 2, "total": 2, "pct": 100}
}}
JSON
}
api_report() {
  printf '%s\n' '<scoverage statement-count="3" statements-invoked="1" statement-rate="33.33" branch-rate="50.00"><packages/></scoverage>' > "${api}"
}

for subsystem in api web; do
  run 1 "${subsystem}"
  check '.status == "missing" and .metrics == {}'
  run 0 "${subsystem}" --allow-missing
  check '.status == "missing" and .metrics == {}'
done
web_report
run 0 web
check '.status == "ok" and .limitations == [] and .metrics == {
  statements: {pct: 33.3, covered: 1, total: 3}, branches: {pct: 100, covered: 0, total: 0},
  functions: {pct: null, covered: 0, total: 0}, lines: {pct: 100, covered: 2, total: 2}}'
grep -Fq '| functions | - | 0 / 0 |' "${out}/summary.md"
api_report
run 0 api
check '.status == "ok" and (.limitations | length) == 1 and .metrics == {
  statements: {pct: 33.3, covered: 1, total: 3}, branches: {pct: 50, covered: null, total: null}}'
grep -Fq '| branches | 50.0% | - |' "${out}/summary.md"
grep -Fq 'omitted from the measured totals' "${out}/summary.md"
# Go tests own metric partitions, XML parsing and ambiguous report discovery.
# The executable boundary retains stale-output replacement on invalid input.
printf '{broken' > "${web}"
run 1 web --allow-missing
check '.status == "invalid" and .metrics == {}'
if grep -Fq '| statements |' "${out}/summary.md"; then exit 1; fi
echo 'coverage summary contracts passed'
