use tokio_postgres::{Client, Transaction};

use crate::{
    execution_slot::{
        ExecutionSlotIdentity, ExecutionTaskKind, SlotRenewal, renew_owned as renew_slot,
    },
    series_analysis::config::AnalysisConsumerConfig,
};

use super::{
    AttemptFailure, AttemptMetrics, AttemptOutcome, ClaimedJob, ControlError, DeliveryReason,
    HeartbeatResult, RequestOutcome, RequeueCause, SafeFailureCode, TransientRetryResult,
    transaction::{
        bounded_transaction, duration_milliseconds, enqueue_delivery, finish_attempt,
        fulfill_requests, lock_owned, refresh_operation_projections, release_slot,
        schedule_follow_up,
    },
};

/// Extends an owned attempt lease and reports whether a future higher-priority holder requested
/// preemption.
///
/// # Errors
///
/// Returns an error when the heartbeat transaction fails or its duration cannot be represented.
pub(crate) async fn heartbeat(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
) -> Result<HeartbeatResult, ControlError> {
    let transaction = bounded_transaction(client, config.heartbeat_interval).await?;
    let lease_milliseconds = duration_milliseconds(config.lease_duration)?;
    let slot_renewal = renew_slot(
        &transaction,
        ExecutionSlotIdentity {
            task_kind: ExecutionTaskKind::Analysis,
            owner: &config.worker_id,
            job_id: &claim.job_id,
            attempt_id: &claim.attempt_id,
            fencing_token: claim.fencing_token,
        },
        lease_milliseconds,
    )
    .await?;
    if slot_renewal == SlotRenewal::OwnerLost {
        transaction.rollback().await?;
        return Ok(HeartbeatResult::OwnerLost);
    }
    let updated = transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               lease_expires_at = clock_timestamp() + ($1::bigint * interval '1 millisecond'),\x20\
               updated_at = clock_timestamp()\x20\
             WHERE id = $2 AND status = 'running' AND lease_owner = $3\x20\
               AND lease_attempt_id = $4 AND lease_fencing_token = $5\x20\
               AND lease_expires_at > clock_timestamp()",
            &[
                &lease_milliseconds,
                &claim.job_id,
                &config.worker_id,
                &claim.attempt_id,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        transaction.rollback().await?;
        return Ok(HeartbeatResult::OwnerLost);
    }
    transaction
        .execute(
            "UPDATE series_analysis_worker_capabilities\x20\
             SET heartbeat_at = clock_timestamp() WHERE worker_id = $1",
            &[&config.worker_id],
        )
        .await?;
    transaction.commit().await?;
    Ok(if slot_renewal == SlotRenewal::PreemptRequested {
        HeartbeatResult::PreemptRequested
    } else {
        HeartbeatResult::Continue
    })
}

/// Terminates a claimed job whose source revision is no longer current.
///
/// # Errors
///
/// Returns an error when ownership was lost or the terminal transition cannot be committed.
pub(crate) async fn supersede(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    metrics: &AttemptMetrics,
) -> Result<(), ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    lock_owned(&transaction, claim, config).await?;
    let desired = transaction
        .query_one(
            "SELECT input_revision, algorithm_version, artifact_schema_version\x20\
             FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&claim.game_title_id],
        )
        .await?;
    let desired_revision = desired.try_get::<_, i64>(0)?;
    let desired_algorithm = desired.try_get::<_, String>(1)?;
    let desired_schema = desired.try_get::<_, i32>(2)?;
    finish_attempt(&transaction, claim, AttemptOutcome::Superseded, metrics).await?;
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               status = 'queued', input_revision = $1, algorithm_version = $2,\x20\
               artifact_schema_version = $3, available_at = clock_timestamp(),\x20\
               started_at = NULL, lease_owner = NULL, lease_attempt_id = NULL,\x20\
               lease_fencing_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE id = $4",
            &[
                &desired_revision,
                &desired_algorithm,
                &desired_schema,
                &claim.job_id,
            ],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_job_requests SET status = 'pending', assigned_attempt_id = NULL\x20\
             WHERE assigned_attempt_id = $1",
            &[&claim.attempt_id],
        )
        .await?;
    enqueue_delivery(
        &transaction,
        &claim.job_id,
        DeliveryReason::Superseded,
        claim.attempt_no,
    )
    .await?;
    release_slot(&transaction, claim, config).await?;
    transaction.commit().await?;
    Ok(())
}

/// Records a bounded failure code, releases ownership, and schedules any still-pending request.
///
/// # Errors
///
/// Returns an error when ownership was lost or the terminal transition cannot be committed.
pub(crate) async fn finish_failure(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    failure: AttemptFailure,
    metrics: &AttemptMetrics,
) -> Result<(), ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    lock_owned(&transaction, claim, config).await?;
    finish_terminal_failure(&transaction, claim, config, failure, metrics).await?;
    transaction.commit().await?;
    Ok(())
}

pub(super) async fn finish_terminal_failure(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    failure: AttemptFailure,
    metrics: &AttemptMetrics,
) -> Result<(), ControlError> {
    let outcome = failure.outcome();
    let outcome_wire = outcome.wire();
    let safe_failure_code = failure.code().wire();
    finish_attempt(transaction, claim, outcome, metrics).await?;
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               status = $1, finished_at = clock_timestamp(), safe_failure_code = $2,\x20\
               elapsed_milliseconds = $3, result_disposition = 'none', output_checksum = NULL,\x20\
               lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\x20\
               lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
            WHERE id = $4",
            &[
                &outcome_wire,
                &safe_failure_code,
                &metrics.elapsed_milliseconds,
                &claim.job_id,
            ],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_title_states SET\x20\
               pending_work = false, last_failure_code = $1,\x20\
               last_failure_at = clock_timestamp(), updated_at = clock_timestamp()\x20\
             WHERE game_title_id = $2",
            &[&safe_failure_code, &claim.game_title_id],
        )
        .await?;
    fulfill_requests(transaction, claim, RequestOutcome::Failed).await?;
    schedule_follow_up(transaction, claim).await?;
    refresh_operation_projections(transaction, &claim.attempt_id).await?;
    release_slot(transaction, claim, config).await?;
    Ok(())
}

/// Requeues a dependency failure up to the durable retry limit, then records a terminal failure.
///
/// # Errors
///
/// Returns an error when ownership was lost or the retry transition cannot be committed.
pub(crate) async fn retry_transient_failure(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    metrics: &AttemptMetrics,
) -> Result<TransientRetryResult, ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    lock_owned(&transaction, claim, config).await?;
    let retry_count = transaction
        .query_one(
            "SELECT transient_retry_count FROM series_analysis_jobs WHERE id = $1 FOR UPDATE",
            &[&claim.job_id],
        )
        .await?
        .try_get::<_, i32>(0)?;
    if retry_count < 3 {
        finish_attempt(&transaction, claim, AttemptOutcome::Failed, metrics).await?;
        let next_retry = retry_count
            .checked_add(1)
            .ok_or(ControlError::NumericBound)?;
        let delay_seconds = i64::from(next_retry)
            .checked_mul(5)
            .ok_or(ControlError::NumericBound)?;
        transaction
            .execute(
                "UPDATE series_analysis_jobs SET status = 'queued', transient_retry_count = $1,\x20\
                   available_at = clock_timestamp() + ($2::bigint * interval '1 second'),\x20\
                   started_at = NULL, finished_at = NULL, safe_failure_code = NULL,\x20\
                   lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\x20\
                   lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = $3",
                &[&next_retry, &delay_seconds, &claim.job_id],
            )
            .await?;
        transaction
            .execute(
                "UPDATE series_analysis_job_requests SET status = 'pending', assigned_attempt_id = NULL\x20\
                 WHERE assigned_attempt_id = $1",
                &[&claim.attempt_id],
            )
            .await?;
        transaction
            .execute(
                "UPDATE series_analysis_campaign_targets t SET status = 'expanded', updated_at = clock_timestamp()\x20\
                 FROM series_analysis_job_requests r WHERE t.job_request_id = r.id\x20\
                   AND r.assigned_job_id = $1",
                &[&claim.job_id],
            )
            .await?;
        enqueue_delivery(
            &transaction,
            &claim.job_id,
            DeliveryReason::TransientRetry,
            next_retry,
        )
        .await?;
        release_slot(&transaction, claim, config).await?;
        transaction.commit().await?;
        return Ok(TransientRetryResult::Requeued);
    }

    finish_terminal_failure(
        &transaction,
        claim,
        config,
        AttemptFailure::failed(SafeFailureCode::DependencyRetryExhausted),
        metrics,
    )
    .await?;
    transaction.commit().await?;
    Ok(TransientRetryResult::Exhausted)
}

/// Returns an interrupted claim to the durable queue without consuming its logical request.
///
/// # Errors
///
/// Returns an error when ownership was lost or the requeue transaction cannot be committed.
pub(crate) async fn requeue_interrupted(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    cause: RequeueCause,
    metrics: &AttemptMetrics,
) -> Result<(), ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    lock_owned(&transaction, claim, config).await?;
    finish_attempt(&transaction, claim, cause.attempt_outcome(), metrics).await?;
    transaction
        .execute(
            "UPDATE series_analysis_jobs SET status = 'queued', available_at = clock_timestamp(),\x20\
               started_at = NULL, finished_at = NULL, safe_failure_code = NULL,\x20\
               lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\x20\
               lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = $1",
            &[&claim.job_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_job_requests SET status = 'pending', assigned_attempt_id = NULL\x20\
             WHERE assigned_attempt_id = $1",
            &[&claim.attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t SET status = 'expanded', updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r WHERE t.job_request_id = r.id\x20\
               AND r.assigned_job_id = $1",
            &[&claim.job_id],
        )
        .await?;
    enqueue_delivery(
        &transaction,
        &claim.job_id,
        cause.delivery_reason(),
        claim.attempt_no,
    )
    .await?;
    release_slot(&transaction, claim, config).await?;
    transaction.commit().await?;
    Ok(())
}
