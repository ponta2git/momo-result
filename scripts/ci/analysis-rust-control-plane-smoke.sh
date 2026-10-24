#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "analysis-rust-control-plane-smoke.sh accepts no positional arguments." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${ANALYSIS_CONTROL_SMOKE_DATABASE_URL:?an isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL is required}"
: "${PROCESSING_SCHEDULER_SMOKE_DATABASE_URL:?an isolated PROCESSING_SCHEDULER_SMOKE_DATABASE_URL is required}"

if [[ "${ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED:-}" != "true" ]]; then
  echo "ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED=true is required." >&2
  exit 1
fi

if [[ "${DATABASE_URL:-}" != "${ANALYSIS_CONTROL_SMOKE_DATABASE_URL}" ]]; then
  echo "DATABASE_URL must select the same explicitly isolated control-plane database." >&2
  exit 1
fi

tests=(
  "identity::schema::tests::real_postgres_requires_complete_canonical_columns_and_relationships"
  "notifications::bounds_tests::real_postgres_preparation_enforces_complete_jsonb_limits"
  "series_analysis::control::integration_tests::heartbeat::real_postgres_heartbeat_owns_deadline_and_connection"
  "series_analysis::control::integration_tests::transitions::real_postgres_requeues_bind_current_radar_and_every_exit_clears_the_lease"
  "series_analysis::release::promotion_tests::real_postgres_promotion_detaches_obsolete_empty_title_pointers_without_deleting_artifacts"
  "series_analysis::campaign::tests::real_postgres_campaign_refresh_counts_concurrent_target_commits"
  "series_analysis::control::history::tests::real_postgres_retention_preserves_active_jobs_and_readable_artifacts"
  "series_analysis::control::capability::tests::real_postgres_registration_replaces_the_generation_capability_set"
  "series_analysis::control::claim::tests::real_postgres_requires_explicit_lease_contract_on_claim_and_recovery"
  "series_analysis::control::integration_tests::fencing::real_postgres_job_fences_survive_cleanup_recovery_and_independent_workers"
  "series_analysis::control::integration_tests::claim_wait::real_postgres_claims_preserve_busy_deadlines_and_uncertain_commits"
  "series_analysis::control::integration_tests::real_postgres_keeps_staging_separate_from_fenced_publication"
  "series_analysis::control::integration_tests::achievements::real_postgres_achievement_input_and_publication_cover_zero_matches_and_global_events"
  "series_analysis::control::integration_tests::achievements::real_postgres_authoritative_manifest_consumes_large_match_snapshots"
  "series_analysis::control::integration_tests::radar::freshness::real_postgres_radar_preparation_checks_current_source_and_preserves_pending_analysis"
  "series_analysis::control::integration_tests::radar::publication::real_postgres_radar_application_restore_and_failure_keep_artifact_and_basis_atomic"
  "series_analysis::control::integration_tests::radar::manual::real_postgres_manual_radar_recomparison_publication_restore_and_history_are_coherent"
  "series_analysis::control::integration_tests::radar::manual::real_postgres_manual_radar_empty_first_comparison_and_withdrawal_never_fix_a_basis"
  "series_analysis::control::integration_tests::notifications::real_postgres_analysis_notifications_follow_committed_publications"
  "series_analysis::control::integration_tests::notifications::policy::real_postgres_coalesced_requests_notify_only_actual_match_changes"
  "series_analysis::control::integration_tests::notifications::policy::real_postgres_notification_baseline_advances_only_with_success"
  "series_analysis::control::integration_tests::notifications::policy::reader::real_postgres_notification_reader_preserves_history_and_selects_affected_ranks"
  "series_analysis::control::integration_tests::notifications::policy::limits::real_postgres_maximum_standard_notification_exports_consumer_fixture"
  "series_analysis::control::integration_tests::notifications::policy::limits::real_postgres_notification_limits_preserve_success_and_baseline"
  "series_analysis::control::integration_tests::notifications::policy::release::real_postgres_release_detachment_preserves_notification_input_history"
  "series_analysis::release::tests::real_postgres_release_capabilities_require_exact_singleton_arrays"
  "series_analysis::release::tests::real_postgres_promotion_freezes_capability_registration_after_inspection"
  "series_analysis::release::tests::real_postgres_zero_title_backfill_is_terminal_and_updates_the_release_generation"
  "series_analysis::release::tests::real_postgres_audit_reports_a_release_state_mismatch"
  "series_analysis::release::maintenance::tests::real_postgres_reconcile_preserves_preview_and_replays_an_applied_operation"
  "worker::tests::subscribed_postgres_listener_delivers_the_next_commit_hint"
  "worker::listener::tests::both_enabled_routes_are_verified_and_protocol_errors_are_fatal"
  "worker::selection::selection_tests::real_postgres_selects_due_work_and_recovers_orphans"
  "worker::runtime::dispatch::tests::real_postgres_delayed_candidates_still_attempt_durable_claims"
  "series_analysis::materialization::tests::real_postgres_preserves_campaign_acceptance_and_assignment"
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

# These suites mutate shared DB control state, including release and job-lease
# fixtures. Keep this service scope sequential; the ordinary Rust suite stays parallel.
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
