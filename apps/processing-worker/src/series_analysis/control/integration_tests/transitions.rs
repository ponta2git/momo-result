use super::*;
use crate::{
    notifications::NotificationSink,
    series_analysis::control::{
        AttemptFailure, RequeueCause, finish_failure, requeue_interrupted, retry_transient_failure,
        supersede,
    },
};

enum Transition {
    Supersede,
    Retry,
    GracefulStop,
    Preempt,
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
    let mut client = crate::postgres::connect(&database_url).await?;
    let directory = TempDir::new()?;
    let config =
        notifications::config(&database_url, NotificationSink::default(), directory.path())?;
    let claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    let metrics = AttemptMetrics::default();
    for transition in [
        Transition::Supersede,
        Transition::Retry,
        Transition::GracefulStop,
        Transition::Preempt,
        Transition::Recover,
        Transition::Fail,
        Transition::ExhaustRetry,
        Transition::ExhaustRecovery,
    ] {
        cleanup_database(&client).await?;
        prepare_owned_attempt(&client).await?;
        client
            .execute(
                "INSERT INTO series_radar_title_states (game_title_id, generation) VALUES ($1, 9)",
                &[&TITLE_ID],
            )
            .await?;
        let queued = match transition {
            Transition::Supersede => {
                client.execute("UPDATE series_analysis_title_states SET input_revision = 2 WHERE game_title_id = $1", &[&TITLE_ID]).await?;
                let _outcome = supersede(&mut client, &claim, &config, &metrics).await?;
                true
            }
            Transition::Retry | Transition::ExhaustRetry => {
                let exhausted = matches!(transition, Transition::ExhaustRetry);
                if exhausted {
                    client.execute("UPDATE series_analysis_jobs SET transient_retry_count = 3 WHERE id = $1", &[&JOB_ID]).await?;
                }
                let _outcome =
                    retry_transient_failure(&mut client, &claim, &config, &metrics).await?;
                !exhausted
            }
            Transition::GracefulStop | Transition::Preempt => {
                let cause = if matches!(transition, Transition::Preempt) {
                    RequeueCause::Preempted
                } else {
                    RequeueCause::GracefulStop
                };
                let _outcome =
                    requeue_interrupted(&mut client, &claim, &config, cause, &metrics).await?;
                true
            }
            Transition::Recover | Transition::ExhaustRecovery => {
                let exhausted = matches!(transition, Transition::ExhaustRecovery);
                let recovery_count = if exhausted { 3 } else { 0 };
                client.execute("UPDATE series_analysis_jobs SET lease_recovery_count = $2, lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", &[&JOB_ID, &recovery_count]).await?;
                client.execute("UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", &[&JOB_ID]).await?;
                let transaction = client.transaction().await?;
                let holder = crate::execution_slot::lock(&transaction)
                    .await?
                    .holder
                    .ok_or("expired analysis holder is missing")?;
                recover_expired_analysis_holder(&transaction, &holder).await?;
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
                "SELECT status, radar_generation, lease_owner IS NULL AND lease_attempt_id IS NULL \
                   AND lease_fencing_token IS NULL AND lease_expires_at IS NULL \
                   AND lease_validation_contract_id IS NULL, attempt_count \
                 FROM series_analysis_jobs WHERE id = $1",
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
            let before: String = client
                .query_one(
                    "SELECT ctid::text FROM series_analysis_jobs WHERE id = $1",
                    &[&JOB_ID],
                )
                .await?
                .try_get(0)?;
            let transaction = client.transaction().await?;
            transaction.query_one("SELECT game_title_id FROM series_analysis_title_states WHERE game_title_id = $1 FOR UPDATE", &[&TITLE_ID]).await?;
            crate::series_analysis::job_transitions::bind_queued_radar(&transaction, &[TITLE_ID])
                .await?;
            let after: String = transaction
                .query_one(
                    "SELECT ctid::text FROM series_analysis_jobs WHERE id = $1",
                    &[&JOB_ID],
                )
                .await?
                .try_get(0)?;
            assert_eq!(
                after, before,
                "an already-bound queue row is not written again"
            );
            transaction.commit().await?;
        }
    }
    drop(config);
    cleanup_database(&client).await?;
    Ok(())
}
