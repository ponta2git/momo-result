#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '{"event":"runtime_postdeploy_evidence_validation","status":"failed","errorKind":"%s"}\n' "$1" >&2
  exit "${2:-1}"
}

[[ $# -ge 1 && -n "$1" ]] || fail InvalidArguments 2
path="$1"
shift
required='["database","http","http2","processes","redis","web"]'
while (( $# )); do
  [[ $# -ge 2 && "$1" == --require-check ]] || fail InvalidArguments 2
  [[ "$2" =~ ^[A-Za-z][A-Za-z0-9]*$ ]] || fail InvalidRequiredCheck 2
  required="$(jq -cn --argjson checks "${required}" --arg check "$2" '$checks + [$check]')"
  shift 2
done

[[ -f "${path}" && -r "${path}" ]] || fail FileError
# Read at most the existing 1 MiB contract plus one byte, rejecting suffixes.
size="$(head -c 1048577 "${path}" | LC_ALL=C wc -c)" || fail FileError
(( size <= 1048576 )) || fail JSONDecodeError
error_kind="$(jq -sr --argjson required "${required}" '
  def check_name: if type == "string" then test("^[A-Za-z][A-Za-z0-9]*\\z") else false end;
  if length != 1 then "JSONDecodeError"
  else .[0] |
    if type != "object" then "InvalidPayload"
    elif .event != "runtime_postdeploy_smoke" then "InvalidEvent"
    elif has("schemaVersion") and .schemaVersion != 1 then "UnsupportedSchemaVersion"
    elif .status != "ok" then "UnhealthyStatus"
    elif (.checks | type) != "array" then "InvalidChecks"
    elif (.checks | all(check_name) | not) then "InvalidChecks"
    elif (.checks | length) != (.checks | unique | length) then "DuplicateChecks"
    elif ($required - .checks | length) != 0 then "MissingRequiredChecks"
    else "" end
  end
' "${path}" 2>/dev/null)" || fail JSONDecodeError
[[ -z "${error_kind}" ]] || fail "${error_kind}"
printf '{"schemaVersion":1,"status":"ok"}\n'
