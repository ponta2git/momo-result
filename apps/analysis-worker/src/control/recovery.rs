use tokio_postgres::{Row, Transaction};

use super::{
    AttemptOutcome, ClaimedJob, ControlError, DeliveryReason, RequestOutcome, SafeFailureCode,
    transaction::{
        enqueue_delivery, fulfill_requests, refresh_operation_projections, schedule_follow_up,
    },
};

pub(super) async fn recover_expired_holder(
    transaction: &Transaction<'_>,
    slot: &Row,
) -> Result<(), ControlError> {
    let job_id = slot
        .try_get::<_, Option<String>>(1)?
        .ok_or(ControlError::OwnerLost)?;
    let attempt_id = slot
        .try_get::<_, Option<String>>(2)?
        .ok_or(ControlError::OwnerLost)?;
    let fencing_token = slot.try_get::<_, i64>(3)?;
    let owner_lost = AttemptOutcome::OwnerLost.wire();
    transaction
        .execute(
            "UPDATE series_analysis_job_attempts SET status = 'terminal', outcome = $1,\x20\
               finished_at = clock_timestamp()\x20\
             WHERE id = $2 AND status = 'running' AND fencing_token = $3",
            &[&owner_lost, &attempt_id, &fencing_token],
        )
        .await?;
    let job = transaction
        .query_opt(
            "SELECT lease_recovery_count, game_title_id, input_revision, algorithm_version,\x20\
                    artifact_schema_version, attempt_count\x20\
             FROM series_analysis_jobs\x20\
             WHERE id = $1 AND status = 'running' FOR UPDATE",
            &[&job_id],
        )
        .await?;
    if let Some(job) = job {
        recover_expired_job(transaction, &job_id, &attempt_id, fencing_token, &job).await?;
    }
    transaction
        .execute(
            "UPDATE worker_execution_slots SET task_kind = NULL, owner = NULL, job_id = NULL,\x20\
               attempt_id = NULL, holder_preemptible = NULL, lease_expires_at = NULL,\x20\
               updated_at = clock_timestamp() WHERE slot_key = 'shared-heavy-work'",
            &[],
        )
        .await?;
    Ok(())
}

struct ExpiredJob {
    next_recovery_count: i32,
    game_title_id: String,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    attempt_no: i32,
}

fn decode_expired_job(row: &Row) -> Result<ExpiredJob, ControlError> {
    Ok(ExpiredJob {
        next_recovery_count: row
            .try_get::<_, i32>(0)?
            .checked_add(1)
            .ok_or(ControlError::NumericBound)?,
        game_title_id: row.try_get(1)?,
        input_revision: row.try_get(2)?,
        algorithm_version: row.try_get(3)?,
        artifact_schema_version: row.try_get(4)?,
        attempt_no: row.try_get(5)?,
    })
}

async fn recover_expired_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
    fencing_token: i64,
    row: &Row,
) -> Result<(), ControlError> {
    let job = decode_expired_job(row)?;
    if job.next_recovery_count <= 3 {
        requeue_expired_job(transaction, job_id, attempt_id, job.next_recovery_count).await
    } else {
        fail_expired_job(transaction, job_id, attempt_id, fencing_token, job).await
    }
}

async fn requeue_expired_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
    recovery_count: i32,
) -> Result<(), ControlError> {
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET status = 'queued', lease_recovery_count = $1,\x20\
               available_at = clock_timestamp(), started_at = NULL, lease_owner = NULL,\x20\
               lease_attempt_id = NULL, lease_fencing_token = NULL, lease_expires_at = NULL,\x20\
               updated_at = clock_timestamp() WHERE id = $2",
            &[&recovery_count, &job_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_job_requests SET status = 'pending', assigned_attempt_id = NULL\x20\
             WHERE assigned_attempt_id = $1",
            &[&attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t SET status = 'expanded', updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r WHERE t.job_request_id = r.id\x20\
               AND r.assigned_job_id = $1",
            &[&job_id],
        )
        .await?;
    enqueue_delivery(
        transaction,
        job_id,
        DeliveryReason::LeaseRecovery,
        recovery_count,
    )
    .await
}

async fn fail_expired_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
    fencing_token: i64,
    job: ExpiredJob,
) -> Result<(), ControlError> {
    let failure_code = SafeFailureCode::LeaseRecoveryExhausted.wire();
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET status = 'failed', finished_at = clock_timestamp(),\x20\
               lease_recovery_count = 3, safe_failure_code = $1,\x20\
               lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\x20\
               lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = $2",
            &[&failure_code, &job_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_title_states SET pending_work = false,\x20\
               last_failure_code = $1, last_failure_at = clock_timestamp(),\x20\
               updated_at = clock_timestamp() WHERE game_title_id = $2",
            &[&failure_code, &job.game_title_id],
        )
        .await?;
    let recovered_claim = ClaimedJob {
        job_id: String::from(job_id),
        game_title_id: job.game_title_id,
        input_revision: job.input_revision,
        algorithm_version: job.algorithm_version,
        artifact_schema_version: job.artifact_schema_version,
        attempt_id: String::from(attempt_id),
        attempt_no: job.attempt_no,
        fencing_token,
    };
    fulfill_requests(transaction, &recovered_claim, RequestOutcome::Failed).await?;
    schedule_follow_up(transaction, &recovered_claim).await?;
    refresh_operation_projections(transaction, attempt_id).await
}
