#![expect(
    clippy::panic_in_result_fn,
    clippy::shadow_unrelated,
    clippy::too_many_lines,
    reason = "the isolated database scenario keeps each durable boundary visible in execution order"
)]

use std::{error::Error, fs, time::Duration};

use momo_analysis_core::{
    contract::{ARTIFACT_SCHEMA_VERSION, ArtifactManifest, ResourceManifest},
    model::{AnalysisInput, IncidentCounts, PlayerMatchInput},
};
use tempfile::TempDir;
use tokio_postgres::Client;

use super::{
    ALGORITHM_VERSION, AttemptMetrics, ClaimedJob, ControlError, ResultDisposition,
    completion::reconcile_staging,
    publication::{
        finish_success, publish_staged_artifact, requires_staging, stage_artifact,
        validate_staged_artifact,
    },
    transaction::{artifact_id_for_attempt, lock_owned_by},
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

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_keeps_staging_separate_from_fenced_publication() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = crate::postgres::connect(&database_url).await?;
    let mut secondary = crate::postgres::connect(&database_url).await?;
    cleanup_database(&primary).await?;
    prepare_owned_attempt(&primary).await?;

    let old_claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    let corrupt_directory = TempDir::new()?;
    let corrupt_manifest = build_manifest(&old_claim, corrupt_directory.path())?;
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
    secondary
        .batch_execute(&format!(
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() + interval '2 seconds'\x20\
             WHERE slot_key = 'shared-heavy-work' AND owner = '{NEW_WORKER_ID}';\x20\
             UPDATE series_analysis_jobs SET lease_expires_at = clock_timestamp() + interval '2 seconds'\x20\
             WHERE id = '{JOB_ID}' AND lease_owner = '{NEW_WORKER_ID}';"
        ))
        .await?;
    let transaction = primary.transaction().await?;
    lock_owned_by(&transaction, &new_claim, NEW_WORKER_ID).await?;
    validate_staged_artifact(&transaction, &new_claim, &new_manifest).await?;
    publish_staged_artifact(&transaction, &new_claim, &new_manifest).await?;
    tokio::time::sleep(Duration::from_millis(2_100)).await;
    assert!(matches!(
        finish_success(
            &transaction,
            &new_claim,
            NEW_WORKER_ID,
            &AttemptMetrics::default(),
            &new_manifest.root_checksum,
            ResultDisposition::Published,
        )
        .await,
        Err(ControlError::OwnerLost)
    ));
    transaction.rollback().await?;
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
    finish_success(
        &publication,
        &new_claim,
        NEW_WORKER_ID,
        &AttemptMetrics::default(),
        &new_manifest.root_checksum,
        ResultDisposition::Published,
    )
    .await?;
    publication.commit().await?;
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
    let built = build_artifact(
        &analysis_input().into_normalized(),
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
        player_matches: (1..=4)
            .map(|player| PlayerMatchInput {
                match_id: String::from("analysis-stage-smoke-match"),
                match_revision: 1,
                played_at: String::from("2026-08-14T00:00:00.000000Z"),
                held_event_id: String::from("analysis-stage-smoke-event"),
                match_no_in_event: 1,
                season_master_id: String::from("analysis-stage-smoke-season"),
                map_master_id: String::from("analysis-stage-smoke-map"),
                member_id: format!("analysis-stage-smoke-member-{player}"),
                play_order: player,
                rank: player,
                total_assets_man_yen: player * 1_000,
                revenue_man_yen: player * 100,
                incidents: IncidentCounts::default(),
            })
            .collect(),
    }
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
             DELETE FROM game_titles WHERE id = '{TITLE_ID}';"
        ))
        .await?;
    Ok(())
}
