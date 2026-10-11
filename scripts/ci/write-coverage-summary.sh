#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

usage() { echo "Usage: $0 <web|api> [--root directory] --out directory [--allow-missing]" >&2; exit 2; }
[[ $# -gt 0 ]] || usage
subsystem="$1"
shift
case "${subsystem}" in web | api) ;; *) usage ;; esac
root=.
out=
allow_missing=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root | --out)
      [[ $# -ge 2 && -n "$2" ]] || usage
      if [[ "$1" == --root ]]; then root="$2"; else out="$2"; fi
      shift 2
      ;;
    --allow-missing) allow_missing=true; shift ;;
    *) usage ;;
  esac
done
[[ -n "${out}" ]] || usage
mkdir -p "${out}"
status=ok
message=
report=
metrics='{}'

if [[ "${subsystem}" == web ]]; then
  report=apps/web/coverage/coverage-summary.json
else
  shopt -s nullglob
  reports=("${root}"/apps/api/target/out/jvm/scala-*/momo-result-api/scoverage-report/scoverage.xml)
  case ${#reports[@]} in
    0) status=missing; message='Coverage report not found under apps/api/target.' ;;
    1) report="${reports[0]#"${root}"/}" ;;
    *) status=invalid; message='Ambiguous Scala coverage reports.' ;;
  esac
fi
if [[ "${status}" == ok && ! -f "${root}/${report}" ]]; then
  status=missing
  message="Coverage report not found: ${report}"
fi

read_metrics() {
  if [[ "${subsystem}" == web ]]; then
    # Slurp prevents a concatenated stream of JSON documents being mistaken for
    # one report (or silently leaving a previous valid result in the summary).
    jq -es 'if length == 1 then .[0].total | {statements, branches, functions, lines} |
        if all(.[]; has("pct") and has("covered") and has("total")) then .
        else error("missing coverage fields") end
      else error("expected one coverage report") end' "${root}/${report}"
  else
    # Parse XML rather than matching attributes with a regular expression.
    local attributes
    attributes="$(xmllint --nonet --xpath \
      'concat(name(/*), "|", /scoverage/@statement-rate, "|", /scoverage/@statements-invoked, "|", /scoverage/@statement-count, "|", /scoverage/@branch-rate)' \
      "${root}/${report}")" || return 1
    jq -en --arg attributes "${attributes}" '
      ($attributes | split("|")) as $a |
      if $a[0] != "scoverage" then error("expected scoverage XML") else
        {statements: {pct: ($a[1]|tonumber), covered: ($a[2]|tonumber), total: ($a[3]|tonumber)},
         branches: {pct: ($a[4]|tonumber), covered: null, total: null}}
      end'
  fi
}

if [[ "${status}" == ok ]]; then
  if metrics="$(read_metrics 2>/dev/null | jq -e '
    def number: type == "number" and isfinite;
    def count: number and . >= 0 and floor == .;
    def percentage: number and . >= 0 and . <= 100;
    with_entries(.value |= (
      if .pct == "Unknown" and .covered == 0 and .total == 0 then .pct = null
      elif (.pct | percentage) then . else error("invalid coverage percentage") end |
      if (.pct == null or (.pct | percentage)) and
        (if .covered == null and .total == null then .pct != null
         else (.covered | count) and (.total | count) and .covered <= .total and
           (if .total == 0 then (.pct == null or .pct == 0 or .pct == 100)
            else (.pct != null and ((.pct - 100 * .covered / .total) | fabs) <= 0.010000001) end)
         end)
      then {pct: (if .pct == null then null
                  elif .total > 0 then (1000 * .covered / .total | round) / 10
                  else (.pct * 10 | round) / 10 end), covered, total}
      else error("invalid coverage percentage or counts") end
    ))' 2>/dev/null)"; then
    :
  else
    status=invalid
    message='Invalid coverage report.'
    metrics='{}'
  fi
fi

jq -n --arg subsystem "${subsystem}" --arg status "${status}" \
  --arg message "${message}" --arg report "${report}" --argjson metrics "${metrics}" '
  {generatedAt: (now | todateiso8601), subsystem: $subsystem, status: $status,
   message: (if $message == "" then null else $message end),
   limitations: (if $subsystem == "api" and $status == "ok" then
     ["API coverage is diagnostic. Scala may omit oversized endpoint/schema initializers; compiler diagnostics identify each initializer omitted from the measured totals."]
     else [] end),
   sourceReports: (if $status == "ok" then [$report] else [] end), metrics: $metrics}
' > "${out}/raw-summary.json"
{
  printf '## Coverage Summary: %s\n\n' "${subsystem}"
  if [[ "${status}" != ok ]]; then
    printf 'Coverage report is unavailable: %s\n' "${message}"
  else
    printf '| Metric | Coverage | Covered / Total |\n|---|---:|---:|\n'
    while IFS=$'\t' read -r name pct covered total; do
      if [[ "${pct}" != - ]]; then pct="$(printf '%.1f%%' "${pct}")"; fi
      if [[ "${covered}" != - ]]; then covered="${covered} / ${total}"; fi
      printf '| %s | %s | %s |\n' "${name}" "${pct}" "${covered}"
    done < <(jq -r '.metrics | to_entries[] | [.key, (.value.pct // "-"), (.value.covered // "-"), (.value.total // "-")] | @tsv' "${out}/raw-summary.json")
    printf '\n'
    jq -r '.limitations[] + "\n"' "${out}/raw-summary.json"
  fi
} > "${out}/summary.md"
if [[ "${status}" == invalid || ( "${status}" == missing && "${allow_missing}" == false ) ]]; then
  echo "${message}" >&2
  exit 1
fi
