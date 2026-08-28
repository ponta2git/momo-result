use tokio_postgres::{Row, Transaction};

use crate::execution_slot::{
    ExecutionSlotHolder, ExecutionTaskKind, clear_expired as clear_expired_slot,
};

use super::{
    AttemptOutcome, ClaimedJob, ControlError, DeliveryReason, RequestOutcome, SafeFailureCode,
    TransactionEffects,
    transaction::{
        enqueue_delivery, fulfill_requests, refresh_operation_projections, schedule_follow_up,
    },
};

pub(crate) async fn recover_expired_analysis_holder(
    transaction: &Transaction<'_>,
    holder: &ExecutionSlotHolder,
) -> Result<TransactionEffects, ControlError> {
    if holder.task_kind != ExecutionTaskKind::Analysis || !holder.expired {
        return Err(ControlError::OwnerLost);
    }
    let job_id = &holder.job_id;
    let attempt_id = &holder.attempt_id;
    let fencing_token = holder.fencing_token;
    let job_preview = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_jobs WHERE id = $1",
            &[&job_id],
        )
        .await?;
    let Some(job_preview) = job_preview else {
        if !clear_expired_slot(transaction, holder).await? {
            return Err(ControlError::OwnerLost);
        }
        return Ok(TransactionEffects::empty());
    };
    let game_title_id = job_preview.try_get::<_, String>(0)?;
    let title_exists = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE",
            &[&game_title_id],
        )
        .await?
        .is_some();
    let job_row = transaction
        .query_opt(
            "SELECT COALESCE(lease_owner = $2 AND lease_attempt_id = $3\x20\
                        AND lease_fencing_token = $4\x20\
                        AND lease_expires_at <= clock_timestamp(), false),\x20\
                    lease_recovery_count, game_title_id, input_revision, algorithm_version,\x20\
                    artifact_schema_version, attempt_count\x20\
             FROM series_analysis_jobs\x20\
             WHERE id = $1 AND game_title_id = $5 AND status = 'running' FOR UPDATE",
            &[
                &job_id,
                &holder.owner,
                &attempt_id,
                &fencing_token,
                &game_title_id,
            ],
        )
        .await?;
    let mut effects = TransactionEffects::empty();
    if let Some(job_row) = job_row {
        if !title_exists {
            return Err(ControlError::OwnerLost);
        }
        let recoverable = job_row.try_get::<_, bool>(0)?;
        if !recoverable {
            return Err(ControlError::OwnerLost);
        }
        let job = decode_expired_job(&job_row)?;
        let owner_lost = AttemptOutcome::OwnerLost.wire();
        let attempt_updated = transaction
            .execute(
                "UPDATE series_analysis_job_attempts SET status = 'terminal', outcome = $1,\x20\
                   finished_at = clock_timestamp()\x20\
                 WHERE id = $2 AND job_id = $3 AND owner = $4 AND status = 'running'\x20\
                   AND fencing_token = $5",
                &[
                    &owner_lost,
                    &attempt_id,
                    &job_id,
                    &holder.owner,
                    &fencing_token,
                ],
            )
            .await?;
        if attempt_updated != 1 {
            return Err(ControlError::OwnerLost);
        }
        recover_expired_job(
            transaction,
            job_id,
            attempt_id,
            fencing_token,
            job,
            &mut effects,
        )
        .await?;
    }
    if !clear_expired_slot(transaction, holder).await? {
        return Err(ControlError::OwnerLost);
    }
    Ok(effects)
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
            .try_get::<_, i32>(1)?
            .checked_add(1)
            .ok_or(ControlError::NumericBound)?,
        game_title_id: row.try_get(2)?,
        input_revision: row.try_get(3)?,
        algorithm_version: row.try_get(4)?,
        artifact_schema_version: row.try_get(5)?,
        attempt_no: row.try_get(6)?,
    })
}

async fn recover_expired_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
    fencing_token: i64,
    job: ExpiredJob,
    effects: &mut TransactionEffects,
) -> Result<(), ControlError> {
    if job.next_recovery_count <= 3 {
        requeue_expired_job(
            transaction,
            job_id,
            attempt_id,
            job.next_recovery_count,
            effects,
        )
        .await
    } else {
        fail_expired_job(transaction, job_id, attempt_id, fencing_token, job, effects).await
    }
}

async fn requeue_expired_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
    recovery_count: i32,
    effects: &mut TransactionEffects,
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
        effects,
    )
    .await
}

async fn fail_expired_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
    fencing_token: i64,
    job: ExpiredJob,
    effects: &mut TransactionEffects,
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
    schedule_follow_up(transaction, &recovered_claim, effects).await?;
    refresh_operation_projections(transaction, attempt_id).await?;
    Ok(())
}
