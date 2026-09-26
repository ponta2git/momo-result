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
