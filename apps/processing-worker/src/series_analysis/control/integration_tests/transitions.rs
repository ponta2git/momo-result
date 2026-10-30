use super::*;
use crate::{
    notifications::NotificationSink,
    series_analysis::control::{
        AttemptFailure, RequeueCause, claim_job, finish_failure, requeue_interrupted,
        retry_transient_failure, supersede,
    },
};

const CURRENT_REQUEST: &str = "analysis-transition-current-request";
const OTHER_REQUEST: &str = "analysis-transition-other-request";
const OTHER_ATTEMPT: &str = "analysis-transition-retained-attempt";

enum Transition {
    Supersede,
    Retry,
    GracefulStop,
    Recover,
    Fail,
    ExhaustRetry,
    ExhaustRecovery,
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_requeues_bind_current_radar_and_every_exit_clears_the_lease() -> SmokeResult
{
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    let directory = TempDir::new()?;
    let config =
        notifications::config(&database_url, NotificationSink::default(), directory.path())?;
    let claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    let metrics = AttemptMetrics::default();
    for transition in [
        Transition::Supersede,
        Transition::Retry,
        Transition::GracefulStop,
        Transition::Recover,
        Transition::Fail,
        Transition::ExhaustRetry,
        Transition::ExhaustRecovery,
    ] {
        cleanup_transition(&client).await?;
        prepare_owned_attempt(&client).await?;
        if matches!(
            transition,
            Transition::Supersede
                | Transition::Retry
                | Transition::GracefulStop
                | Transition::Recover
        ) {
            seed_assigned_requests(&client).await?;
        }
        client
            .execute(
                r"
                    INSERT INTO series_radar_title_states (game_title_id, generation)
                    VALUES (pg_temp.fixture_uuid('game_titles', $1), 9)
                    ",
                &[&TITLE_ID],
            )
            .await?;
        let queued = match transition {
            Transition::Supersede => {
                client.execute(r"
                    UPDATE series_analysis_title_states
                    SET input_revision = 2
                    WHERE (SELECT fixture_parent.legacy_id
                           FROM game_titles AS fixture_parent
                           WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                    ", &[&TITLE_ID]).await?;
                let _outcome = supersede(&mut client, &claim, &config, &metrics).await?;
                true
            }
            Transition::Retry | Transition::ExhaustRetry => {
                let exhausted = matches!(transition, Transition::ExhaustRetry);
                if exhausted {
                    client
                        .execute(
                            r"
                        UPDATE series_analysis_jobs
                        SET transient_retry_count = 3
                        WHERE series_analysis_jobs.legacy_id = $1
                        ",
                            &[&JOB_ID],
                        )
                        .await?;
                }
                let _outcome =
                    retry_transient_failure(&mut client, &claim, &config, &metrics).await?;
                !exhausted
            }
            Transition::GracefulStop => {
                let _outcome = requeue_interrupted(
                    &mut client,
                    &claim,
                    &config,
                    RequeueCause::GracefulStop,
                    &metrics,
                )
                .await?;
                true
            }
            Transition::Recover | Transition::ExhaustRecovery => {
                let exhausted = matches!(transition, Transition::ExhaustRecovery);
                let recovery_count = if exhausted { 3 } else { 0 };
                client.execute(r"
                    UPDATE series_analysis_jobs
                    SET lease_recovery_count = $2, lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                    WHERE series_analysis_jobs.legacy_id = $1
                    ", &[&JOB_ID, &recovery_count]).await?;
                let transaction = client.transaction().await?;
                let holder = crate::job_lease::ExpiredJobLease {
                    job_id: String::from(JOB_ID),
                    owner: String::from(OLD_WORKER_ID),
                    attempt_id: String::from(OLD_ATTEMPT_ID),
                    fencing_token: OLD_FENCE,
                };
                recover_expired_analysis_job(&transaction, &holder).await?;
                transaction.commit().await?;
                !exhausted
            }
            Transition::Fail => {
                let _outcome = finish_failure(
                    &mut client,
                    &claim,
                    &config,
                    AttemptFailure::failed(SafeFailureCode::CalculationFailed),
                    &metrics,
                )
                .await?;
                false
            }
        };
        let state = client
            .query_one(
                r"
                    SELECT status
                         , radar_generation
                         ,     lease_owner IS NULL
                           AND series_analysis_jobs.legacy_lease_attempt_id IS NULL
                           AND lease_fencing_token IS NULL
                           AND lease_expires_at IS NULL
                           AND lease_validation_contract_id IS NULL
                         , attempt_count
                    FROM series_analysis_jobs
                    WHERE series_analysis_jobs.legacy_id = $1
                    ",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(
            state.try_get::<_, String>(0)?,
            if queued { "queued" } else { "failed" }
        );
        assert_eq!(state.try_get::<_, i64>(1)?, if queued { 9 } else { 0 });
        assert!(
            state.try_get::<_, bool>(2)?,
            "every owned exit clears the complete lease"
        );
        assert_eq!(
            state.try_get::<_, i32>(3)?,
            1,
            "assignment cannot create another attempt"
        );
        if queued {
            assert_request_assignment(&client, CURRENT_REQUEST, "pending", None).await?;
            assert_request_assignment(&client, OTHER_REQUEST, "fulfilled", Some(OTHER_ATTEMPT))
                .await?;
            let before: String = client
                .query_one(
                    r"
                        SELECT CAST(ctid AS text)
                        FROM series_analysis_jobs
                        WHERE series_analysis_jobs.legacy_id = $1
                        ",
                    &[&JOB_ID],
                )
                .await?
                .try_get(0)?;
            let transaction = client.transaction().await?;
            transaction.query_one(r"
                SELECT (SELECT fixture_parent.legacy_id
                        FROM game_titles AS fixture_parent
                        WHERE fixture_parent.id = series_analysis_title_states.game_title_id) AS game_title_id
                FROM series_analysis_title_states
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                FOR UPDATE
                ", &[&TITLE_ID]).await?;
            crate::series_analysis::job_transitions::bind_queued_radar(&transaction, &[TITLE_ID])
                .await?;
            let after: String = transaction
                .query_one(
                    r"
                        SELECT CAST(ctid AS text)
                        FROM series_analysis_jobs
                        WHERE series_analysis_jobs.legacy_id = $1
                        ",
                    &[&JOB_ID],
                )
                .await?
                .try_get(0)?;
            assert_eq!(
                after, before,
                "an already-bound queue row is not written again"
            );
            transaction.commit().await?;

            // Make a delayed retry due without adding a real-time wait to this transition test.
            client
                .execute(
                    "UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE legacy_id = $1",
                    &[&JOB_ID],
                )
                .await?;
            let ClaimResult::Claimed(next) = claim_job(&mut client, JOB_ID, &config).await?.value
            else {
                return Err("the requeued request must be claimable by the next attempt".into());
            };
            assert_ne!(next.attempt_id, claim.attempt_id);
            assert_request_assignment(&client, CURRENT_REQUEST, "assigned", Some(&next.attempt_id))
                .await?;
            assert_request_assignment(&client, OTHER_REQUEST, "fulfilled", Some(OTHER_ATTEMPT))
                .await?;
        }
    }
    drop(config);
    cleanup_transition(&client).await?;
    Ok(())
}

async fn cleanup_transition(client: &Client) -> SmokeResult {
    client
        .execute(
            "DELETE FROM series_analysis_job_requests WHERE legacy_id IN ($1, $2)",
            &[&CURRENT_REQUEST, &OTHER_REQUEST],
        )
        .await?;
    cleanup_database(client).await
}

async fn seed_assigned_requests(client: &Client) -> SmokeResult {
    // A fulfilled request retains its old attempt identity after attempt-history cleanup.
    // Sharing the job makes an accidental job-wide release observable.
    client
        .execute(
            r"
        INSERT INTO series_analysis_job_requests
          (id, legacy_id, game_title_id, legacy_game_title_id, input_revision, algorithm_version,
           artifact_schema_version, validation_contract_id, trigger, status, assigned_job_id,
           assigned_attempt_id, legacy_assigned_attempt_id, fulfilled_at)
        SELECT pg_temp.fixture_uuid('series_analysis_job_requests', request.id), request.id,
               job.game_title_id, $5, job.input_revision, job.algorithm_version,
               job.artifact_schema_version, job.validation_contract_id, 'manual', request.status,
               job.id, pg_temp.fixture_uuid('series_analysis_job_attempts', request.attempt_id),
               request.attempt_id,
               CASE WHEN request.status = 'fulfilled' THEN clock_timestamp() END
        FROM series_analysis_jobs job
        CROSS JOIN (VALUES ($1::text, $2::text, 'assigned'),
                           ($3::text, $4::text, 'fulfilled'))
          request(id, attempt_id, status)
        WHERE job.legacy_id = $6
        ",
            &[
                &CURRENT_REQUEST,
                &OLD_ATTEMPT_ID,
                &OTHER_REQUEST,
                &OTHER_ATTEMPT,
                &TITLE_ID,
                &JOB_ID,
            ],
        )
        .await?;
    Ok(())
}

async fn assert_request_assignment(
    client: &Client,
    request_id: &str,
    status: &str,
    attempt_id: Option<&str>,
) -> SmokeResult {
    let row = client
        .query_one(
            r"
        SELECT status, legacy_assigned_attempt_id,
               assigned_attempt_id IS NOT DISTINCT FROM
                 CASE WHEN $2::text IS NOT NULL
                      THEN pg_temp.fixture_uuid('series_analysis_job_attempts', $2) END,
               assigned_job_id = pg_temp.fixture_uuid('series_analysis_jobs', $3)
        FROM series_analysis_job_requests WHERE legacy_id = $1
        ",
            &[&request_id, &attempt_id, &JOB_ID],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, status);
    assert_eq!(row.try_get::<_, Option<String>>(1)?.as_deref(), attempt_id);
    assert!(row.try_get::<_, bool>(2)?, "canonical attempt assignment");
    assert!(
        row.try_get::<_, bool>(3)?,
        "logical job assignment is retained"
    );
    Ok(())
}
