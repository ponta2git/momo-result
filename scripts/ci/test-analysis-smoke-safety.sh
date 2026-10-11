#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=analysis-smoke-safety.sh
source "${repo_root}/scripts/ci/analysis-smoke-safety.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT

cat >"${test_dir}/worker.log" <<'EOF'
unstructured dependency failure with sensitive content
{"level":"ERROR","fields":{"event":"analysis_command_failed","error":"private connection detail","reason":"postgres://private-location","database_url":"private connection detail"}}
{"fields":{"event":"analysis_attempt_finished","outcome":"succeeded","job_id":"private identity","message":"private message"}}
{"fields":{"event":{"nested":"private value"},"reason":"private text with spaces"}}
EOF

analysis_smoke_print_worker_diagnostics "${test_dir}/worker.log" >"${test_dir}/summary.jsonl"
if ! jq -es '
  length == 2 and
  .[0] == {event: "analysis_command_failed"} and
  .[1] == {event: "analysis_attempt_finished", outcome: "succeeded"}
' "${test_dir}/summary.jsonl" >/dev/null; then
  echo "Analysis smoke diagnostics exposed free-form log content or lost safe event fields." >&2
  exit 1
fi

echo "Analysis smoke diagnostic safety tests passed."

# The caller uses this helper in a conditional, which disables errexit inside
# functions. A failed command must not be accepted just because it wrote output.
docker() {
  case "$*" in
    *'INFO server') printf 'run_id:fixture-id\r\n'; [[ "${failure:-}" != server ]] ;;
    *'CLIENT INFO') printf 'id=1 db=0 addr=fixture\n'; [[ "${failure:-}" != client ]] ;;
    *) return 2 ;;
  esac
}
[[ "$(analysis_smoke_redis_identity redis fixture)" == 'fixture-id|0' ]]
for failure in server client; do
  if analysis_smoke_redis_identity redis fixture > "${test_dir}/identity"; then
    echo "Redis identity accepted a failed ${failure} command." >&2
    exit 1
  fi
  [[ ! -s "${test_dir}/identity" ]]
done
echo 'Analysis smoke Redis identity failure contracts passed.'
