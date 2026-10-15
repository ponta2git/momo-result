#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${OCR_CONTROL_SMOKE_DATABASE_URL:?an isolated OCR_CONTROL_SMOKE_DATABASE_URL is required}"

if [[ "${ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED:-}" != "true" ]]; then
  echo "ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED=true is required." >&2
  exit 1
fi

migrations_dir="${MOMO_DB_MIGRATIONS_DIR:-${repo_root}/_deps/momo-db/drizzle}"
shared_fixture="${migrations_dir%/drizzle}/docs/examples/ocr-completed-v2.json"
if ! cmp -s "${shared_fixture}" "${repo_root}/apps/processing-worker/testdata/ocr-submission-v2.json"; then
  echo "OCR v2 producer fixture must match the momo-db shared wire contract." >&2
  exit 1
fi

tests=(
  "worker::runtime::reconciliation_tests::real_postgres_reconciliation_continues_during_a_waiting_worker_operation"
  "ocr::submissions::runtime::integration_tests::real_postgres_preserves_submission_finalization_and_recovery"
  "ocr::control::integration_tests::real_postgres_preserves_ocr_fencing_and_bounded_recovery"
)
ignored_test_catalog="$(cargo test --manifest-path "${repo_root}/apps/processing-worker/Cargo.toml" --locked --lib -- --ignored --list)"

# Shared slot and lifecycle fixtures run sequentially in this isolated database.
for test_name in "${tests[@]}"; do
  if ! grep -Fqx "${test_name}: test" <<<"${ignored_test_catalog}"; then
    echo "Required ignored Rust test was not found: ${test_name}" >&2
    exit 1
  fi
  cargo test \
    --manifest-path "${repo_root}/apps/processing-worker/Cargo.toml" \
    --locked --lib "${test_name}" -- --ignored --exact
done
