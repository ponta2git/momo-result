#![expect(
    clippy::panic_in_result_fn,
    clippy::shadow_unrelated,
    clippy::too_many_lines,
    reason = "the isolated database scenario keeps each durable boundary visible in execution order"
)]

use std::{error::Error, fs, future::Future, pin::Pin, time::Duration};

use momo_analysis_core::{
    contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID, ResourceManifest},
    model::{AnalysisInput, IncidentCounts, PlayerMatchInput},
};
use tempfile::TempDir;
use tokio_postgres::{Client, Transaction};

use super::{
    ALGORITHM_VERSION, AttemptMetrics, ClaimResult, ClaimedJob, ControlError, ResultDisposition,
    SafeFailureCode, TransactionEffects,
    claim::{ClaimPreparation, prepare_claim},
    completion::{reconcile_staging, validate_authoritative_manifest},
    publication::{
        finish_success, publish_staged_artifact, requires_staging, stage_artifact,
        validate_staged_artifact,
    },
    recovery::recover_expired_analysis_job,
    staging_metadata::validate_staged_resource_metadata,
    transaction::{artifact_id_for_attempt, lock_owned},
};
use crate::series_analysis::artifact::{
    ArtifactBuildRequest, ValidatedArtifact, build_artifact, validate_artifact_directory,
};

type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

mod achievements;
mod claim_wait;
mod fencing;
mod heartbeat;
mod notifications;
mod radar;
mod transitions;

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
    let mut primary = crate::identity::fixtures::connect(&database_url).await?;
    let mut secondary = crate::identity::fixtures::connect(&database_url).await?;
    cleanup_database(&primary).await?;
    prepare_owned_attempt(&primary).await?;
    primary
        .batch_execute("SET TIME ZONE 'Pacific/Honolulu'")
        .await?;
    let input =
        crate::series_analysis::input_repository::load_analysis_input(&mut primary, TITLE_ID, 1)
            .await?;
    let mut expected_achievements = analysis_input()
        .try_into_normalized()?
        .achievements()
        .clone();
    expected_achievements.event_compositions =
        vec![momo_analysis_core::achievements::EventComposition {
            held_event_id: String::from(EVENT_ID),
            match_count: 1,
            title_count: 1,
        }];
    assert_eq!(
        input,
        analysis_input()
            .try_into_normalized()?
            .with_achievements(expected_achievements)?
    );
    primary.batch_execute("RESET TIME ZONE").await?;
    assert_claim_reports_database_availability_delay(&mut primary).await?;
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
    assert_artifact_shape(
        &secondary,
        &corrupt_manifest.manifest().artifact_id,
        "0|0|0",
    )
    .await?;

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
    assert_artifact_shape(&secondary, &old_manifest.manifest().artifact_id, "1|0|4").await?;
    assert_staged_metadata_requires_an_exact_set(&mut primary, &old_manifest).await?;

    drop(primary);
    let unavailable_path = old_manifest
        .manifest()
        .resources
        .iter()
        .rev()
        .find_map(|resource| match resource {
            ResourceManifest::MatchContext { common, .. } => {
                Some(old_directory.path().join(&common.path))
            }
            ResourceManifest::Achievements { .. }
            | ResourceManifest::Aggregate { .. }
            | ResourceManifest::Review { .. }
            | ResourceManifest::OutlookSummary { .. }
            | ResourceManifest::OutlookReference { .. }
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
    let mut primary = crate::identity::fixtures::connect(&database_url).await?;
    assert_artifact_shape(&secondary, &old_manifest.manifest().artifact_id, "1|0|4").await?;

    let Err(sealed_mutation_error) = secondary
        .execute(
            "UPDATE series_analysis_scope_aggregate_artifacts\x20\
             SET payload = set_byte(payload, 0, (get_byte(payload, 0) + 1) % 256)\x20\
             WHERE artifact_id = $1 AND scope_key = (\x20\
               SELECT scope_key FROM series_analysis_scope_aggregate_artifacts\x20\
               WHERE artifact_id = $1 ORDER BY scope_key LIMIT 1\x20\
             )",
            &[&old_manifest.manifest().artifact_id],
        )
        .await
    else {
        return Err("an attested staging payload remained mutable before publication".into());
    };
    assert_eq!(
        sealed_mutation_error
            .as_db_error()
            .map(tokio_postgres::error::DbError::message),
        Some("attested series analysis artifact payloads are immutable")
    );
    let publication = primary.transaction().await?;
    lock_owned(&publication, &old_claim, OLD_WORKER_ID).await?;
    validate_staged_artifact(&publication, &old_claim, &old_manifest).await?;
    publication.rollback().await?;
    assert_current(&secondary, None).await?;

    reconcile_staging(
        &database_url,
        Duration::from_secs(5),
        &old_claim,
        &old_manifest,
        old_directory.path(),
    )
    .await?;
    seed_unattested_current(&mut secondary, &old_manifest).await?;
    assert_artifact_pointers(&secondary, Some(&old_manifest.manifest().artifact_id), None).await?;
    expire_old_lease_and_prepare_retry(&secondary).await?;
    let transaction = primary.transaction().await?;
    assert!(matches!(
        lock_owned(&transaction, &old_claim, OLD_WORKER_ID).await,
        Err(ControlError::OwnerLost)
    ));
    transaction.rollback().await?;
    assert_current(&secondary, Some(&old_manifest.manifest().artifact_id)).await?;

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
    lock_owned(&transaction, &new_claim, NEW_WORKER_ID).await?;
    validate_staged_artifact(&transaction, &new_claim, &new_manifest).await?;
    publish_staged_artifact(&transaction, &new_claim, &new_manifest).await?;
    transaction
        .execute(
            r"
                UPDATE series_analysis_jobs
                SET lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                WHERE series_analysis_jobs.legacy_id = $1 AND lease_owner = $2
                ",
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
            &new_manifest.manifest().root_checksum,
            ResultDisposition::Published,
            &mut rejected_effects,
        )
        .await,
        Err(ControlError::OwnerLost)
    ));
    transaction.rollback().await?;
    assert_eq!(rejected_effects, TransactionEffects::empty());
    assert_current(&secondary, Some(&old_manifest.manifest().artifact_id)).await?;
    assert_artifact_shape(&secondary, &new_manifest.manifest().artifact_id, "1|0|4").await?;

    secondary
        .batch_execute(&format!(
            r"
                UPDATE series_analysis_jobs
                SET lease_expires_at = clock_timestamp() + CAST('10 minutes' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND lease_owner = '{NEW_WORKER_ID}';
                "
        ))
        .await?;
    let publication = primary.transaction().await?;
    lock_owned(&publication, &new_claim, NEW_WORKER_ID).await?;
    validate_staged_artifact(&publication, &new_claim, &new_manifest).await?;
    let new_artifact_id = &new_manifest.manifest().artifact_id;
    let mutation_parameters: [&(dyn tokio_postgres::types::ToSql + Sync); 1] = [new_artifact_id];
    let concurrent_mutation = secondary.execute(
        "UPDATE series_analysis_scope_aggregate_artifacts\x20\
         SET item_count = item_count + 1\x20\
         WHERE artifact_id = $1",
        &mutation_parameters,
    );
    tokio::pin!(concurrent_mutation);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), concurrent_mutation.as_mut())
            .await
            .is_err(),
        "a child mutation must wait while publication holds the parent lock"
    );
    publish_staged_artifact(&publication, &new_claim, &new_manifest).await?;
    let mut effects = TransactionEffects::empty();
    finish_success(
        &publication,
        &new_claim,
        NEW_WORKER_ID,
        &AttemptMetrics::default(),
        &new_manifest.manifest().root_checksum,
        ResultDisposition::Published,
        &mut effects,
    )
    .await?;
    publication.commit().await?;
    let Err(mutation_error) = concurrent_mutation.await else {
        return Err("a child mutation succeeded after its parent was published".into());
    };
    assert_eq!(
        mutation_error
            .as_db_error()
            .map(tokio_postgres::error::DbError::message),
        Some("attested series analysis artifact payloads are immutable")
    );
    assert_eq!(effects, TransactionEffects::empty());
    assert_artifact_pointers(&secondary, Some(&new_manifest.manifest().artifact_id), None).await?;
    assert_artifact_shape(&secondary, &new_manifest.manifest().artifact_id, "0|1|4").await?;
    assert_validation_contract(&secondary, &new_manifest).await?;
    assert!(!requires_staging(&secondary, &new_claim, &new_manifest).await?);
    assert_artifact_shape(&secondary, &old_manifest.manifest().artifact_id, "0|1|4").await?;

    let cleaned = secondary
        .execute(
            r"
                DELETE FROM series_analysis_artifacts AS a
                WHERE a.id = $1
                  AND a.status = 'published'
                  AND a.published_at < clock_timestamp() - CAST('1 day' AS interval)
                  AND NOT EXISTS (SELECT 1
                                  FROM series_analysis_title_states AS s
                                  WHERE a.id IN ((SELECT fixture_parent.legacy_id
                                                  FROM series_analysis_artifact_identities AS fixture_parent
                                                  WHERE fixture_parent.id = s.current_artifact_id), (SELECT fixture_parent.legacy_id
                                                  FROM series_analysis_artifact_identities AS fixture_parent
                                                  WHERE fixture_parent.id = s.previous_artifact_id)))
                ",
            &[&old_manifest.manifest().artifact_id],
        )
        .await?;
    assert_eq!(cleaned, 1);
    assert_current(&secondary, Some(&new_manifest.manifest().artifact_id)).await?;

    cleanup_database(&secondary).await?;
    prepare_owned_attempt(&secondary).await?;
    assert_recovery_defers_then_allows_the_next_claim(&mut primary, &secondary).await?;
    cleanup_database(&secondary).await?;
    prepare_owned_attempt(&secondary).await?;
    assert_exhausted_recovery_resolves_the_current_candidate(&mut primary, &secondary).await?;
    cleanup_database(&secondary).await?;
    Ok(())
}

fn claim(attempt_id: &str, attempt_no: i32, fencing_token: i64) -> SmokeResult<ClaimedJob> {
    Ok(ClaimedJob {
        work_kind: String::from("analysis"),
        radar_operation_id: None,
        radar_basis_id: None,
        radar_generation: 0,
        job_id: String::from(JOB_ID),
        game_title_id: String::from(TITLE_ID),
        input_revision: 1,
        algorithm_version: String::from(ALGORITHM_VERSION),
        artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION)?,
        validation_contract_id: Some(String::from(ARTIFACT_VALIDATION_CONTRACT_ID)),
        attempt_id: String::from(attempt_id),
        attempt_no,
        fencing_token,
    })
}

fn build_manifest(
    claim: &ClaimedJob,
    directory: &std::path::Path,
) -> SmokeResult<ValidatedArtifact> {
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
    let validated =
        validate_artifact_directory(directory, 1_000, 16 * 1024 * 1024, 64 * 1024 * 1024, 1_001)?;
    if validated.manifest() != &built.manifest {
        return Err("the reopened artifact differs from the built manifest".into());
    }
    Ok(validated)
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
                    owner_member_id: String::from(MEMBER_IDS[0]),
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

async fn assert_staged_metadata_requires_an_exact_set(
    client: &mut Client,
    artifact: &ValidatedArtifact,
) -> SmokeResult {
    let transaction = client.transaction().await?;
    let mut reordered = artifact.manifest().clone();
    reordered.resources.reverse();
    validate_staged_resource_metadata(&transaction, &reordered).await?;

    let first = reordered
        .resources
        .first()
        .ok_or("fixture resource missing")?
        .clone();
    let mut duplicate = reordered.clone();
    duplicate.resources.push(first.clone());
    let mut omitted = reordered.clone();
    omitted.resources.pop().ok_or("fixture resource missing")?;
    let mut additional = reordered.clone();
    let mut absent_resource = first.clone();
    match &mut absent_resource {
        ResourceManifest::Achievements { common }
        | ResourceManifest::Aggregate { common }
        | ResourceManifest::Review { common }
        | ResourceManifest::OutlookSummary { common }
        | ResourceManifest::OutlookReference { common, .. }
        | ResourceManifest::Drilldown { common, .. }
        | ResourceManifest::MatchContext { common, .. } => {
            common.scope = momo_analysis_core::contract::ScopeRef::Season {
                season_master_id: String::from("absent-season"),
            };
        }
    }
    additional.resources.push(absent_resource);
    let mut mismatch = reordered.clone();
    match mismatch
        .resources
        .first_mut()
        .ok_or("fixture resource missing")?
    {
        ResourceManifest::Achievements { common }
        | ResourceManifest::Aggregate { common }
        | ResourceManifest::Review { common }
        | ResourceManifest::OutlookSummary { common }
        | ResourceManifest::OutlookReference { common, .. }
        | ResourceManifest::Drilldown { common, .. }
        | ResourceManifest::MatchContext { common, .. } => common.nesting_depth += 1,
    }
    for invalid in [duplicate, omitted, additional, mismatch] {
        assert!(matches!(
            validate_staged_resource_metadata(&transaction, &invalid).await,
            Err(ControlError::InvalidMetadata)
        ));
    }
    transaction.rollback().await?;
    Ok(())
}

async fn assert_authoritative_snapshot_rejects_omissions(
    client: &mut Client,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
) -> SmokeResult {
    let manifest = artifact.manifest();
    let transaction = client.transaction().await?;
    lock_owned(&transaction, claim, OLD_WORKER_ID).await?;
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
    artifact: &ValidatedArtifact,
    directory: &std::path::Path,
) -> SmokeResult {
    let manifest = artifact.manifest();
    let common = manifest
        .resources
        .iter()
        .rev()
        .find_map(|resource| match resource {
            ResourceManifest::MatchContext { common, .. } => Some(common),
            ResourceManifest::Achievements { .. }
            | ResourceManifest::Aggregate { .. }
            | ResourceManifest::Review { .. }
            | ResourceManifest::OutlookSummary { .. }
            | ResourceManifest::OutlookReference { .. }
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
    artifact: &ValidatedArtifact,
    directory: &std::path::Path,
) -> Result<(), ControlError> {
    let transaction = client.transaction().await?;
    stage_artifact(&transaction, claim, artifact, directory).await?;
    transaction.commit().await?;
    Ok(())
}

async fn stage_with_control_lock_probe(
    staging_client: &mut Client,
    probe_client: &mut Client,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
    directory: &std::path::Path,
) -> SmokeResult {
    let staging = staging_client.transaction().await?;
    stage_artifact(&staging, claim, artifact, directory).await?;
    let probe = probe_client.transaction().await?;
    probe
        .query_one(
            r"
                SELECT 1
                FROM series_analysis_title_states
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                FOR UPDATE NOWAIT
                ",
            &[&claim.game_title_id],
        )
        .await?;
    probe
        .query_one(
            r"
                SELECT 1
                FROM series_analysis_jobs
                WHERE series_analysis_jobs.legacy_id = $1
                FOR UPDATE NOWAIT
                ",
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
            r"
                WITH fixture_titles AS (
                       INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
                       VALUES (pg_temp.fixture_uuid('game_titles', '{TITLE_ID}'), '{TITLE_ID}', 'Analysis staging smoke', 'momotetsu_2', 9999)
                       RETURNING id
                     )
                  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
                  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
                  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
                  WHERE release.singleton_key = 'current'
                  ON CONFLICT (game_title_id) DO NOTHING;
                INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
                SELECT pg_temp.fixture_uuid('game_titles', '{TITLE_ID}'), algorithm_version, artifact_schema_version, validation_contract_id
                FROM series_analysis_release_state
                WHERE singleton_key = 'current'
                ON CONFLICT DO NOTHING;
                INSERT INTO held_events (id, legacy_id, session_id, held_date_iso, start_at)
                VALUES (pg_temp.fixture_uuid('held_events', '{EVENT_ID}'), '{EVENT_ID}', NULL, CAST('2026-08-14' AS date),
                        CAST('2026-08-14 00:00:00+00' AS timestamptz));
                INSERT INTO season_masters (id, legacy_id, game_title_id, name, display_order)
                VALUES (pg_temp.fixture_uuid('season_masters', '{SEASON_ID}'), '{SEASON_ID}',
                        pg_temp.fixture_uuid('game_titles', '{TITLE_ID}'), 'Analysis staging season', 9999);
                INSERT INTO map_masters (id, legacy_id, game_title_id, name, display_order)
                VALUES (pg_temp.fixture_uuid('map_masters', '{MAP_ID}'), '{MAP_ID}',
                        pg_temp.fixture_uuid('game_titles', '{TITLE_ID}'), 'Analysis staging map', 9999);
                INSERT INTO matches (id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event, game_title_id,
                                     layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_account_id,
                                     created_by_member_id, analysis_revision)
                VALUES (pg_temp.fixture_uuid('matches', '{MATCH_ID}'), '{MATCH_ID}',
                        pg_temp.fixture_uuid('held_events', '{EVENT_ID}'), '{EVENT_ID}', 1,
                        pg_temp.fixture_uuid('game_titles', '{TITLE_ID}'), 'momotetsu_2',
                        pg_temp.fixture_uuid('season_masters', '{SEASON_ID}'), pg_temp.fixture_uuid('members', 'member_ponta'),
                        pg_temp.fixture_uuid('map_masters', '{MAP_ID}'), CAST('2026-08-14 00:00:00+00' AS timestamptz),
                        pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), pg_temp.fixture_uuid('members', 'member_ponta'), 1);
                INSERT INTO match_players (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
                VALUES (pg_temp.fixture_uuid('matches', '{MATCH_ID}'), pg_temp.fixture_uuid('members', 'member_ponta'), 1, 1, 1000, 100),
                       (pg_temp.fixture_uuid('matches', '{MATCH_ID}'), pg_temp.fixture_uuid('members', 'member_akane_mami'), 2, 2, 2000, 200),
                       (pg_temp.fixture_uuid('matches', '{MATCH_ID}'), pg_temp.fixture_uuid('members', 'member_otaka'), 3, 3, 3000, 300),
                       (pg_temp.fixture_uuid('matches', '{MATCH_ID}'), pg_temp.fixture_uuid('members', 'member_eu'), 4, 4, 4000, 400);
                UPDATE series_analysis_title_states
                SET input_revision = 1, algorithm_version = '{ALGORITHM_VERSION}',
                    artifact_schema_version = {ARTIFACT_SCHEMA_VERSION}, validation_contract_id = '{ARTIFACT_VALIDATION_CONTRACT_ID}',
                    pending_work = TRUE
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = '{TITLE_ID}';
                INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                                  artifact_schema_version, validation_contract_id, status, trigger, started_at, lease_owner, lease_attempt_id,
                                                  legacy_lease_attempt_id, lease_fencing_token, lease_expires_at, lease_validation_contract_id, attempt_count,
                                                  fencing_counter)
                VALUES (pg_temp.fixture_uuid('series_analysis_jobs', '{JOB_ID}'), '{JOB_ID}',
                        pg_temp.fixture_uuid('game_titles', '{TITLE_ID}'), 1, '{ALGORITHM_VERSION}', {ARTIFACT_SCHEMA_VERSION},
                        '{ARTIFACT_VALIDATION_CONTRACT_ID}', 'running', 'manual', clock_timestamp(), '{OLD_WORKER_ID}',
                        pg_temp.fixture_uuid('series_analysis_job_attempts', '{OLD_ATTEMPT_ID}'), '{OLD_ATTEMPT_ID}', {OLD_FENCE},
                        clock_timestamp() + CAST('10 minutes' AS interval), '{ARTIFACT_VALIDATION_CONTRACT_ID}', 1, {OLD_FENCE});
                INSERT INTO series_analysis_job_attempts (id, legacy_id, job_id, attempt_no, owner, fencing_token, input_revision,
                                                          algorithm_version, artifact_schema_version, validation_contract_id, status, effective_config_version,
                                                          calculation_timeout_milliseconds)
                VALUES (pg_temp.fixture_uuid('series_analysis_job_attempts', '{OLD_ATTEMPT_ID}'), '{OLD_ATTEMPT_ID}',
                        pg_temp.fixture_uuid('series_analysis_jobs', '{JOB_ID}'), 1, '{OLD_WORKER_ID}', {OLD_FENCE}, 1,
                        '{ALGORITHM_VERSION}', {ARTIFACT_SCHEMA_VERSION}, '{ARTIFACT_VALIDATION_CONTRACT_ID}', 'running', 'staging-smoke',
                        60000);
                "
        ))
        .await?;
    Ok(())
}

async fn assert_claim_reports_database_availability_delay(client: &mut Client) -> SmokeResult {
    let transaction = client.transaction().await?;
    transaction
        .batch_execute(&format!(
            r"
                UPDATE series_analysis_jobs
                SET status = 'queued', available_at = clock_timestamp() + CAST('1 hour' AS interval), started_at = NULL,
                    lease_owner = NULL, lease_attempt_id = NULL, legacy_lease_attempt_id = NULL, lease_fencing_token = NULL,
                    lease_expires_at = NULL, lease_validation_contract_id = NULL, updated_at = clock_timestamp()
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}';
                "
        ))
        .await?;

    let remaining_delay = match prepare_claim(&transaction, JOB_ID).await? {
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

fn old_job_lease() -> crate::job_lease::ExpiredJobLease {
    crate::job_lease::ExpiredJobLease {
        job_id: String::from(JOB_ID),
        owner: String::from(OLD_WORKER_ID),
        attempt_id: String::from(OLD_ATTEMPT_ID),
        fencing_token: OLD_FENCE,
    }
}

async fn assert_recovery_rejects_a_mismatched_job_owner(
    primary: &mut Client,
    secondary: &Client,
) -> SmokeResult {
    secondary
        .batch_execute(&format!(
            r"
                UPDATE series_analysis_jobs
                SET lease_owner = '{NEW_WORKER_ID}', lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                "
        ))
        .await?;
    let transaction = primary.transaction().await?;
    let holder = old_job_lease();
    assert_eq!(
        recover_expired_analysis_job(&transaction, &holder).await?,
        TransactionEffects::empty()
    );
    transaction.rollback().await?;

    let unchanged = secondary
        .query_one(
            r"
                SELECT j.status, j.lease_owner, a.status, j.fencing_counter
                FROM series_analysis_jobs AS j INNER JOIN series_analysis_job_attempts AS a ON a.legacy_id = $2
                WHERE j.legacy_id = $1
                ",
            &[&JOB_ID, &OLD_ATTEMPT_ID],
        )
        .await?;
    assert_eq!(unchanged.try_get::<_, String>(0)?, "running");
    assert_eq!(unchanged.try_get::<_, String>(1)?, NEW_WORKER_ID);
    assert_eq!(unchanged.try_get::<_, String>(2)?, "running");
    assert_eq!(unchanged.try_get::<_, i64>(3)?, OLD_FENCE);

    secondary
        .batch_execute(&format!(
            r"
                UPDATE series_analysis_jobs
                SET lease_owner = '{OLD_WORKER_ID}', lease_expires_at = clock_timestamp() + CAST('10 minutes' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                "
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
            r"
                UPDATE series_analysis_jobs
                SET lease_recovery_count = 3, lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                "
        ))
        .await?;
    let title_holder = secondary.transaction().await?;
    title_holder
        .query_one(
            r"
                SELECT (SELECT fixture_parent.legacy_id
                        FROM game_titles AS fixture_parent
                        WHERE fixture_parent.id = series_analysis_title_states.game_title_id) AS game_title_id
                FROM series_analysis_title_states
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                FOR UPDATE
                ",
            &[&TITLE_ID],
        )
        .await?;

    let recovery_transaction = primary.transaction().await?;
    let holder = old_job_lease();
    {
        let recovery = recover_expired_analysis_job(&recovery_transaction, &holder);
        tokio::pin!(recovery);
        wait_for_backend_lock(&title_holder, recovery_backend_pid, recovery.as_mut()).await?;

        title_holder
            .query_one(
                r"
                    SELECT series_analysis_jobs.legacy_id AS id
                    FROM series_analysis_jobs
                    WHERE series_analysis_jobs.legacy_id = $1
                    FOR UPDATE NOWAIT
                    ",
                &[&JOB_ID],
            )
            .await?;
        title_holder.rollback().await?;
        tokio::time::timeout(Duration::from_secs(1), &mut recovery).await??;
    }
    recovery_transaction.rollback().await?;

    secondary
        .batch_execute(&format!(
            r"
                UPDATE series_analysis_jobs
                SET lease_recovery_count = 0, lease_expires_at = clock_timestamp() + CAST('10 minutes' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                "
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
            r"
                UPDATE series_analysis_jobs
                SET lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                "
        ))
        .await?;

    let recovery_transaction = primary.transaction().await?;
    let recovery_effects = match prepare_claim(&recovery_transaction, JOB_ID).await? {
        ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_candidate_resolved,
        } => {
            assert!(current_candidate_resolved);
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
            r"
                SELECT j.status, j.lease_owner, j.available_at <= clock_timestamp()
                FROM series_analysis_jobs AS j
                WHERE j.legacy_id = $1
                ",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(recovered.try_get::<_, String>(0)?, "queued");
    assert_eq!(recovered.try_get::<_, Option<String>>(1)?, None);
    assert!(recovered.try_get::<_, bool>(2)?);

    let next_claim_transaction = primary.transaction().await?;
    assert!(matches!(
        prepare_claim(&next_claim_transaction, JOB_ID).await?,
        ClaimPreparation::Ready { .. }
    ));
    next_claim_transaction.rollback().await?;
    Ok(())
}

async fn assert_exhausted_recovery_resolves_the_current_candidate(
    primary: &mut Client,
    observer: &Client,
) -> SmokeResult {
    observer
        .batch_execute(&format!(
            r"
                UPDATE series_analysis_jobs
                SET lease_recovery_count = 3, lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                "
        ))
        .await?;

    let transaction = primary.transaction().await?;
    let recovery_effects = match prepare_claim(&transaction, JOB_ID).await? {
        ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_candidate_resolved,
        } => {
            assert!(current_candidate_resolved);
            effects
        }
        ClaimPreparation::Ready { .. } | ClaimPreparation::Rejected(_) => {
            return Err("exhausted lease recovery did not resolve the current candidate".into());
        }
    };
    assert_eq!(recovery_effects, TransactionEffects::empty());
    transaction.commit().await?;

    let terminal = observer
        .query_one(
            r"
                SELECT j.status
                     , j.lease_recovery_count
                     , j.safe_failure_code
                     , a.status
                     , a.outcome
                     , j.lease_owner
                     , j.legacy_lease_attempt_id AS lease_attempt_id
                FROM series_analysis_jobs AS j INNER JOIN series_analysis_job_attempts AS a ON a.legacy_id = $2
                WHERE j.legacy_id = $1
                ",
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
            r"
                UPDATE series_analysis_job_attempts
                SET status = 'terminal', outcome = 'owner_lost', finished_at = clock_timestamp()
                WHERE series_analysis_job_attempts.legacy_id = '{OLD_ATTEMPT_ID}';
                UPDATE series_analysis_jobs
                SET lease_owner = '{NEW_WORKER_ID}',
                    lease_attempt_id = pg_temp.fixture_uuid('series_analysis_job_attempts', '{NEW_ATTEMPT_ID}'),
                    legacy_lease_attempt_id = '{NEW_ATTEMPT_ID}', lease_fencing_token = {NEW_FENCE}, fencing_counter = {NEW_FENCE},
                    lease_expires_at = clock_timestamp() + CAST('10 minutes' AS interval), attempt_count = 2
                WHERE series_analysis_jobs.legacy_id = '{JOB_ID}' AND status = 'running';
                INSERT INTO series_analysis_job_attempts (id, legacy_id, job_id, attempt_no, owner, fencing_token, input_revision,
                                                          algorithm_version, artifact_schema_version, validation_contract_id, status, effective_config_version,
                                                          calculation_timeout_milliseconds)
                VALUES (pg_temp.fixture_uuid('series_analysis_job_attempts', '{NEW_ATTEMPT_ID}'), '{NEW_ATTEMPT_ID}',
                        pg_temp.fixture_uuid('series_analysis_jobs', '{JOB_ID}'), 2, '{NEW_WORKER_ID}', {NEW_FENCE}, 1,
                        '{ALGORITHM_VERSION}', {ARTIFACT_SCHEMA_VERSION}, '{ARTIFACT_VALIDATION_CONTRACT_ID}', 'running', 'staging-smoke',
                        60000);
                "
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

async fn assert_validation_contract(client: &Client, artifact: &ValidatedArtifact) -> SmokeResult {
    let stored = client
        .query_one(
            "SELECT validation_contract_id FROM series_analysis_artifacts WHERE id = $1",
            &[&artifact.manifest().artifact_id],
        )
        .await?
        .try_get::<_, Option<String>>(0)?;
    assert_eq!(stored.as_deref(), Some(artifact.validation_contract_id()));
    Ok(())
}

async fn seed_unattested_current(client: &mut Client, artifact: &ValidatedArtifact) -> SmokeResult {
    let artifact_id = &artifact.manifest().artifact_id;
    let transaction = client.transaction().await?;
    // The isolated smoke must represent a pointer that predates the attestation migration. New
    // runtime writes cannot create this state because the pointer guard now rejects it.
    transaction
        .batch_execute("SET LOCAL session_replication_role = replica")
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_artifacts SET\x20\
               validation_contract_id = NULL, status = 'published',\x20\
               published_at = clock_timestamp() - interval '2 days'\x20\
             WHERE id = $1 AND status = 'staging'",
            &[artifact_id],
        )
        .await?;
    transaction
        .execute(
            r"
                UPDATE series_analysis_title_states
                SET current_artifact_id = pg_temp.fixture_uuid('series_analysis_artifacts', $1)
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $2
                ",
            &[artifact_id, &TITLE_ID],
        )
        .await?;
    transaction.commit().await?;
    Ok(())
}

async fn assert_artifact_pointers(
    client: &Client,
    expected_current: Option<&str>,
    expected_previous: Option<&str>,
) -> SmokeResult {
    let row = client
        .query_one(
            r"
                SELECT (SELECT fixture_parent.legacy_id
                        FROM series_analysis_artifact_identities AS fixture_parent
                        WHERE fixture_parent.id = series_analysis_title_states.current_artifact_id) AS current_artifact_id,
                       (SELECT fixture_parent.legacy_id
                        FROM series_analysis_artifact_identities AS fixture_parent
                        WHERE fixture_parent.id = series_analysis_title_states.previous_artifact_id) AS previous_artifact_id
                FROM series_analysis_title_states
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                ",
            &[&TITLE_ID],
        )
        .await?;
    assert_eq!(
        row.try_get::<_, Option<String>>(0)?.as_deref(),
        expected_current
    );
    assert_eq!(
        row.try_get::<_, Option<String>>(1)?.as_deref(),
        expected_previous
    );
    Ok(())
}

async fn assert_current(client: &Client, expected: Option<&str>) -> SmokeResult {
    let actual = client
        .query_one(
            r"
                SELECT (SELECT fixture_parent.legacy_id
                        FROM series_analysis_artifact_identities AS fixture_parent
                        WHERE fixture_parent.id = series_analysis_title_states.current_artifact_id) AS current_artifact_id
                FROM series_analysis_title_states
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                ",
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
            r"
                DELETE FROM matches
                WHERE matches.legacy_id = '{MATCH_ID}';
                DELETE FROM held_events
                WHERE held_events.legacy_id = '{EVENT_ID}';
                DELETE FROM season_masters
                WHERE season_masters.legacy_id = '{SEASON_ID}';
                DELETE FROM map_masters
                WHERE map_masters.legacy_id = '{MAP_ID}';
                DELETE FROM game_titles
                WHERE game_titles.legacy_id = '{TITLE_ID}';
                "
        ))
        .await?;
    Ok(())
}
