#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "analysis-rust-control-plane-smoke.sh accepts no positional arguments." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${ANALYSIS_CONTROL_SMOKE_DATABASE_URL:?an isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL is required}"
: "${ANALYSIS_OUTBOX_SMOKE_DATABASE_URL:?an isolated ANALYSIS_OUTBOX_SMOKE_DATABASE_URL is required}"
: "${ANALYSIS_OUTBOX_SMOKE_REDIS_URL:?an isolated ANALYSIS_OUTBOX_SMOKE_REDIS_URL is required}"

if [[ "${ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED:-}" != "true" ]]; then
  echo "ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED=true is required." >&2
  exit 1
fi

tests=(
  "series_analysis::control::capability::tests::real_postgres_registration_replaces_the_generation_capability_set"
  "series_analysis::control::claim::tests::real_postgres_keeps_exact_jobs_queued_when_an_old_binary_omits_the_lease_contract"
  "series_analysis::control::integration_tests::real_postgres_keeps_staging_separate_from_fenced_publication"
  "series_analysis::release::tests::real_postgres_release_capabilities_require_exact_singleton_arrays"
  "series_analysis::release::tests::real_postgres_promotion_freezes_capability_registration_after_inspection"
  "series_analysis::release::tests::real_postgres_zero_title_backfill_is_terminal_and_updates_the_release_generation"
  "series_analysis::release::tests::real_postgres_audit_reports_a_release_state_mismatch"
  "series_analysis::release::tests::real_postgres_release_lock_serializes_new_title_state_inheritance"
  "outbox::tests::subscribed_postgres_listener_delivers_the_next_commit_hint"
  "series_analysis::outbox::tests::real_postgres_and_redis_preserve_claim_and_payload_contract"
)

ignored_test_catalog="$(
  cargo test \
    --manifest-path "${repo_root}/apps/processing-worker/Cargo.toml" \
    --locked \
    --lib \
    -- \
    --ignored \
    --list
)"

for test_name in "${tests[@]}"; do
  if ! grep -Fqx "${test_name}: test" <<<"${ignored_test_catalog}"; then
    echo "Required ignored Rust test was not found: ${test_name}" >&2
    exit 1
  fi

  cargo test \
    --manifest-path "${repo_root}/apps/processing-worker/Cargo.toml" \
    --locked \
    --lib \
    "${test_name}" \
    -- \
    --ignored \
    --exact \
    --test-threads=1
done
