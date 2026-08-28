#![expect(
    clippy::panic_in_result_fn,
    clippy::shadow_unrelated,
    clippy::too_many_lines,
    reason = "the isolated database scenario keeps each durable boundary visible in execution order"
)]

use std::{error::Error, fs, future::Future, pin::Pin, time::Duration};

use momo_analysis_core::{
    contract::{ARTIFACT_SCHEMA_VERSION, ArtifactManifest, ResourceManifest},
    model::{AnalysisInput, IncidentCounts, PlayerMatchInput},
};
use tempfile::TempDir;
use tokio_postgres::{Client, Transaction};

use super::{
    ALGORITHM_VERSION, AttemptMetrics, ClaimResult, ClaimedJob, ControlError, DeliveryReason,
    ResultDisposition, SafeFailureCode, TransactionEffects,
    claim::{ClaimPreparation, prepare_claim},
    completion::{reconcile_staging, validate_authoritative_manifest},
    publication::{
        finish_success, publish_staged_artifact, requires_staging, stage_artifact,
        validate_staged_artifact,
    },
    recovery::recover_expired_analysis_holder,
    transaction::{artifact_id_for_attempt, enqueue_delivery, lock_owned_by},
};
use crate::series_analysis::artifact::{ArtifactBuildRequest, build_artifact};

type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

const TITLE_ID: &str = "analysis-stage-smoke-title";
const JOB_ID: &str = "analysis-stage-smoke-job";
const OLD_ATTEMPT_ID: &str = "analysis-stage-smoke-attempt-1";
const NEW_ATTEMPT_ID: &str = "analysis-stage-smoke-attempt-2";
const OLD_WORKER_ID: &str = "analysis-stage-smoke-worker-1";
const NEW_WORKER_ID: &str = "analysis-stage-smoke-worker-2";
const OLD_FENCE: i64 = 1_000_001;
const NEW_FENCE: i64 = 1_000_002;
const MATCH_ID: &str = "analysis-stage-smoke-match";
const EVENT_ID: &str = "analysis-stage-smoke-event";
const SEASON_ID: &str = "analysis-stage-smoke-season";
const MAP_ID: &str = "analysis-stage-smoke-map";
const MEMBER_IDS: [&str; 4] = [
    "member_ponta",
    "member_akane_mami",
    "member_otaka",
    "member_eu",
];

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_keeps_staging_separate_from_fenced_publication() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = crate::postgres::connect(&database_url).await?;
    let mut secondary = crate::postgres::connect(&database_url).await?;
    cleanup_database(&primary).await?;
    prepare_owned_attempt(&primary).await?;
    assert_claim_reports_database_availability_delay(&mut primary).await?;
    assert_delivery_deadline_follows_job_availability(&mut primary).await?;
    assert_recovery_locks_title_before_job(&mut primary, &mut secondary).await?;
    assert_recovery_rejects_a_mismatched_job_owner(&mut primary, &secondary).await?;

    let old_claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    let corrupt_directory = TempDir::new()?;
    let corrupt_manifest = build_manifest(&old_claim, corrupt_directory.path())?;
    assert_authoritative_snapshot_rejects_omissions(&mut primary, &old_claim, &corrupt_manifest)
        .await?;
    corrupt_last_match_context(&corrupt_manifest, corrupt_directory.path())?;
    let transaction = primary.transaction().await?;
    assert!(matches!(
        stage_artifact(
            &transaction,
            &old_claim,
            &corrupt_manifest,
            corrupt_directory.path(),
        )
        .await,
        Err(ControlError::InvalidMetadata)
    ));
    transaction.rollback().await?;
    assert_artifact_shape(&secondary, &corrupt_manifest.artifact_id, "0|0|0").await?;

    let old_directory = TempDir::new()?;
    let old_manifest = build_manifest(&old_claim, old_directory.path())?;
    stage_with_control_lock_probe(
        &mut primary,
        &mut secondary,
        &old_claim,
        &old_manifest,
        old_directory.path(),
    )
    .await?;
    assert_artifact_shape(&secondary, &old_manifest.artifact_id, "1|0|4").await?;

    drop(primary);
    let unavailable_path = old_manifest
        .resources
        .iter()
        .rev()
        .find_map(|resource| match resource {
            ResourceManifest::MatchContext { common, .. } => {
                Some(old_directory.path().join(&common.path))
            }
            ResourceManifest::Aggregate { .. }
            | ResourceManifest::Review { .. }
            | ResourceManifest::Drilldown { .. } => None,
        })
        .ok_or("fixture must contain a match-context resource")?;
    let saved_path = unavailable_path.with_extension("temporarily-unavailable");
    fs::rename(&unavailable_path, &saved_path)?;
    let reconciliation = reconcile_staging(
        &database_url,
        Duration::from_secs(5),
        &old_claim,
        &old_manifest,
        old_directory.path(),
    )
    .await;
    fs::rename(saved_path, unavailable_path)?;
    reconciliation?;
    let mut primary = crate::postgres::connect(&database_url).await?;
    assert_artifact_shape(&secondary, &old_manifest.artifact_id, "1|0|4").await?;

    secondary
        .execute(
            "UPDATE series_analysis_scope_aggregate_artifacts\x20\
             SET checksum = 'sha256:' || repeat('0', 64)\x20\
             WHERE artifact_id = $1 AND scope_key = (\x20\
               SELECT scope_key FROM series_analysis_scope_aggregate_artifacts\x20\
               WHERE artifact_id = $1 ORDER BY scope_key LIMIT 1\x20\
             )",
            &[&old_manifest.artifact_id],
        )
        .await?;
    let transaction = primary.transaction().await?;
    lock_owned_by(&transaction, &old_claim, OLD_WORKER_ID).await?;
    assert!(matches!(
        validate_staged_artifact(&transaction, &old_claim, &old_manifest).await,
        Err(ControlError::InvalidMetadata)
    ));
    transaction.rollback().await?;
    assert_current(&secondary, None).await?;

    reconcile_staging(
        &database_url,
        Duration::from_secs(5),
        &old_claim,
        &old_manifest,
        old_directory.path(),
    )
    .await?;
    expire_old_lease_and_prepare_retry(&secondary).await?;
    let transaction = primary.transaction().await?;
    assert!(matches!(
        lock_owned_by(&transaction, &old_claim, OLD_WORKER_ID).await,
        Err(ControlError::OwnerLost)
    ));
    transaction.rollback().await?;
    assert_current(&secondary, None).await?;

    let new_claim = claim(NEW_ATTEMPT_ID, 2, NEW_FENCE)?;
    let new_directory = TempDir::new()?;
    let new_manifest = build_manifest(&new_claim, new_directory.path())?;
    stage_and_commit(
        &mut primary,
        &new_claim,
        &new_manifest,
        new_directory.path(),
    )
    .await?;
    let transaction = primary.transaction().await?;
    lock_owned_by(&transaction, &new_claim, NEW_WORKER_ID).await?;
    validate_staged_artifact(&transaction, &new_claim, &new_manifest).await?;
    publish_staged_artifact(&transaction, &new_claim, &new_manifest).await?;
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE id = $1 AND lease_owner = $2",
            &[&JOB_ID, &NEW_WORKER_ID],
        )
        .await?;
    let mut rejected_effects = TransactionEffects::empty();
    assert!(matches!(
        finish_success(
            &transaction,
            &new_claim,
            NEW_WORKER_ID,
            &AttemptMetrics::default(),
            &new_manifest.root_checksum,
            ResultDisposition::Published,
            &mut rejected_effects,
        )
        .await,
        Err(ControlError::OwnerLost)
    ));
    transaction.rollback().await?;
    assert_eq!(rejected_effects, TransactionEffects::empty());
    assert_current(&secondary, None).await?;
    assert_artifact_shape(&secondary, &new_manifest.artifact_id, "1|0|4").await?;

    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() + interval '10 minutes'\x20\
             WHERE slot_key = 'shared-heavy-work' AND owner = '{NEW_WORKER_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_expires_at = clock_timestamp() + interval '10 minutes'\x20\
             WHERE id = '{JOB_ID}' AND lease_owner = '{NEW_WORKER_ID}';"
        ))
        .await?;
    let publication = primary.transaction().await?;
    lock_owned_by(&publication, &new_claim, NEW_WORKER_ID).await?;
    validate_staged_artifact(&publication, &new_claim, &new_manifest).await?;
    publish_staged_artifact(&publication, &new_claim, &new_manifest).await?;
    let mut effects = TransactionEffects::empty();
    finish_success(
        &publication,
        &new_claim,
        NEW_WORKER_ID,
        &AttemptMetrics::default(),
        &new_manifest.root_checksum,
        ResultDisposition::Published,
        &mut effects,
    )
    .await?;
    publication.commit().await?;
    assert_eq!(effects, TransactionEffects::empty());
    assert_current(&secondary, Some(&new_manifest.artifact_id)).await?;
    assert_artifact_shape(&secondary, &new_manifest.artifact_id, "0|1|4").await?;
    assert!(!requires_staging(&secondary, &new_claim).await?);
    assert_artifact_shape(&secondary, &old_manifest.artifact_id, "1|0|4").await?;

    secondary
        .execute(
            "UPDATE series_analysis_artifacts SET created_at = clock_timestamp() - interval '2 days'\x20\
             WHERE id = $1 AND status = 'staging'",
            &[&old_manifest.artifact_id],
        )
        .await?;
    let cleaned = secondary
        .execute(
            "DELETE FROM series_analysis_artifacts a\x20\
             WHERE a.id = $1 AND a.status = 'staging'\x20\
               AND a.created_at < clock_timestamp() - interval '1 day'\x20\
               AND NOT EXISTS (\x20\
                 SELECT 1 FROM series_analysis_title_states s\x20\
                 WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id)\x20\
               )",
            &[&old_manifest.artifact_id],
        )
        .await?;
    assert_eq!(cleaned, 1);
    assert_current(&secondary, Some(&new_manifest.artifact_id)).await?;

    cleanup_database(&secondary).await?;
    prepare_owned_attempt(&secondary).await?;
    assert_recovery_defers_then_allows_the_next_claim(&mut primary, &secondary).await?;
    cleanup_database(&secondary).await?;
    prepare_owned_attempt(&secondary).await?;
    assert_exhausted_recovery_resolves_the_current_delivery(&mut primary, &secondary).await?;
    cleanup_database(&secondary).await?;
    Ok(())
}

fn claim(attempt_id: &str, attempt_no: i32, fencing_token: i64) -> SmokeResult<ClaimedJob> {
    Ok(ClaimedJob {
        job_id: String::from(JOB_ID),
        game_title_id: String::from(TITLE_ID),
        input_revision: 1,
        algorithm_version: String::from(ALGORITHM_VERSION),
        artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION)?,
        attempt_id: String::from(attempt_id),
        attempt_no,
        fencing_token,
    })
}

fn build_manifest(
    claim: &ClaimedJob,
    directory: &std::path::Path,
) -> SmokeResult<ArtifactManifest> {
    let input = analysis_input().try_into_normalized()?;
    let built = build_artifact(
        &input,
        &ArtifactBuildRequest {
            artifact_id: artifact_id_for_attempt(&claim.attempt_id),
            algorithm_version: claim.algorithm_version.clone(),
            maximum_chunk_bytes: 16 * 1024 * 1024,
            maximum_chunk_count: 1_000,
            maximum_total_bytes: 64 * 1024 * 1024,
            maximum_file_count: 1_001,
        },
        directory,
    )?;
    Ok(built.manifest)
}

fn analysis_input() -> AnalysisInput {
    AnalysisInput {
        game_title_id: String::from(TITLE_ID),
        input_revision: 1,
        player_matches: MEMBER_IDS
            .into_iter()
            .enumerate()
            .map(|(index, member_id)| {
                let player = i32::try_from(index + 1).unwrap_or(i32::MAX);
                PlayerMatchInput {
                    match_id: String::from(MATCH_ID),
                    match_revision: 1,
                    played_at: String::from("2026-08-14T00:00:00.000000Z"),
                    held_event_id: String::from(EVENT_ID),
                    match_no_in_event: 1,
                    season_master_id: String::from(SEASON_ID),
                    map_master_id: String::from(MAP_ID),
                    member_id: String::from(member_id),
                    play_order: player,
                    rank: player,
                    total_assets_man_yen: player * 1_000,
                    revenue_man_yen: player * 100,
                    incidents: IncidentCounts::default(),
                }
            })
            .collect(),
    }
}

async fn assert_authoritative_snapshot_rejects_omissions(
    client: &mut Client,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
) -> SmokeResult {
    let transaction = client.transaction().await?;
    lock_owned_by(&transaction, claim, OLD_WORKER_ID).await?;
    validate_authoritative_manifest(&transaction, &claim.game_title_id, manifest).await?;

    let mut missing_scope = manifest.clone();
    missing_scope.resources.retain(|resource| {
        resource.common().scope
            != momo_analysis_core::contract::ScopeRef::Season {
                season_master_id: String::from(SEASON_ID),
            }
    });
    missing_scope.root_checksum = missing_scope.computed_root_checksum()?;
    assert!(matches!(
        validate_authoritative_manifest(&transaction, &claim.game_title_id, &missing_scope).await,
        Err(ControlError::InvalidMetadata)
    ));

    let mut missing_context = manifest.clone();
    let context_index = missing_context
        .resources
        .iter()
        .position(|resource| {
            matches!(
                resource,
                ResourceManifest::MatchContext {
                    common,
                    match_id,
                    ..
                } if common.scope == momo_analysis_core::contract::ScopeRef::Overall
                    && match_id == MATCH_ID
            )
        })
        .ok_or("fixture overall match context is missing")?;
    missing_context.resources.remove(context_index);
    missing_context.root_checksum = missing_context.computed_root_checksum()?;
    assert!(matches!(
        validate_authoritative_manifest(&transaction, &claim.game_title_id, &missing_context).await,
        Err(ControlError::InvalidMetadata)
    ));
    transaction.rollback().await?;
    Ok(())
}

fn corrupt_last_match_context(
    manifest: &ArtifactManifest,
    directory: &std::path::Path,
) -> SmokeResult {
    let common = manifest
        .resources
        .iter()
        .rev()
        .find_map(|resource| match resource {
            ResourceManifest::MatchContext { common, .. } => Some(common),
            ResourceManifest::Aggregate { .. }
            | ResourceManifest::Review { .. }
            | ResourceManifest::Drilldown { .. } => None,
        })
        .ok_or("fixture must contain a match-context resource")?;
    let path = directory.join(&common.path);
    let mut bytes = fs::read(&path)?;
    let first = bytes
        .first_mut()
        .ok_or("fixture resource must not be empty")?;
    *first ^= 1;
    fs::write(path, bytes)?;
    Ok(())
}

async fn stage_and_commit(
    client: &mut Client,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    directory: &std::path::Path,
) -> Result<(), ControlError> {
    let transaction = client.transaction().await?;
    stage_artifact(&transaction, claim, manifest, directory).await?;
    transaction.commit().await?;
    Ok(())
}

async fn stage_with_control_lock_probe(
    staging_client: &mut Client,
    probe_client: &mut Client,
    claim: &ClaimedJob,
    manifest: &ArtifactManifest,
    directory: &std::path::Path,
) -> SmokeResult {
    let staging = staging_client.transaction().await?;
    stage_artifact(&staging, claim, manifest, directory).await?;
    let probe = probe_client.transaction().await?;
    probe
        .query_one(
            "SELECT 1 FROM worker_execution_slots\x20\
             WHERE slot_key = 'shared-heavy-work' FOR UPDATE NOWAIT",
            &[],
        )
        .await?;
    probe
        .query_one(
            "SELECT 1 FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE NOWAIT",
            &[&claim.game_title_id],
        )
        .await?;
    probe
        .query_one(
            "SELECT 1 FROM series_analysis_jobs WHERE id = $1 FOR UPDATE NOWAIT",
            &[&claim.job_id],
        )
        .await?;
    probe.rollback().await?;
    staging.commit().await?;
    Ok(())
}

async fn prepare_owned_attempt(client: &Client) -> SmokeResult {
    client
        .batch_execute(&format!(
            "INSERT INTO game_titles (id, name, layout_family, display_order)\x20\
             VALUES ('{TITLE_ID}', 'Analysis staging smoke', 'momotetsu2', 9999);\x20\
             INSERT INTO held_events (id, session_id, held_date_iso, start_at)\x20\
             VALUES ('{EVENT_ID}', NULL, DATE '2026-08-14', TIMESTAMPTZ '2026-08-14 00:00:00+00');\x20\
             INSERT INTO season_masters (id, game_title_id, name, display_order)\x20\
             VALUES ('{SEASON_ID}', '{TITLE_ID}', 'Analysis staging season', 9999);\x20\
             INSERT INTO map_masters (id, game_title_id, name, display_order)\x20\
             VALUES ('{MAP_ID}', '{TITLE_ID}', 'Analysis staging map', 9999);\x20\
             INSERT INTO matches (\x20\
               id, held_event_id, match_no_in_event, game_title_id, layout_family,\x20\
               season_master_id, owner_member_id, map_master_id, played_at,\x20\
               created_by_account_id, created_by_member_id, analysis_revision\x20\
             ) VALUES (\x20\
               '{MATCH_ID}', '{EVENT_ID}', 1, '{TITLE_ID}', 'momotetsu2', '{SEASON_ID}',\x20\
               'member_ponta', '{MAP_ID}', TIMESTAMPTZ '2026-08-14 00:00:00+00',\x20\
               'account_ponta', 'member_ponta', 1\x20\
             );\x20\
             INSERT INTO match_players (\x20\
               match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen\x20\
             ) VALUES\x20\
               ('{MATCH_ID}', 'member_ponta', 1, 1, 1000, 100),\x20\
               ('{MATCH_ID}', 'member_akane_mami', 2, 2, 2000, 200),\x20\
               ('{MATCH_ID}', 'member_otaka', 3, 3, 3000, 300),\x20\
               ('{MATCH_ID}', 'member_eu', 4, 4, 4000, 400);\x20\
             UPDATE series_analysis_title_states SET input_revision = 1,\x20\
               algorithm_version = '{ALGORITHM_VERSION}', artifact_schema_version = {ARTIFACT_SCHEMA_VERSION},\x20\
               pending_work = true WHERE game_title_id = '{TITLE_ID}';\x20\
             INSERT INTO series_analysis_jobs (\x20\
               id, game_title_id, input_revision, algorithm_version, artifact_schema_version,\x20\
               status, trigger, started_at, lease_owner, lease_attempt_id,\x20\
               lease_fencing_token, lease_expires_at, attempt_count\x20\
             ) VALUES (\x20\
               '{JOB_ID}', '{TITLE_ID}', 1, '{ALGORITHM_VERSION}', {ARTIFACT_SCHEMA_VERSION},\x20\
               'running', 'manual', clock_timestamp(), '{OLD_WORKER_ID}', '{OLD_ATTEMPT_ID}',\x20\
               {OLD_FENCE}, clock_timestamp() + interval '10 minutes', 1\x20\
             );\x20\
             INSERT INTO series_analysis_job_attempts (\x20\
               id, job_id, attempt_no, owner, fencing_token, input_revision, algorithm_version,\x20\
               artifact_schema_version, status, effective_config_version,\x20\
               calculation_timeout_milliseconds\x20\
             ) VALUES (\x20\
               '{OLD_ATTEMPT_ID}', '{JOB_ID}', 1, '{OLD_WORKER_ID}', {OLD_FENCE}, 1,\x20\
               '{ALGORITHM_VERSION}', {ARTIFACT_SCHEMA_VERSION}, 'running', 'staging-smoke', 60000\x20\
             );\x20\
             UPDATE worker_execution_slots SET task_kind = 'analysis', owner = '{OLD_WORKER_ID}',\x20\
               job_id = '{JOB_ID}', attempt_id = '{OLD_ATTEMPT_ID}', holder_preemptible = true,\x20\
               lease_expires_at = clock_timestamp() + interval '10 minutes',\x20\
               fencing_token = {OLD_FENCE}, preempt_requested_by = NULL,\x20\
               preempt_requested_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE slot_key = 'shared-heavy-work';"
        ))
        .await?;
    Ok(())
}

async fn assert_delivery_deadline_follows_job_availability(client: &mut Client) -> SmokeResult {
    let transaction = client.transaction().await?;
    let mut effects = TransactionEffects::empty();
    enqueue_delivery(
        &transaction,
        JOB_ID,
        DeliveryReason::GracefulStop,
        99,
        &mut effects,
    )
    .await?;
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               available_at = clock_timestamp() + interval '30 seconds' WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    enqueue_delivery(
        &transaction,
        JOB_ID,
        DeliveryReason::TransientRetry,
        99,
        &mut effects,
    )
    .await?;

    let deadlines = transaction
        .query_one(
            "SELECT COUNT(*)::int,\x20\
               BOOL_AND(q.next_attempt_at = j.available_at),\x20\
               BOOL_AND(q.next_attempt_at > clock_timestamp())\x20\
             FROM series_analysis_queue_outbox q\x20\
             JOIN series_analysis_jobs j ON j.id = q.job_id\x20\
             WHERE q.job_id = $1 AND q.status = 'pending'",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(deadlines.try_get::<_, i32>(0)?, 2);
    assert!(deadlines.try_get::<_, bool>(1)?);
    assert!(deadlines.try_get::<_, bool>(2)?);
    assert_ne!(effects, TransactionEffects::empty());
    transaction.rollback().await?;
    Ok(())
}

async fn assert_claim_reports_database_availability_delay(client: &mut Client) -> SmokeResult {
    let transaction = client.transaction().await?;
    transaction
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET task_kind = NULL, owner = NULL, job_id = NULL,\x20\
               attempt_id = NULL, holder_preemptible = NULL, lease_expires_at = NULL,\x20\
               preempt_requested_by = NULL, preempt_requested_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET status = 'queued', available_at = clock_timestamp() + interval '1 hour',\x20\
               started_at = NULL, lease_owner = NULL, lease_attempt_id = NULL,\x20\
               lease_fencing_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE id = '{JOB_ID}';"
        ))
        .await?;

    let remaining_delay = match prepare_claim(&transaction, JOB_ID, 60_000).await? {
        ClaimPreparation::Rejected(ClaimResult::NotYetAvailable { remaining_delay }) => {
            remaining_delay
        }
        ClaimPreparation::Ready { .. }
        | ClaimPreparation::RecoveredExpiredHolder { .. }
        | ClaimPreparation::Rejected(_) => {
            return Err("future job availability did not defer the claim".into());
        }
    };
    assert!(remaining_delay > Duration::from_mins(59));
    assert!(remaining_delay <= Duration::from_hours(1));
    transaction.rollback().await?;
    Ok(())
}

async fn assert_recovery_rejects_a_mismatched_job_owner(
    primary: &mut Client,
    secondary: &Client,
) -> SmokeResult {
    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_owner = '{NEW_WORKER_ID}',\x20\
               lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';"
        ))
        .await?;
    let transaction = primary.transaction().await?;
    let slot = crate::execution_slot::lock(&transaction).await?;
    let holder = slot.holder.ok_or("expired analysis holder is missing")?;
    assert!(holder.expired);
    assert!(matches!(
        recover_expired_analysis_holder(&transaction, &holder).await,
        Err(ControlError::OwnerLost)
    ));
    transaction.rollback().await?;

    let unchanged = secondary
        .query_one(
            "SELECT j.status, j.lease_owner, a.status, s.owner\x20\
             FROM series_analysis_jobs j\x20\
             JOIN series_analysis_job_attempts a ON a.id = $2\x20\
             JOIN worker_execution_slots s ON s.slot_key = 'shared-heavy-work'\x20\
             WHERE j.id = $1",
            &[&JOB_ID, &OLD_ATTEMPT_ID],
        )
        .await?;
    assert_eq!(unchanged.try_get::<_, String>(0)?, "running");
    assert_eq!(unchanged.try_get::<_, String>(1)?, NEW_WORKER_ID);
    assert_eq!(unchanged.try_get::<_, String>(2)?, "running");
    assert_eq!(unchanged.try_get::<_, String>(3)?, OLD_WORKER_ID);

    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() + interval '10 minutes'\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_owner = '{OLD_WORKER_ID}',\x20\
               lease_expires_at = clock_timestamp() + interval '10 minutes'\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';"
        ))
        .await?;
    Ok(())
}

async fn assert_recovery_locks_title_before_job(
    primary: &mut Client,
    secondary: &mut Client,
) -> SmokeResult {
    let recovery_backend_pid = primary
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get::<_, i32>(0)?;
    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_recovery_count = 3,\x20\
               lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';"
        ))
        .await?;
    let title_holder = secondary.transaction().await?;
    title_holder
        .query_one(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE",
            &[&TITLE_ID],
        )
        .await?;

    let recovery_transaction = primary.transaction().await?;
    let slot = crate::execution_slot::lock(&recovery_transaction).await?;
    let holder = slot.holder.ok_or("expired analysis holder is missing")?;
    assert!(holder.expired);
    {
        let recovery = recover_expired_analysis_holder(&recovery_transaction, &holder);
        tokio::pin!(recovery);
        wait_for_backend_lock(&title_holder, recovery_backend_pid, recovery.as_mut()).await?;

        title_holder
            .query_one(
                "SELECT id FROM series_analysis_jobs WHERE id = $1 FOR UPDATE NOWAIT",
                &[&JOB_ID],
            )
            .await?;
        title_holder.rollback().await?;
        tokio::time::timeout(Duration::from_secs(1), &mut recovery).await??;
    }
    recovery_transaction.rollback().await?;

    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() + interval '10 minutes'\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_recovery_count = 0,\x20\
               lease_expires_at = clock_timestamp() + interval '10 minutes'\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';"
        ))
        .await?;
    Ok(())
}

async fn wait_for_backend_lock(
    observer: &Transaction<'_>,
    backend_pid: i32,
    mut recovery: Pin<&mut impl Future<Output = Result<TransactionEffects, ControlError>>>,
) -> SmokeResult {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
    loop {
        tokio::select! {
            result = recovery.as_mut() => {
                result?;
                return Err("recovery completed while its title row was locked".into());
            }
            () = tokio::time::sleep(Duration::from_millis(10)) => {
                let waiting_for_lock = observer
                    .query_one(
                        "SELECT COALESCE(wait_event_type = 'Lock', false)\x20\
                         FROM pg_stat_activity WHERE pid = $1",
                        &[&backend_pid],
                    )
                    .await?
                    .try_get::<_, bool>(0)?;
                if waiting_for_lock {
                    return Ok(());
                }
            }
            () = tokio::time::sleep_until(deadline) => {
                return Err("recovery did not reach the title-row lock within one second".into());
            }
        }
    }
}

async fn assert_recovery_defers_then_allows_the_next_claim(
    primary: &mut Client,
    secondary: &Client,
) -> SmokeResult {
    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';"
        ))
        .await?;

    let recovery_transaction = primary.transaction().await?;
    let recovery_effects = match prepare_claim(&recovery_transaction, JOB_ID, 60_000).await? {
        ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_delivery_resolved,
        } => {
            assert!(current_delivery_resolved);
            effects
        }
        ClaimPreparation::Ready { .. } | ClaimPreparation::Rejected(_) => {
            return Err("expired holder recovery did not defer the current claim".into());
        }
    };
    assert_ne!(recovery_effects, TransactionEffects::empty());
    recovery_transaction.commit().await?;

    let recovered = secondary
        .query_one(
            "SELECT j.status, s.owner, EXISTS (\x20\
               SELECT 1 FROM series_analysis_queue_outbox q\x20\
               WHERE q.job_id = j.id AND q.status = 'pending'\x20\
             )\x20\
             FROM series_analysis_jobs j\x20\
             JOIN worker_execution_slots s ON s.slot_key = 'shared-heavy-work'\x20\
             WHERE j.id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(recovered.try_get::<_, String>(0)?, "queued");
    assert_eq!(recovered.try_get::<_, Option<String>>(1)?, None);
    assert!(recovered.try_get::<_, bool>(2)?);

    let next_claim_transaction = primary.transaction().await?;
    assert!(matches!(
        prepare_claim(&next_claim_transaction, JOB_ID, 60_000).await?,
        ClaimPreparation::Ready { .. }
    ));
    next_claim_transaction.rollback().await?;
    Ok(())
}

async fn assert_exhausted_recovery_resolves_the_current_delivery(
    primary: &mut Client,
    observer: &Client,
) -> SmokeResult {
    observer
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_recovery_count = 3,\x20\
               lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';"
        ))
        .await?;

    let transaction = primary.transaction().await?;
    let recovery_effects = match prepare_claim(&transaction, JOB_ID, 60_000).await? {
        ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_delivery_resolved,
        } => {
            assert!(current_delivery_resolved);
            effects
        }
        ClaimPreparation::Ready { .. } | ClaimPreparation::Rejected(_) => {
            return Err("exhausted lease recovery did not resolve the current delivery".into());
        }
    };
    assert_eq!(recovery_effects, TransactionEffects::empty());
    transaction.commit().await?;

    let terminal = observer
        .query_one(
            "SELECT j.status, j.lease_recovery_count, j.safe_failure_code,\x20\
                    a.status, a.outcome, s.owner, s.job_id\x20\
             FROM series_analysis_jobs j\x20\
             JOIN series_analysis_job_attempts a ON a.id = $2\x20\
             JOIN worker_execution_slots s ON s.slot_key = 'shared-heavy-work'\x20\
             WHERE j.id = $1",
            &[&JOB_ID, &OLD_ATTEMPT_ID],
        )
        .await?;
    assert_eq!(terminal.try_get::<_, String>(0)?, "failed");
    assert_eq!(terminal.try_get::<_, i32>(1)?, 3);
    assert_eq!(
        terminal.try_get::<_, String>(2)?,
        SafeFailureCode::LeaseRecoveryExhausted.wire()
    );
    assert_eq!(terminal.try_get::<_, String>(3)?, "terminal");
    assert_eq!(terminal.try_get::<_, String>(4)?, "owner_lost");
    assert_eq!(terminal.try_get::<_, Option<String>>(5)?, None);
    assert_eq!(terminal.try_get::<_, Option<String>>(6)?, None);
    Ok(())
}

async fn expire_old_lease_and_prepare_retry(client: &Client) -> SmokeResult {
    client
        .batch_execute(&format!(
            "UPDATE series_analysis_job_attempts SET status = 'terminal', outcome = 'owner_lost',\x20\
               finished_at = clock_timestamp() WHERE id = '{OLD_ATTEMPT_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_owner = '{NEW_WORKER_ID}',\x20\
               lease_attempt_id = '{NEW_ATTEMPT_ID}', lease_fencing_token = {NEW_FENCE},\x20\
               lease_expires_at = clock_timestamp() + interval '10 minutes', attempt_count = 2\x20\
             WHERE id = '{JOB_ID}' AND status = 'running';\x20\
             INSERT INTO series_analysis_job_attempts (\x20\
               id, job_id, attempt_no, owner, fencing_token, input_revision, algorithm_version,\x20\
               artifact_schema_version, status, effective_config_version,\x20\
               calculation_timeout_milliseconds\x20\
             ) VALUES (\x20\
               '{NEW_ATTEMPT_ID}', '{JOB_ID}', 2, '{NEW_WORKER_ID}', {NEW_FENCE}, 1,\x20\
               '{ALGORITHM_VERSION}', {ARTIFACT_SCHEMA_VERSION}, 'running', 'staging-smoke', 60000\x20\
             );\x20\
             UPDATE worker_execution_slots SET owner = '{NEW_WORKER_ID}',\x20\
               attempt_id = '{NEW_ATTEMPT_ID}', lease_expires_at = clock_timestamp() + interval '10 minutes',\x20\
               fencing_token = {NEW_FENCE}, updated_at = clock_timestamp()\x20\
             WHERE slot_key = 'shared-heavy-work' AND task_kind = 'analysis' AND job_id = '{JOB_ID}';"
        ))
        .await?;
    Ok(())
}

async fn assert_artifact_shape(client: &Client, artifact_id: &str, expected: &str) -> SmokeResult {
    let row = client
        .query_one(
            "SELECT\x20\
               COUNT(*) FILTER (WHERE status = 'staging')::text,\x20\
               COUNT(*) FILTER (WHERE status = 'published')::text,\x20\
               (SELECT COUNT(*)::text FROM series_analysis_scope_aggregate_artifacts\x20\
                WHERE artifact_id = $1)\x20\
             FROM series_analysis_artifacts WHERE id = $1",
            &[&artifact_id],
        )
        .await?;
    let actual = format!(
        "{}|{}|{}",
        row.try_get::<_, String>(0)?,
        row.try_get::<_, String>(1)?,
        row.try_get::<_, String>(2)?,
    );
    assert_eq!(actual, expected);
    Ok(())
}

async fn assert_current(client: &Client, expected: Option<&str>) -> SmokeResult {
    let actual = client
        .query_one(
            "SELECT current_artifact_id FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&TITLE_ID],
        )
        .await?
        .try_get::<_, Option<String>>(0)?;
    assert_eq!(actual.as_deref(), expected);
    Ok(())
}

async fn cleanup_database(client: &Client) -> SmokeResult {
    client
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET task_kind = NULL, owner = NULL, job_id = NULL,\x20\
               attempt_id = NULL, holder_preemptible = NULL, lease_expires_at = NULL,\x20\
               preempt_requested_by = NULL, preempt_requested_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE slot_key = 'shared-heavy-work' AND job_id = '{JOB_ID}';\x20\
             DELETE FROM matches WHERE id = '{MATCH_ID}';\x20\
             DELETE FROM held_events WHERE id = '{EVENT_ID}';\x20\
             DELETE FROM season_masters WHERE id = '{SEASON_ID}';\x20\
             DELETE FROM map_masters WHERE id = '{MAP_ID}';\x20\
             DELETE FROM game_titles WHERE id = '{TITLE_ID}';"
        ))
        .await?;
    Ok(())
}
