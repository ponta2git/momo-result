use crate::series_analysis::metrics::PhaseTimer;

use tokio_postgres::{Client, Transaction};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};

use crate::{
    job_lease::ExpiredJobLease, series_analysis::config::AnalysisConsumerConfig,
    worker::ControlOutcome,
};

use super::{
    ALGORITHM_VERSION, ClaimResult, ClaimedJob, ControlError, TransactionEffects,
    UnsupportedJobVersion,
    recovery::recover_expired_analysis_job,
    transaction::{bounded_transaction, duration_milliseconds, stable_id},
};

/// Claims one compatible job and advances its persistent fencing counter atomically.
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
    Box::pin(claim_job_with_diagnostics(
        client, job_id, config, true, None,
    ))
    .await
}

pub(crate) async fn claim_scoped_job(
    client: &mut Client,
    job_id: &str,
    config: &AnalysisConsumerConfig,
    scope: &crate::maintenance::analysis::BoundScope,
) -> Result<ControlOutcome<ClaimResult>, ControlError> {
    Box::pin(claim_job_with_diagnostics(
        client,
        job_id,
        config,
        true,
        Some(scope),
    ))
    .await
}

async fn claim_job_with_diagnostics(
    client: &mut Client,
    job_id: &str,
    config: &AnalysisConsumerConfig,
    diagnostics: bool,
    scope: Option<&crate::maintenance::analysis::BoundScope>,
) -> Result<ControlOutcome<ClaimResult>, ControlError> {
    let transaction =
        bounded_transaction(client, config.execution_limits.finalization_timeout).await?;
    transaction
        .batch_execute("SET LOCAL lock_timeout='100ms'")
        .await?;
    if let Some(scope) = scope {
        Box::pin(validate_scoped_claim(&transaction, scope, job_id)).await?;
    }
    let lease_milliseconds = duration_milliseconds(config.lease_duration)?;
    let (candidate, effects) = match measure_claim(
        diagnostics,
        "claim_lock_and_recovery",
        prepare_claim(&transaction, job_id),
    )
    .await?
    {
        ClaimPreparation::Ready { candidate, effects } => (candidate, effects),
        ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_candidate_resolved,
        } => {
            measure_claim(diagnostics, "claim_commit", transaction.commit()).await?;
            let result = if current_candidate_resolved {
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
    let fencing_token = candidate
        .fencing_counter
        .checked_add(1)
        .ok_or(ControlError::NumericBound)?;
    let attempt = ClaimAttempt {
        job_id,
        candidate: &candidate,
        attempt_id: &attempt_id,
        attempt_no,
        fencing_token,
        lease_milliseconds,
        timeout_milliseconds,
    };
    persist_claim(
        &transaction,
        &config.worker_id,
        &config.effective_config_version,
        &attempt,
    )
    .await?;
    measure_claim(diagnostics, "claim_commit", transaction.commit()).await?;
    Ok(effects.committed(ClaimResult::Claimed(ClaimedJob {
        work_kind: candidate.work_kind,
        radar_operation_id: candidate.radar_operation_id,
        radar_basis_id: candidate.radar_basis_id,
        radar_generation: candidate.radar_generation,
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

async fn validate_scoped_claim(
    transaction: &Transaction<'_>,
    scope: &crate::maintenance::analysis::BoundScope,
    job_id: &str,
) -> Result<(), ControlError> {
    crate::maintenance::analysis::scope::validate(transaction, scope).await?;
    let belongs = transaction.query_opt(
        "SELECT 1 FROM series_analysis_campaign_targets t JOIN series_analysis_job_requests r ON r.id=t.job_request_id \
         WHERE t.campaign_id=(SELECT id FROM series_analysis_campaigns WHERE legacy_id=$1) AND r.operation_request_id=(SELECT id FROM series_analysis_operation_requests WHERE legacy_id=$2) AND r.assigned_job_id=(SELECT id FROM series_analysis_jobs WHERE legacy_id=$3) AND t.status='expanded' AND r.status='pending'",
        &[&scope.request.campaign_id, &scope.request.operation_id, &job_id],
    ).await?.is_some();
    if !belongs {
        return Err(crate::maintenance::analysis::ScopeError::Scope.into());
    }
    Ok(())
}

async fn measure_claim<T, E>(
    diagnostics: bool,
    phase: &'static str,
    operation: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let timer = diagnostics.then(|| PhaseTimer::start(phase));
    let result = operation.await?;
    if let Some(timer) = timer {
        timer.complete();
    }
    Ok(result)
}

pub(super) struct ClaimCandidate {
    work_kind: String,
    radar_operation_id: Option<String>,
    radar_basis_id: Option<String>,
    radar_generation: i64,
    game_title_id: String,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
    attempt_count: i32,
    fencing_counter: i64,
}

pub(super) enum ClaimPreparation {
    Ready {
        candidate: ClaimCandidate,
        effects: TransactionEffects,
    },
    RecoveredExpiredHolder {
        effects: TransactionEffects,
        current_candidate_resolved: bool,
    },
    Rejected(ClaimResult),
}

pub(super) async fn prepare_claim(
    transaction: &Transaction<'_>,
    job_id: &str,
) -> Result<ClaimPreparation, ControlError> {
    let preview = transaction
        .query_opt(
            "SELECT title.legacy_id FROM series_analysis_jobs job JOIN game_titles title ON title.id=job.game_title_id WHERE job.legacy_id = $1",
            &[&job_id],
        )
        .await?;
    let Some(preview) = preview else {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    };
    let game_title_id = preview.try_get::<_, String>(0)?;
    let title_exists = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = (SELECT id FROM game_titles WHERE legacy_id=$1) FOR UPDATE",
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
                    )::bigint AS remaining_delay_milliseconds, attempt_count, work_kind,\x20\
                    legacy_radar_operation_id, (SELECT legacy_id FROM series_radar_basis_identities WHERE id=job.radar_basis_id), radar_generation, fencing_counter,\x20\
                    lease_owner, legacy_lease_attempt_id, lease_fencing_token,\x20\
                    lease_expires_at <= clock_timestamp() AS expired\x20\
             FROM series_analysis_jobs job WHERE legacy_id = $1 FOR UPDATE",
            &[&job_id],
        )
        .await?;
    let Some(job) = job else {
        return Ok(ClaimPreparation::Rejected(ClaimResult::MissingOrTerminal));
    };
    if job.try_get::<_, String>(4)? == "running" {
        if !job.try_get::<_, Option<bool>>(15)?.unwrap_or(false) {
            return Ok(ClaimPreparation::Rejected(ClaimResult::Busy));
        }
        let lease = ExpiredJobLease {
            job_id: String::from(job_id),
            owner: job.try_get(12)?,
            attempt_id: job.try_get(13)?,
            fencing_token: job.try_get(14)?,
        };
        let effects = recover_expired_analysis_job(transaction, &lease).await?;
        let current_candidate_resolved =
            recovery_resolves_candidate(transaction, job_id, job_id, effects).await?;
        return Ok(ClaimPreparation::RecoveredExpiredHolder {
            effects,
            current_candidate_resolved,
        });
    }
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
            work_kind: job.try_get(7)?,
            radar_operation_id: job.try_get(8)?,
            radar_basis_id: job.try_get(9)?,
            radar_generation: job.try_get(10)?,
            game_title_id,
            input_revision: job.try_get(0)?,
            algorithm_version: job.try_get(1)?,
            artifact_schema_version: job.try_get(2)?,
            validation_contract_id: job.try_get(3)?,
            attempt_count: job.try_get(6)?,
            fencing_counter: job.try_get(11)?,
        },
        effects: TransactionEffects::empty(),
    })
}

fn supports_candidate(candidate: &ClaimCandidate, expected_schema: i32) -> bool {
    candidate.algorithm_version == ALGORITHM_VERSION
        && candidate.artifact_schema_version == expected_schema
        && candidate
            .validation_contract_id
            .as_deref()
            .is_some_and(|contract| contract == ARTIFACT_VALIDATION_CONTRACT_ID)
}

async fn recovery_resolves_candidate(
    transaction: &Transaction<'_>,
    holder_job_id: &str,
    candidate_job_id: &str,
    recovery_effects: TransactionEffects,
) -> Result<bool, ControlError> {
    if holder_job_id != candidate_job_id {
        return Ok(false);
    }
    let status = transaction
        .query_opt(
            "SELECT status FROM series_analysis_jobs WHERE legacy_id = $1",
            &[&candidate_job_id],
        )
        .await?
        .map(|row| row.try_get::<_, String>(0))
        .transpose()?;
    Ok(recovered_job_state_resolves_candidate(
        status.as_deref(),
        recovery_effects,
    ))
}

fn recovered_job_state_resolves_candidate(
    status: Option<&str>,
    recovery_effects: TransactionEffects,
) -> bool {
    match status {
        None | Some("succeeded" | "failed") => true,
        Some("queued") => recovery_effects != TransactionEffects::empty(),
        Some(_) => false,
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
    worker_id: &str,
    effective_config_version: &str,
    attempt: &ClaimAttempt<'_>,
) -> Result<(), ControlError> {
    let attempt_identity = crate::identity::allocate(
        crate::identity::Entity::AnalysisAttempts,
        attempt.attempt_id,
    )
    .map_err(|_error| ControlError::InvalidMetadata)?;
    let updated = transaction
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               status = 'running', started_at = clock_timestamp(), finished_at = NULL,\x20\
               lease_owner = $1, lease_attempt_id = $2, legacy_lease_attempt_id = $8, lease_fencing_token = $3, fencing_counter = $3,\x20\
               lease_expires_at = clock_timestamp() + ($4::bigint * interval '1 millisecond'),\x20\
               lease_validation_contract_id = $5, attempt_count = $6,\x20\
               updated_at = clock_timestamp()\x20\
             WHERE legacy_id = $7 AND status = 'queued'",
            &[
                &worker_id,
                &attempt_identity,
                &attempt.fencing_token,
                &attempt.lease_milliseconds,
                &attempt.candidate.validation_contract_id,
                &attempt.attempt_no,
                &attempt.job_id,
                &attempt.attempt_id,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(ControlError::OwnerLost);
    }
    transaction
        .execute(
            "INSERT INTO series_analysis_job_attempts (\x20\
               id, legacy_id, job_id, attempt_no, owner, fencing_token, input_revision,\x20\
               algorithm_version, artifact_schema_version, validation_contract_id, status,\x20\
               effective_config_version, calculation_timeout_milliseconds, started_at\x20\
             ) VALUES ($1, $12, (SELECT id FROM series_analysis_jobs WHERE legacy_id=$2), $3, $4, $5, $6, $7, $8, $9, 'running', $10, $11, clock_timestamp())",
            &[
                &attempt_identity,
                &attempt.job_id,
                &attempt.attempt_no,
                &worker_id,
                &attempt.fencing_token,
                &attempt.candidate.input_revision,
                &attempt.candidate.algorithm_version,
                &attempt.candidate.artifact_schema_version,
                &attempt.candidate.validation_contract_id,
                &effective_config_version,
                &attempt.timeout_milliseconds,
                &attempt.attempt_id,
            ],
        )
        .await?;
    transaction.execute("UPDATE series_radar_operations SET status = 'running', updated_at = clock_timestamp() WHERE job_id = (SELECT id FROM series_analysis_jobs WHERE legacy_id=$1) AND status = 'pending'", &[&attempt.job_id]).await?;
    if attempt.candidate.work_kind == "radar_prepare" {
        return Ok(());
    }
    transaction.execute("UPDATE series_radar_operations o SET job_id=(SELECT id FROM series_analysis_jobs WHERE legacy_id=$1),legacy_job_id=$1,status='running',updated_at=clock_timestamp() FROM series_radar_title_states s WHERE s.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$2) AND s.active_operation_id=o.id AND s.generation=$3 AND o.kind='apply' AND o.status IN ('pending','running')", &[&attempt.job_id,&attempt.candidate.game_title_id,&attempt.candidate.radar_generation]).await?;
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
               status = 'assigned', assigned_attempt_id = (SELECT id FROM series_analysis_job_attempts WHERE legacy_id=$1), legacy_assigned_attempt_id = $1\x20\
             WHERE status = 'pending' AND assigned_job_id = (SELECT id FROM series_analysis_jobs WHERE legacy_id=$2)\x20\
               AND accepted_at <= (SELECT started_at FROM series_analysis_job_attempts WHERE legacy_id = $1)",
            &[&attempt_id, &job_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_operation_requests o SET status = 'running'\x20\
             WHERE status = 'pending' AND EXISTS (\x20\
               SELECT 1 FROM series_analysis_job_requests r\x20\
               WHERE r.operation_request_id = o.id AND r.assigned_attempt_id = (SELECT id FROM series_analysis_job_attempts WHERE legacy_id=$1)\x20\
             )",
            &[&attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t SET status = 'running', updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r\x20\
             WHERE t.job_request_id = r.id AND r.assigned_attempt_id = (SELECT id FROM series_analysis_job_attempts WHERE legacy_id=$1)",
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
            work_kind: String::from("analysis"),
            radar_operation_id: None,
            radar_basis_id: None,
            radar_generation: 0,
            game_title_id: String::from("title-1"),
            input_revision: 1,
            algorithm_version: String::from(ALGORITHM_VERSION),
            artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or(i32::MAX),
            validation_contract_id: validation_contract_id.map(String::from),
            attempt_count: 0,
            fencing_counter: 0,
        }
    }

    #[test]
    fn claim_requires_the_exact_current_publication_contract() {
        let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or(i32::MAX);

        assert!(!supports_candidate(&candidate(None), schema));
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
    async fn real_postgres_requires_explicit_lease_contract_on_claim_and_recovery()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const TITLE_ID: &str = "analysis-validation-lease-fence-title";
        const JOB_ID: &str = "analysis-validation-lease-fence-job";
        let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
        let mut client = crate::identity::fixtures::connect(&database_url).await?;
        let transaction = client.transaction().await?;
        transaction
            .execute(
                r"
                    WITH fixture_titles AS (
                           INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
                           VALUES (pg_temp.fixture_uuid('game_titles', $1), $1, 'validation lease fence', 'momotetsu_2', 9998)
                           RETURNING id
                         )
                      INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
                      SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
                      FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
                      WHERE release.singleton_key = 'current'
                      ON CONFLICT (game_title_id) DO NOTHING
                    ",
                &[&TITLE_ID],
            )
            .await?;
        transaction
            .execute(
                r"
                    UPDATE series_analysis_title_states
                    SET algorithm_version = $2, artifact_schema_version = $3, validation_contract_id = $4
                    WHERE (SELECT fixture_parent.legacy_id
                           FROM game_titles AS fixture_parent
                           WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                    ",
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
                r"
                    INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                                      artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at)
                    VALUES (pg_temp.fixture_uuid('series_analysis_jobs', $1), $1, pg_temp.fixture_uuid('game_titles', $2), 0, $3, $4,
                            $5, 'queued', 'manual', clock_timestamp(), clock_timestamp())
                    ",
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
                r"
                    UPDATE series_analysis_jobs
                    SET status = 'running', started_at = clock_timestamp(), lease_owner = 'legacy-worker',
                        lease_attempt_id = pg_temp.fixture_uuid('series_analysis_job_attempts', 'legacy-attempt'),
                        legacy_lease_attempt_id = 'legacy-attempt', lease_fencing_token = 1,
                        lease_expires_at = clock_timestamp() + CAST('1 minute' AS interval), attempt_count = 1
                    WHERE series_analysis_jobs.legacy_id = $1 AND status = 'queued'
                    ",
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

        let claimed = transaction
            .execute(
                r"
                    UPDATE series_analysis_jobs
                    SET status = 'running', started_at = clock_timestamp(), lease_owner = 'current-worker',
                        lease_attempt_id = pg_temp.fixture_uuid('series_analysis_job_attempts', 'current-attempt'),
                        legacy_lease_attempt_id = 'current-attempt', lease_fencing_token = 2,
                        lease_expires_at = clock_timestamp() - CAST('1 minute' AS interval), lease_validation_contract_id = $2,
                        attempt_count = 1
                    WHERE series_analysis_jobs.legacy_id = $1 AND status = 'queued'
                    ",
                &[&JOB_ID, &ARTIFACT_VALIDATION_CONTRACT_ID],
            )
            .await?;
        assert_eq!(claimed, 1);

        // Trigger-free recovery must clear the lease contract in the same update. A writer
        // that omits this field is rejected before it can leave a partially cleared lease.
        transaction
            .batch_execute("SAVEPOINT incomplete_recovery")
            .await?;
        let incomplete_recovery = transaction.execute(
            "UPDATE series_analysis_jobs SET status='queued', started_at=NULL, lease_owner=NULL, \
             lease_attempt_id=NULL, legacy_lease_attempt_id=NULL, lease_fencing_token=NULL, \
             lease_expires_at=NULL, available_at=clock_timestamp() \
             WHERE legacy_id=$1 AND status='running' AND lease_expires_at<clock_timestamp()",
            &[&JOB_ID],
        ).await;
        let Err(recovery_error) = incomplete_recovery else {
            return Err("recovery retained a stale lease validation contract".into());
        };
        assert_eq!(
            recovery_error
                .as_db_error()
                .and_then(tokio_postgres::error::DbError::constraint),
            Some("series_analysis_jobs_lease_validation_contract_check")
        );
        transaction
            .batch_execute("ROLLBACK TO SAVEPOINT incomplete_recovery")
            .await?;
        let recovered_count = transaction.execute(
            "UPDATE series_analysis_jobs SET status='queued', started_at=NULL, lease_owner=NULL, \
             lease_attempt_id=NULL, legacy_lease_attempt_id=NULL, lease_fencing_token=NULL, \
             lease_expires_at=NULL, lease_validation_contract_id=NULL, available_at=clock_timestamp() \
             WHERE legacy_id=$1 AND status='running' AND lease_expires_at<clock_timestamp()",
            &[&JOB_ID],
        ).await?;
        assert_eq!(recovered_count, 1);
        let recovered = transaction
            .query_one(
                r"
                    SELECT status, lease_validation_contract_id
                    FROM series_analysis_jobs
                    WHERE series_analysis_jobs.legacy_id = $1
                    ",
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
                r"
                    UPDATE series_analysis_jobs
                    SET status = 'running', started_at = clock_timestamp(), lease_owner = 'legacy-worker',
                        lease_attempt_id = pg_temp.fixture_uuid('series_analysis_job_attempts', 'legacy-retry-attempt'),
                        legacy_lease_attempt_id = 'legacy-retry-attempt', lease_fencing_token = 3,
                        lease_expires_at = clock_timestamp() + CAST('1 minute' AS interval), attempt_count = 2
                    WHERE series_analysis_jobs.legacy_id = $1 AND status = 'queued'
                    ",
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
                    r"
                        SELECT status
                        FROM series_analysis_jobs
                        WHERE series_analysis_jobs.legacy_id = $1
                        ",
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
    fn recovered_current_candidate_requires_terminal_state_or_durable_retry() {
        let no_effects = TransactionEffects::empty();
        let mut replacement = TransactionEffects::empty();
        replacement.record_series_analysis();

        assert!(recovered_job_state_resolves_candidate(None, no_effects));
        assert!(recovered_job_state_resolves_candidate(
            Some("failed"),
            no_effects
        ));
        assert!(recovered_job_state_resolves_candidate(
            Some("succeeded"),
            no_effects
        ));
        assert!(recovered_job_state_resolves_candidate(
            Some("queued"),
            replacement
        ));
        assert!(!recovered_job_state_resolves_candidate(
            Some("queued"),
            no_effects
        ));
        assert!(!recovered_job_state_resolves_candidate(
            Some("running"),
            replacement
        ));
    }
}
