use tokio_postgres::{Client, Transaction};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};

use crate::{
    execution_slot::{
        ExecutionTaskKind, NewExecutionSlotHolder, SlotAcquisition, acquire_analysis,
        clear_stale_preemption, lock as lock_execution_slot,
    },
    outbox::ControlOutcome,
    series_analysis::config::AnalysisConsumerConfig,
};

use super::{
    ALGORITHM_VERSION, ClaimResult, ClaimedJob, ControlError, TransactionEffects,
    UnsupportedJobVersion,
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
) -> Result<ControlOutcome<ClaimResult>, ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    let lease_milliseconds = duration_milliseconds(config.lease_duration)?;
    let (candidate, effects) = match prepare_claim(&transaction, job_id, lease_milliseconds).await?
    {
        ClaimPreparation::Ready { candidate, effects } => (candidate, effects),
        ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_delivery_resolved,
        } => {
            transaction.commit().await?;
            let result = if current_delivery_resolved {
                ClaimResult::RecoveredCurrentJob
            } else {
                ClaimResult::Busy
            };
            return Ok(effects.committed(result));
        }
        ClaimPreparation::Rejected(result) => {
            transaction.rollback().await?;
            return Ok(ControlOutcome::without_effects(result));
        }
    };
    let expected_schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    if !supports_candidate(&candidate, expected_schema) {
        transaction.rollback().await?;
        return Ok(ControlOutcome::without_effects(
            ClaimResult::UnsupportedVersion(UnsupportedJobVersion {
                algorithm_version: candidate.algorithm_version,
                artifact_schema_version: candidate.artifact_schema_version,
                validation_contract_id: candidate.validation_contract_id,
            }),
        ));
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
    Ok(effects.committed(ClaimResult::Claimed(ClaimedJob {
        job_id: String::from(job_id),
        game_title_id: candidate.game_title_id,
        input_revision: candidate.input_revision,
        algorithm_version: candidate.algorithm_version,
        artifact_schema_version: candidate.artifact_schema_version,
        validation_contract_id: candidate.validation_contract_id,
        attempt_id,
        attempt_no,
        fencing_token,
    })))
}

pub(super) struct ClaimCandidate {
    game_title_id: String,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
    attempt_count: i32,
    slot_fencing_token: i64,
}

pub(super) enum ClaimPreparation {
    Ready {
        candidate: ClaimCandidate,
        effects: TransactionEffects,
    },
    RecoveredExpiredHolder {
        effects: TransactionEffects,
        current_delivery_resolved: bool,
    },
    Rejected(ClaimResult),
}

pub(super) async fn prepare_claim(
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
    let mut effects = TransactionEffects::empty();
    if let Some(holder) = &slot.holder {
        if !holder.expired || holder.task_kind == ExecutionTaskKind::Ocr {
            return Ok(ClaimPreparation::Rejected(ClaimResult::Busy));
        }
        let recovery_effects = recover_expired_analysis_holder(transaction, holder).await?;
        let current_delivery_resolved =
            recovery_resolves_delivery(transaction, &holder.job_id, job_id, recovery_effects)
                .await?;
        effects.merge(recovery_effects);
        return Ok(ClaimPreparation::RecoveredExpiredHolder {
            current_delivery_resolved,
            effects,
        });
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
            "SELECT input_revision, algorithm_version, artifact_schema_version,\x20\
                    validation_contract_id, status,\x20\
                    GREATEST(\x20\
                      CEIL(EXTRACT(EPOCH FROM (available_at - clock_timestamp())) * 1000), 0\x20\
                    )::bigint AS remaining_delay_milliseconds, attempt_count\x20\
             FROM series_analysis_jobs WHERE id = $1 FOR UPDATE",
            &[&job_id],
        )
        .await?;
    let Some(job) = job else {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    };
    if job.try_get::<_, String>(4)? != "queued" {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    }
    let remaining_delay_milliseconds = job.try_get::<_, i64>(5)?;
    if remaining_delay_milliseconds > 0 {
        return Ok(ClaimPreparation::Rejected(ClaimResult::NotYetAvailable {
            remaining_delay: std::time::Duration::from_millis(u64::try_from(
                remaining_delay_milliseconds,
            )?),
        }));
    }
    Ok(ClaimPreparation::Ready {
        candidate: ClaimCandidate {
            game_title_id,
            input_revision: job.try_get(0)?,
            algorithm_version: job.try_get(1)?,
            artifact_schema_version: job.try_get(2)?,
            validation_contract_id: job.try_get(3)?,
            attempt_count: job.try_get(6)?,
            slot_fencing_token: slot.fencing_token,
        },
        effects,
    })
}

fn supports_candidate(candidate: &ClaimCandidate, expected_schema: i32) -> bool {
    candidate.algorithm_version == ALGORITHM_VERSION
        && candidate.artifact_schema_version == expected_schema
        && candidate
            .validation_contract_id
            .as_deref()
            .is_none_or(|contract| contract == ARTIFACT_VALIDATION_CONTRACT_ID)
}

async fn recovery_resolves_delivery(
    transaction: &Transaction<'_>,
    holder_job_id: &str,
    delivery_job_id: &str,
    recovery_effects: TransactionEffects,
) -> Result<bool, ControlError> {
    if holder_job_id != delivery_job_id {
        return Ok(false);
    }
    let status = transaction
        .query_opt(
            "SELECT status FROM series_analysis_jobs WHERE id = $1",
            &[&delivery_job_id],
        )
        .await?
        .map(|row| row.try_get::<_, String>(0))
        .transpose()?;
    Ok(recovered_job_state_resolves_delivery(
        status.as_deref(),
        recovery_effects,
    ))
}

fn recovered_job_state_resolves_delivery(
    status: Option<&str>,
    recovery_effects: TransactionEffects,
) -> bool {
    match status {
        None | Some("succeeded" | "failed") => true,
        Some("queued") => recovery_effects != TransactionEffects::empty(),
        Some(_) => false,
    }
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
               lease_validation_contract_id = $5, attempt_count = $6,\x20\
               updated_at = clock_timestamp()\x20\
             WHERE id = $7 AND status = 'queued'",
            &[
                &config.worker_id,
                &attempt.attempt_id,
                &attempt.fencing_token,
                &attempt.lease_milliseconds,
                &attempt.candidate.validation_contract_id,
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
               algorithm_version, artifact_schema_version, validation_contract_id, status,\x20\
               effective_config_version, calculation_timeout_milliseconds, started_at\x20\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running', $10, $11, clock_timestamp())",
            &[
                &attempt.attempt_id,
                &attempt.job_id,
                &attempt.attempt_no,
                &config.worker_id,
                &attempt.fencing_token,
                &attempt.candidate.input_revision,
                &attempt.candidate.algorithm_version,
                &attempt.candidate.artifact_schema_version,
                &attempt.candidate.validation_contract_id,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(validation_contract_id: Option<&str>) -> ClaimCandidate {
        ClaimCandidate {
            game_title_id: String::from("title-1"),
            input_revision: 1,
            algorithm_version: String::from(ALGORITHM_VERSION),
            artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or(i32::MAX),
            validation_contract_id: validation_contract_id.map(String::from),
            attempt_count: 0,
            slot_fencing_token: 0,
        }
    }

    #[test]
    fn claim_accepts_legacy_null_or_the_exact_validation_contract_only() {
        let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or(i32::MAX);

        assert!(supports_candidate(&candidate(None), schema));
        assert!(supports_candidate(
            &candidate(Some(ARTIFACT_VALIDATION_CONTRACT_ID)),
            schema
        ));
        assert!(!supports_candidate(
            &candidate(Some("unknown-validation-contract")),
            schema
        ));
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::too_many_lines,
        reason = "the isolated database test keeps the rollback claim fence explicit"
    )]
    async fn real_postgres_keeps_exact_jobs_queued_when_an_old_binary_omits_the_lease_contract()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const TITLE_ID: &str = "analysis-validation-lease-fence-title";
        const JOB_ID: &str = "analysis-validation-lease-fence-job";
        let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
        let mut client = crate::postgres::connect(&database_url).await?;
        let transaction = client.transaction().await?;
        transaction
            .execute(
                "INSERT INTO game_titles (id, name, layout_family, display_order)\x20\
                 VALUES ($1, 'validation lease fence', 'momotetsu2', 9998)",
                &[&TITLE_ID],
            )
            .await?;
        transaction
            .execute(
                "UPDATE series_analysis_title_states SET algorithm_version = $2,\x20\
                   artifact_schema_version = $3, validation_contract_id = $4\x20\
                 WHERE game_title_id = $1",
                &[
                    &TITLE_ID,
                    &ALGORITHM_VERSION,
                    &schema,
                    &ARTIFACT_VALIDATION_CONTRACT_ID,
                ],
            )
            .await?;
        transaction
            .execute(
                "INSERT INTO series_analysis_jobs (id, game_title_id, input_revision,\x20\
                   algorithm_version, artifact_schema_version, validation_contract_id,\x20\
                   status, trigger, requested_at, available_at)\x20\
                 VALUES ($1, $2, 0, $3, $4, $5, 'queued', 'manual',\x20\
                   clock_timestamp(), clock_timestamp())",
                &[
                    &JOB_ID,
                    &TITLE_ID,
                    &ALGORITHM_VERSION,
                    &schema,
                    &ARTIFACT_VALIDATION_CONTRACT_ID,
                ],
            )
            .await?;

        transaction
            .batch_execute("SAVEPOINT old_binary_claim")
            .await?;
        let old_claim = transaction
            .execute(
                "UPDATE series_analysis_jobs SET status = 'running',\x20\
                   started_at = clock_timestamp(), lease_owner = 'legacy-worker',\x20\
                   lease_attempt_id = 'legacy-attempt', lease_fencing_token = 1,\x20\
                   lease_expires_at = clock_timestamp() + interval '1 minute', attempt_count = 1\x20\
                 WHERE id = $1 AND status = 'queued'",
                &[&JOB_ID],
            )
            .await;
        let Err(old_claim_error) = old_claim else {
            return Err("an old binary claimed an exact-contract job".into());
        };
        assert_eq!(
            old_claim_error
                .as_db_error()
                .and_then(tokio_postgres::error::DbError::constraint),
            Some("series_analysis_jobs_lease_validation_contract_check")
        );
        transaction
            .batch_execute("ROLLBACK TO SAVEPOINT old_binary_claim")
            .await?;

        transaction.batch_execute("SAVEPOINT legacy_claim").await?;
        transaction
            .execute(
                "UPDATE series_analysis_jobs SET validation_contract_id = NULL WHERE id = $1",
                &[&JOB_ID],
            )
            .await?;
        let legacy_claimed = transaction
            .execute(
                "UPDATE series_analysis_jobs SET status = 'running',\x20\
                   started_at = clock_timestamp(), lease_owner = 'legacy-worker',\x20\
                   lease_attempt_id = 'legacy-attempt', lease_fencing_token = 1,\x20\
                   lease_expires_at = clock_timestamp() + interval '1 minute', attempt_count = 1\x20\
                 WHERE id = $1 AND status = 'queued'",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(legacy_claimed, 1);
        transaction
            .batch_execute("ROLLBACK TO SAVEPOINT legacy_claim")
            .await?;

        let claimed = transaction
            .execute(
                "UPDATE series_analysis_jobs SET status = 'running',\x20\
                   started_at = clock_timestamp(), lease_owner = 'current-worker',\x20\
                   lease_attempt_id = 'current-attempt', lease_fencing_token = 2,\x20\
                   lease_expires_at = clock_timestamp() - interval '1 minute',\x20\
                   lease_validation_contract_id = $2, attempt_count = 1\x20\
                 WHERE id = $1 AND status = 'queued'",
                &[&JOB_ID, &ARTIFACT_VALIDATION_CONTRACT_ID],
            )
            .await?;
        assert_eq!(claimed, 1);

        // A rollback binary does not know the additive lease marker. The database must clear it
        // before validating a running -> queued recovery, then still reject the rollback binary's
        // subsequent queued -> running claim. Otherwise an exact-contract job is either stranded
        // running forever or consumed by a worker that cannot honor its contract.
        let recovered_by_old_binary = transaction
            .execute(
                "UPDATE series_analysis_jobs SET status = 'queued', started_at = NULL,\x20\
                   lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\x20\
                   lease_expires_at = NULL, available_at = clock_timestamp()\x20\
                 WHERE id = $1 AND status = 'running'\x20\
                   AND lease_expires_at < clock_timestamp()",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(recovered_by_old_binary, 1);
        let recovered = transaction
            .query_one(
                "SELECT status, lease_validation_contract_id\x20\
                 FROM series_analysis_jobs WHERE id = $1",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(recovered.try_get::<_, String>(0)?, "queued");
        assert_eq!(recovered.try_get::<_, Option<String>>(1)?, None);

        transaction
            .batch_execute("SAVEPOINT old_binary_reclaim")
            .await?;
        let old_reclaim = transaction
            .execute(
                "UPDATE series_analysis_jobs SET status = 'running',\x20\
                   started_at = clock_timestamp(), lease_owner = 'legacy-worker',\x20\
                   lease_attempt_id = 'legacy-retry-attempt', lease_fencing_token = 3,\x20\
                   lease_expires_at = clock_timestamp() + interval '1 minute', attempt_count = 2\x20\
                 WHERE id = $1 AND status = 'queued'",
                &[&JOB_ID],
            )
            .await;
        let Err(old_reclaim_error) = old_reclaim else {
            return Err("an old binary reclaimed a recovered exact-contract job".into());
        };
        assert_eq!(
            old_reclaim_error
                .as_db_error()
                .and_then(tokio_postgres::error::DbError::constraint),
            Some("series_analysis_jobs_lease_validation_contract_check")
        );
        transaction
            .batch_execute("ROLLBACK TO SAVEPOINT old_binary_reclaim")
            .await?;
        assert_eq!(
            transaction
                .query_one(
                    "SELECT status FROM series_analysis_jobs WHERE id = $1",
                    &[&JOB_ID],
                )
                .await?
                .try_get::<_, String>(0)?,
            "queued"
        );
        transaction.rollback().await?;
        Ok(())
    }

    #[test]
    fn recovered_current_delivery_requires_terminal_state_or_durable_replacement() {
        let no_effects = TransactionEffects::empty();
        let mut replacement = TransactionEffects::empty();
        replacement.record_series_analysis();

        assert!(recovered_job_state_resolves_delivery(None, no_effects));
        assert!(recovered_job_state_resolves_delivery(
            Some("failed"),
            no_effects
        ));
        assert!(recovered_job_state_resolves_delivery(
            Some("succeeded"),
            no_effects
        ));
        assert!(recovered_job_state_resolves_delivery(
            Some("queued"),
            replacement
        ));
        assert!(!recovered_job_state_resolves_delivery(
            Some("queued"),
            no_effects
        ));
        assert!(!recovered_job_state_resolves_delivery(
            Some("running"),
            replacement
        ));
    }
}
