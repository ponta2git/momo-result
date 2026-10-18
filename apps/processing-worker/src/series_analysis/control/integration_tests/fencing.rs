//! Job fencing must survive history cleanup and remain independent across worker instances.
use super::{
    AttemptMetrics, ClaimResult, ClaimedJob, ControlError, JOB_ID, NEW_WORKER_ID, OLD_FENCE,
    SmokeResult, TempDir, cleanup_database, notifications, prepare_owned_attempt,
};
use crate::{
    notifications::NotificationSink,
    series_analysis::control::{
        AttemptFailure, HeartbeatResult, RequeueCause, SafeFailureCode, claim_job, finish_failure,
        heartbeat, requeue_interrupted,
    },
};

const SECOND: &str = "analysis-fencing-independent-job";
const SECOND_FLOOR: i64 = 9_000_000;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_job_fences_survive_cleanup_recovery_and_independent_workers() -> SmokeResult
{
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = crate::identity::fixtures::connect(&database_url).await?;
    let mut secondary = crate::identity::fixtures::connect(&database_url).await?;
    cleanup_database(&primary).await?;
    primary
        .execute(
            r"
            DELETE FROM game_titles
            WHERE game_titles.legacy_id = $1
            ",
            &[&SECOND],
        )
        .await?;
    prepare_owned_attempt(&primary).await?;
    primary
        .execute(
            r"
                DELETE FROM series_analysis_job_attempts
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_analysis_jobs AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_job_attempts.job_id) = $1
                ",
            &[&JOB_ID],
        )
        .await?;
    primary
        .execute(
            r"
        UPDATE series_analysis_jobs
        SET status = 'queued', started_at = NULL, lease_owner = NULL, lease_attempt_id = NULL,
            legacy_lease_attempt_id = NULL, lease_fencing_token = NULL, lease_expires_at = NULL,
            lease_validation_contract_id = NULL, attempt_count = 0, available_at = clock_timestamp()
        WHERE series_analysis_jobs.legacy_id = $1
        ",
            &[&JOB_ID],
        )
        .await?;
    primary.execute(r"
        WITH fixture_titles AS (
               INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
               VALUES (pg_temp.fixture_uuid('game_titles', $1), $1, 'Independent worker fence', 'momotetsu_2', 9998)
               RETURNING id
             )
          INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
          SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
          FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
          WHERE release.singleton_key = 'current'
          ON CONFLICT (game_title_id) DO NOTHING
        ", &[&SECOND]).await?;
    primary
        .execute(
            r"
        INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                          artifact_schema_version, validation_contract_id, status, trigger, fencing_counter)
        SELECT pg_temp.fixture_uuid('series_analysis_jobs', $1), $1, pg_temp.fixture_uuid('game_titles', $1),
               input_revision, algorithm_version, artifact_schema_version, validation_contract_id, 'queued', 'manual', $2
        FROM series_analysis_jobs
        WHERE series_analysis_jobs.legacy_id = $3
        ",
            &[&SECOND, &SECOND_FLOOR, &JOB_ID],
        )
        .await?;
    let directory = TempDir::new()?;
    let first_config =
        notifications::config(&database_url, NotificationSink::default(), directory.path())?;
    let second_config = crate::series_analysis::config::AnalysisConsumerConfig {
        worker_id: String::from(NEW_WORKER_ID),
        ..first_config.clone()
    };
    let (first, second) = tokio::join!(
        claim_job(&mut primary, JOB_ID, &first_config),
        claim_job(&mut secondary, JOB_ID, &second_config),
    );
    let (first_claim, owner) = match (first?.value, second?.value) {
        (ClaimResult::Claimed(claim), ClaimResult::Busy) => (claim, first_config.clone()),
        (ClaimResult::Busy, ClaimResult::Claimed(claim)) => (claim, second_config.clone()),
        results => {
            return Err(format!("same-job claims did not elect one owner: {results:?}").into());
        }
    };
    assert_eq!(first_claim.fencing_token, OLD_FENCE + 1);
    let independent = claimed(
        claim_job(&mut secondary, SECOND, &second_config)
            .await?
            .value,
    )?;
    assert_eq!(independent.fencing_token, SECOND_FLOOR + 1);
    assert_eq!(
        heartbeat(&mut primary, &first_claim, &owner).await?,
        HeartbeatResult::Continue
    );
    assert_counter(&primary, JOB_ID, OLD_FENCE + 1).await?;
    let _outcome = requeue_interrupted(
        &mut primary,
        &first_claim,
        &owner,
        RequeueCause::GracefulStop,
        &AttemptMetrics::default(),
    )
    .await?;
    assert_counter(&primary, JOB_ID, OLD_FENCE + 1).await?;
    assert_old_owner_rejected(&mut primary, &first_claim, &owner).await?;

    // Retention may remove every completed attempt. The job counter remains authoritative.
    primary
        .execute(
            r"
                DELETE FROM series_analysis_job_attempts
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_analysis_jobs AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_job_attempts.job_id) = $1
                  AND status = 'terminal'
                ",
            &[&JOB_ID],
        )
        .await?;
    let retry = claimed(claim_job(&mut primary, JOB_ID, &owner).await?.value)?;
    assert_eq!(retry.fencing_token, OLD_FENCE + 2);
    primary
        .execute(
            r"
        UPDATE series_analysis_jobs
        SET lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
        WHERE series_analysis_jobs.legacy_id = $1
        ",
            &[&JOB_ID],
        )
        .await?;
    assert!(matches!(
        claim_job(&mut primary, JOB_ID, &owner).await?.value,
        ClaimResult::RecoveredCurrentJob
    ));
    assert_counter(&primary, JOB_ID, OLD_FENCE + 2).await?;
    assert_old_owner_rejected(&mut primary, &retry, &owner).await?;
    let recovered = claimed(claim_job(&mut primary, JOB_ID, &owner).await?.value)?;
    assert_eq!(recovered.fencing_token, OLD_FENCE + 3);
    let _outcome = finish_failure(
        &mut primary,
        &recovered,
        &owner,
        AttemptFailure::failed(SafeFailureCode::CalculationFailed),
        &AttemptMetrics::default(),
    )
    .await?;
    assert_counter(&primary, JOB_ID, OLD_FENCE + 3).await?;

    let _outcome = requeue_interrupted(
        &mut secondary,
        &independent,
        &second_config,
        RequeueCause::GracefulStop,
        &AttemptMetrics::default(),
    )
    .await?;
    primary
        .execute(
            r"
                UPDATE series_analysis_jobs
                SET fencing_counter = $2
                WHERE series_analysis_jobs.legacy_id = $1
                ",
            &[&SECOND, &i64::MAX],
        )
        .await?;
    assert!(matches!(
        claim_job(&mut secondary, SECOND, &second_config).await,
        Err(ControlError::NumericBound)
    ));
    let exhausted = primary
        .query_one(
            r"
        SELECT status, attempt_count, fencing_counter, lease_owner
        FROM series_analysis_jobs
        WHERE series_analysis_jobs.legacy_id = $1
        ",
            &[&SECOND],
        )
        .await?;
    assert_eq!(exhausted.try_get::<_, String>(0)?, "queued");
    assert_eq!(exhausted.try_get::<_, i32>(1)?, 1);
    assert_eq!(exhausted.try_get::<_, i64>(2)?, i64::MAX);
    assert_eq!(exhausted.try_get::<_, Option<String>>(3)?, None);
    drop((owner, first_config, second_config));
    cleanup_database(&primary).await?;
    primary
        .execute(
            r"
            DELETE FROM game_titles
            WHERE game_titles.legacy_id = $1
            ",
            &[&SECOND],
        )
        .await?;
    Ok(())
}

fn claimed(result: ClaimResult) -> SmokeResult<ClaimedJob> {
    match result {
        ClaimResult::Claimed(claim) => Ok(claim),
        other @ (ClaimResult::RecoveredCurrentJob
        | ClaimResult::Busy
        | ClaimResult::MissingOrTerminal
        | ClaimResult::UnsupportedVersion(_)
        | ClaimResult::NotYetAvailable { .. }) => {
            Err(format!("expected claimed job, got {other:?}").into())
        }
    }
}

async fn assert_counter(client: &tokio_postgres::Client, job: &str, expected: i64) -> SmokeResult {
    let stored: i64 = client
        .query_one(
            r"
                SELECT fencing_counter
                FROM series_analysis_jobs
                WHERE series_analysis_jobs.legacy_id = $1
                ",
            &[&job],
        )
        .await?
        .try_get(0)?;
    assert_eq!(stored, expected);
    Ok(())
}

async fn assert_old_owner_rejected(
    client: &mut tokio_postgres::Client,
    claim: &ClaimedJob,
    config: &crate::series_analysis::config::AnalysisConsumerConfig,
) -> SmokeResult {
    assert_eq!(
        heartbeat(client, claim, config).await?,
        HeartbeatResult::OwnerLost
    );
    assert!(matches!(
        finish_failure(
            client,
            claim,
            config,
            AttemptFailure::failed(SafeFailureCode::CalculationFailed),
            &AttemptMetrics::default()
        )
        .await,
        Err(ControlError::OwnerLost)
    ));
    Ok(())
}
