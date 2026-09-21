#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${OCR_CONTROL_SMOKE_DATABASE_URL:?an isolated OCR_CONTROL_SMOKE_DATABASE_URL is required}"
: "${OCR_CONTROL_SMOKE_REDIS_URL:?an isolated OCR_CONTROL_SMOKE_REDIS_URL is required}"

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

export STREAM_WAIT_SMOKE_REDIS_URL="${OCR_CONTROL_SMOKE_REDIS_URL}"
tests=(
  "ocr::submissions::runtime::integration_tests::real_postgres_preserves_submission_finalization_and_recovery"
  "ocr::control::integration_tests::real_postgres_and_redis_preserve_ocr_fencing_and_delivery_order"
  "ocr::queue::tests::real_redis_preserves_wake_recovery_and_new_delivery_fairness"
  "stream_retention::tests::real_redis_trim_preserves_pending_unread_and_other_groups"
  "stream_connection::tests::real_redis_stall_times_out_without_reusing_the_uncertain_connection"
)
ignored_test_catalog="$(cargo test --manifest-path "${repo_root}/apps/processing-worker/Cargo.toml" --locked --lib -- --ignored --list)"

# The stall test pauses this isolated Redis. Keep it sequential with the other control-plane tests.
for test_name in "${tests[@]}"; do
  if ! grep -Fqx "${test_name}: test" <<<"${ignored_test_catalog}"; then
    echo "Required ignored Rust test was not found: ${test_name}" >&2
    exit 1
  fi
  cargo test \
    --manifest-path "${repo_root}/apps/processing-worker/Cargo.toml" \
    --locked --lib "${test_name}" -- --ignored --exact
done
