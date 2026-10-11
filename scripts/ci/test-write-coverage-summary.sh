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
sed 's/statement-count="3"/statement-count="223"/; s/statement-rate="33.33"/statement-rate="0.45"/' "${api}" > "${root}/report"
mv "${root}/report" "${api}"
run 0 api
check '.metrics.statements.pct == 0.4'

# Invalid input must overwrite a previous successful report, even when missing
# reports are allowed. Count inconsistencies must never become zero coverage.
for mutation in '.statements.pct = 101' '.statements.pct = 99' '.statements.pct = null' \
  '.statements.covered = 0.5' '.statements.covered = true' '.statements.covered = -1' \
  '.statements.covered = 4' '.branches.pct = 50' '.branches.pct = null' \
  'del(.statements.covered, .statements.total)'; do
  web_report
  jq ".total |= (${mutation})" "${web}" > "${root}/report"
  mv "${root}/report" "${web}"
  run 1 web --allow-missing
  check '.status == "invalid" and .metrics == {}'
  if grep -Fq '| statements |' "${out}/summary.md"; then exit 1; fi
done
for subsystem in web api; do
  if [[ "${subsystem}" == web ]]; then printf '{broken' > "${web}"; else printf '<broken' > "${api}"; fi
  run 1 "${subsystem}" --allow-missing
  check '.status == "invalid" and .metrics == {}'
done
api_report
sed 's/50.00/NaN/' "${api}" > "${root}/report"
mv "${root}/report" "${api}"
run 1 api
check '.status == "invalid"'
api_report
second="${root}/apps/api/target/out/jvm/scala-3.8.4/momo-result-api/scoverage-report"
mkdir -p "${second}"
cp "${api}" "${second}/scoverage.xml"
run 1 api --allow-missing
check '.status == "invalid" and (.message | contains("Ambiguous"))'
web_report
cat "${web}" "${web}" > "${root}/report"
mv "${root}/report" "${web}"
run 1 web
check '.status == "invalid"'
echo 'coverage summary contracts passed'
