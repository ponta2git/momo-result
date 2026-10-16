#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
validator=("${repo_root}/scripts/ci/ci-tool.sh" postdeploy-evidence)
valid='{"event":"runtime_postdeploy_smoke","schemaVersion":1,"status":"ok","checks":["database","http","http2","processes","publicEdge","web"]}'
printf '%s\n' "${valid}" > "${test_dir}/evidence.json"
"${validator[@]}" "${test_dir}/evidence.json" --require-check publicEdge > "${test_dir}/out"
jq -e '. == {schemaVersion: 1, status: "ok"}' "${test_dir}/out" >/dev/null

reject() {
  local expected="$1"
  if "${validator[@]}" "${test_dir}/evidence.json" > "${test_dir}/out" 2> "${test_dir}/err"; then
    echo "Invalid evidence accepted: ${expected}" >&2
    exit 1
  fi
  [[ ! -s "${test_dir}/out" ]]
  jq -e --arg expected "${expected}" '.status == "failed" and .errorKind == $expected' "${test_dir}/err" >/dev/null
}
for mutation in \
  '.checks -= ["http2"]|MissingRequiredChecks' \
  '.checks += ["http"]|DuplicateChecks' \
  '.checks += ["bad\n"]|InvalidChecks' \
  '.schemaVersion = 2|UnsupportedSchemaVersion' \
  '.status = "failed"|UnhealthyStatus' \
  '.checks = {}|InvalidChecks' \
  '.event = "wrong"|InvalidEvent'; do
  printf '%s\n' "${valid}" | jq "${mutation%|*}" > "${test_dir}/evidence.json"
  reject "${mutation##*|}"
done
# Legacy reports may omit the version, but still require every current core check.
printf '%s\n' "${valid}" | jq 'del(.schemaVersion)' > "${test_dir}/evidence.json"
"${validator[@]}" "${test_dir}/evidence.json" >/dev/null
printf '%s\n%s\n' "${valid}" "${valid}" > "${test_dir}/evidence.json"
reject JSONDecodeError
printf 'private malformed content' > "${test_dir}/evidence.json"
reject JSONDecodeError
! grep -q private "${test_dir}/err"
printf '%s' "${valid}" > "${test_dir}/evidence.json"
head -c 1048577 /dev/zero | tr '\0' ' ' >> "${test_dir}/evidence.json"
reject JSONDecodeError
if "${validator[@]}" "${test_dir}/evidence.json" --require-check 'bad-check' > "${test_dir}/out" 2> "${test_dir}/err"; then
  exit 1
else
  [[ $? == 2 ]]
fi
echo 'Postdeploy evidence tests passed.'
