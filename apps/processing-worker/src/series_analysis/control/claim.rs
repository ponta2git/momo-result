use tokio_postgres::{Client, Transaction};

use momo_analysis_core::contract::ARTIFACT_SCHEMA_VERSION;

use crate::{
    execution_slot::{
        ExecutionTaskKind, NewExecutionSlotHolder, SlotAcquisition, acquire_analysis,
        clear_stale_preemption, lock as lock_execution_slot,
    },
    series_analysis::config::AnalysisConsumerConfig,
};

use super::{
    ALGORITHM_VERSION, ClaimResult, ClaimedJob, ControlError, UnsupportedJobVersion,
    recovery::recover_expired_analysis_holder,
    transaction::{bounded_transaction, duration_milliseconds, stable_id},
};

/// Claims one compatible job while atomically acquiring the shared heavy-work slot.
///
/// # Errors
///
/// Returns an error when the control-plane transaction fails or persisted values exceed the
/// worker's numeric bounds.
pub(crate) async fn claim_job(
    client: &mut Client,
    job_id: &str,
    config: &AnalysisConsumerConfig,
) -> Result<ClaimResult, ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    let lease_milliseconds = duration_milliseconds(config.lease_duration)?;
    let candidate = match prepare_claim(&transaction, job_id, lease_milliseconds).await? {
        ClaimPreparation::Ready(candidate) => candidate,
        ClaimPreparation::Rejected(result) => {
            transaction.rollback().await?;
            return Ok(result);
        }
    };
    let expected_schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    if candidate.algorithm_version != ALGORITHM_VERSION
        || candidate.artifact_schema_version != expected_schema
    {
        transaction.rollback().await?;
        return Ok(ClaimResult::UnsupportedVersion(UnsupportedJobVersion {
            algorithm_version: candidate.algorithm_version,
            artifact_schema_version: candidate.artifact_schema_version,
        }));
    }
    let attempt_no = candidate
        .attempt_count
        .checked_add(1)
        .ok_or(ControlError::NumericBound)?;
    let attempt_id = stable_id("analysis-attempt", &[job_id, &attempt_no.to_string()]);
    let timeout_milliseconds = duration_milliseconds(config.execution_limits.calculation_timeout)?;
    let fencing_token = acquire_execution_slot(
        &transaction,
        config,
        job_id,
        &attempt_id,
        lease_milliseconds,
        candidate.slot_fencing_token,
    )
    .await?;
    let attempt = ClaimAttempt {
        job_id,
        candidate: &candidate,
        attempt_id: &attempt_id,
        attempt_no,
        fencing_token,
        lease_milliseconds,
        timeout_milliseconds,
    };
    persist_claim(&transaction, config, &attempt).await?;
    transaction.commit().await?;
    Ok(ClaimResult::Claimed(ClaimedJob {
        job_id: String::from(job_id),
        game_title_id: candidate.game_title_id,
        input_revision: candidate.input_revision,
        algorithm_version: candidate.algorithm_version,
        artifact_schema_version: candidate.artifact_schema_version,
        attempt_id,
        attempt_no,
        fencing_token,
    }))
}

struct ClaimCandidate {
    game_title_id: String,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    attempt_count: i32,
    slot_fencing_token: i64,
}

enum ClaimPreparation {
    Ready(ClaimCandidate),
    Rejected(ClaimResult),
}

async fn prepare_claim(
    transaction: &Transaction<'_>,
    job_id: &str,
    stale_preemption_milliseconds: i64,
) -> Result<ClaimPreparation, ControlError> {
    let preview = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_jobs WHERE id = $1",
            &[&job_id],
        )
        .await?;
    let Some(preview) = preview else {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    };
    let game_title_id = preview.try_get::<_, String>(0)?;
    let slot = lock_execution_slot(transaction).await?;
    if let Some(holder) = &slot.holder {
        if !holder.expired || holder.task_kind == ExecutionTaskKind::Ocr {
            return Ok(ClaimPreparation::Rejected(ClaimResult::Busy));
        }
        recover_expired_analysis_holder(transaction, holder).await?;
    }
    if slot.preempt_requested_by.is_some()
        && !clear_stale_preemption(transaction, stale_preemption_milliseconds).await?
    {
        return Ok(ClaimPreparation::Rejected(ClaimResult::Busy));
    }
    let title_exists = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE",
            &[&game_title_id],
        )
        .await?
        .is_some();
    if !title_exists {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    }
    let job = transaction
        .query_opt(
            "SELECT input_revision, algorithm_version, artifact_schema_version, status,\x20\
                    available_at <= clock_timestamp(), attempt_count\x20\
             FROM series_analysis_jobs WHERE id = $1 FOR UPDATE",
            &[&job_id],
        )
        .await?;
    let Some(job) = job else {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    };
    if job.try_get::<_, String>(3)? != "queued" {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    }
    if !job.try_get::<_, bool>(4)? {
        return Ok(ClaimPreparation::Rejected(ClaimResult::NotYetAvailable));
    }
    Ok(ClaimPreparation::Ready(ClaimCandidate {
        game_title_id,
        input_revision: job.try_get(0)?,
        algorithm_version: job.try_get(1)?,
        artifact_schema_version: job.try_get(2)?,
        attempt_count: job.try_get(5)?,
        slot_fencing_token: slot.fencing_token,
    }))
}

async fn acquire_execution_slot(
    transaction: &Transaction<'_>,
    config: &AnalysisConsumerConfig,
    job_id: &str,
    attempt_id: &str,
    lease_milliseconds: i64,
    expected_fencing_token: i64,
) -> Result<i64, ControlError> {
    match acquire_analysis(
        transaction,
        expected_fencing_token,
        NewExecutionSlotHolder {
            owner: &config.worker_id,
            job_id,
            attempt_id,
        },
        lease_milliseconds,
    )
    .await?
    {
        SlotAcquisition::Acquired(fencing_token) => Ok(fencing_token),
        SlotAcquisition::Busy => Err(ControlError::OwnerLost),
    }
}

struct ClaimAttempt<'a> {
    job_id: &'a str,
    candidate: &'a ClaimCandidate,
    attempt_id: &'a str,
    attempt_no: i32,
    fencing_token: i64,
    lease_milliseconds: i64,
    timeout_milliseconds: i64,
}

async fn persist_claim(
    transaction: &Transaction<'_>,
    config: &AnalysisConsumerConfig,
    attempt: &ClaimAttempt<'_>,
) -> Result<(), ControlError> {
    let updated = transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               status = 'running', started_at = clock_timestamp(), finished_at = NULL,\x20\
               lease_owner = $1, lease_attempt_id = $2, lease_fencing_token = $3,\x20\
               lease_expires_at = clock_timestamp() + ($4::bigint * interval '1 millisecond'),\x20\
               attempt_count = $5, updated_at = clock_timestamp()\x20\
             WHERE id = $6 AND status = 'queued'",
            &[
                &config.worker_id,
                &attempt.attempt_id,
                &attempt.fencing_token,
                &attempt.lease_milliseconds,
                &attempt.attempt_no,
                &attempt.job_id,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(ControlError::OwnerLost);
    }
    transaction
        .execute(
            "INSERT INTO series_analysis_job_attempts (\x20\
               id, job_id, attempt_no, owner, fencing_token, input_revision,\x20\
               algorithm_version, artifact_schema_version, status,\x20\
               effective_config_version, calculation_timeout_milliseconds, started_at\x20\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', $9, $10, clock_timestamp())",
            &[
                &attempt.attempt_id,
                &attempt.job_id,
                &attempt.attempt_no,
                &config.worker_id,
                &attempt.fencing_token,
                &attempt.candidate.input_revision,
                &attempt.candidate.algorithm_version,
                &attempt.candidate.artifact_schema_version,
                &config.effective_config_version,
                &attempt.timeout_milliseconds,
            ],
        )
        .await?;
    mark_associated_requests_running(transaction, attempt.job_id, attempt.attempt_id).await
}

async fn mark_associated_requests_running(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt_id: &str,
) -> Result<(), ControlError> {
    transaction
        .execute(
            "UPDATE series_analysis_job_requests SET\x20\
               status = 'assigned', assigned_attempt_id = $1\x20\
             WHERE status = 'pending' AND assigned_job_id = $2\x20\
               AND accepted_at <= (SELECT started_at FROM series_analysis_job_attempts WHERE id = $1)",
            &[&attempt_id, &job_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_operation_requests o SET status = 'running'\x20\
             WHERE status = 'pending' AND EXISTS (\x20\
               SELECT 1 FROM series_analysis_job_requests r\x20\
               WHERE r.operation_request_id = o.id AND r.assigned_attempt_id = $1\x20\
             )",
            &[&attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t SET status = 'running', updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r\x20\
             WHERE t.job_request_id = r.id AND r.assigned_attempt_id = $1",
            &[&attempt_id],
        )
        .await?;
    Ok(())
}
