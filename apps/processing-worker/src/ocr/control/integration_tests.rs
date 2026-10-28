use std::{error::Error, io, time::Duration};

use serde_json::json;
use tokio_postgres::Client;

use momo_analysis_core::contract::ARTIFACT_SCHEMA_VERSION;

use super::*;
use crate::series_analysis::control::ALGORITHM_VERSION;

type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

const TAKEOVER: Fixture = Fixture {
    job_id: "c2-smoke-job-takeover",
    draft_id: "c2-smoke-draft-takeover",
    match_draft_id: "c2-smoke-match-draft-takeover",
    source_image_id: "c2-smoke-source-takeover",
    object_key: "source-images/c2-smoke-takeover.png",
    idempotency_digit: "1",
};
const SUCCESS: Fixture = Fixture {
    job_id: "c2-smoke-job-success",
    draft_id: "c2-smoke-draft-success",
    match_draft_id: "c2-smoke-match-draft-success",
    source_image_id: "c2-smoke-source-success",
    object_key: "source-images/c2-smoke-success.png",
    idempotency_digit: "2",
};
const SUCCESS_WITH_WARNINGS: Fixture = Fixture {
    job_id: "c2-smoke-job-success-warnings",
    draft_id: "c2-smoke-draft-success-warnings",
    match_draft_id: "c2-smoke-match-draft-success-warnings",
    source_image_id: "c2-smoke-source-success-warnings",
    object_key: "source-images/c2-smoke-success-warnings.png",
    idempotency_digit: "5",
};
const PREEMPT: Fixture = Fixture {
    job_id: "c2-smoke-job-preempt",
    draft_id: "c2-smoke-draft-preempt",
    match_draft_id: "c2-smoke-match-draft-preempt",
    source_image_id: "c2-smoke-source-preempt",
    object_key: "source-images/c2-smoke-preempt.png",
    idempotency_digit: "3",
};
const MALFORMED: Fixture = Fixture {
    job_id: "c2-smoke-job-malformed",
    draft_id: "c2-smoke-draft-malformed",
    match_draft_id: "c2-smoke-match-draft-malformed",
    source_image_id: "c2-smoke-source-malformed",
    object_key: "source-images/c2-smoke-malformed.png",
    idempotency_digit: "4",
};
const ANALYSIS_RECOVERY: Fixture = Fixture {
    job_id: "c2-smoke-job-analysis-recovery",
    draft_id: "c2-smoke-draft-analysis-recovery",
    match_draft_id: "c2-smoke-match-draft-analysis-recovery",
    source_image_id: "c2-smoke-source-analysis-recovery",
    object_key: "source-images/c2-smoke-analysis-recovery.png",
    idempotency_digit: "6",
};
const TRANSIENT: Fixture = Fixture {
    job_id: "c2-smoke-job-transient",
    draft_id: "c2-smoke-draft-transient",
    match_draft_id: "c2-smoke-match-draft-transient",
    source_image_id: "c2-smoke-source-transient",
    object_key: "source-images/c2-smoke-transient.png",
    idempotency_digit: "7",
};

const EXPIRED_ANALYSIS_TITLE_ID: &str = "c2-smoke-analysis-recovery-title";
const EXPIRED_ANALYSIS_JOB_ID: &str = "c2-smoke-analysis-recovery-job";
const EXPIRED_ANALYSIS_ATTEMPT_ID: &str = "c2-smoke-analysis-recovery-attempt";
const EXPIRED_ANALYSIS_WORKER_ID: &str = "c2-smoke-analysis-recovery-worker";
const EXPIRED_ANALYSIS_FENCE: i64 = 2_000_001;

mod claim_shutdown;
mod finalization;

struct Fixture {
    job_id: &'static str,
    draft_id: &'static str,
    match_draft_id: &'static str,
    source_image_id: &'static str,
    object_key: &'static str,
    idempotency_digit: &'static str,
}

#[tokio::test]
#[ignore = "requires explicitly isolated OCR_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_preserves_ocr_fencing_and_bounded_recovery() -> SmokeResult {
    let database_url = std::env::var("OCR_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = crate::identity::fixtures::connect(&database_url).await?;
    let mut stale = crate::identity::fixtures::connect(&database_url).await?;
    prepare_database(&primary).await?;
    verify_stale_maintenance(&mut primary).await?;
    prepare_database(&primary).await?;
    claim_shutdown::verify(&database_url, &primary).await?;
    finalization::verify(&database_url, &mut primary).await?;
    prepare_database(&primary).await?;
    for fixture in [
        &TAKEOVER,
        &SUCCESS,
        &SUCCESS_WITH_WARNINGS,
        &PREEMPT,
        &MALFORMED,
        &ANALYSIS_RECOVERY,
        &TRANSIENT,
    ] {
        insert_fixture(&primary, fixture).await?;
    }

    verify_candidate_integrity(&mut primary).await?;
    verify_expired_takeover(&mut primary, &mut stale).await?;
    verify_success_and_terminal_duplicate(&mut primary).await?;
    verify_success_with_warnings(&mut primary).await?;
    verify_expired_analysis_recovery_emits_wake(&mut primary).await?;
    verify_independent_jobs_and_counter_exhaustion(&mut primary).await?;
    verify_transient_retry_budget(&mut primary).await?;
    verify_malformed_snapshot(&mut primary).await?;

    cleanup_database(&primary).await?;
    Ok(())
}

async fn verify_stale_maintenance(primary: &mut Client) -> SmokeResult {
    let stale_after = Duration::from_secs(300);
    let timeout = Duration::from_secs(5);
    maintenance::reap_stale(primary, stale_after, timeout).await?;
    insert_fixture(primary, &TAKEOVER).await?;
    insert_fixture(primary, &SUCCESS).await?;
    let config = control_config("ocr-c2-worker-success")?;
    let live = claimed(claim_job(primary, SUCCESS.job_id, &config).await?)?;
    primary.execute(r"
        UPDATE ocr_jobs
        SET created_at = clock_timestamp() - CAST('1 hour' AS interval)
          , started_at = CASE
                           WHEN status = 'running' THEN clock_timestamp() - CAST('1 hour' AS interval)
                           ELSE NULL
                         END
        WHERE ocr_jobs.legacy_id IN ($1, $2)
        ", &[&TAKEOVER.job_id,&SUCCESS.job_id]).await?;
    maintenance::reap_stale(primary, stale_after, timeout).await?;
    let stale = primary
        .query_one(
            r"
                SELECT status, failure_code
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TAKEOVER.job_id],
        )
        .await?;
    assert_eq!(stale.try_get::<_, String>(0)?, "failed");
    assert_eq!(stale.try_get::<_, String>(1)?, "OCR_TIMEOUT");
    assert_match_draft_status(primary, &TAKEOVER, "ocr_failed").await?;
    let active = primary
        .query_one(
            r"
                SELECT status, CAST(attempt_id AS text)
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&SUCCESS.job_id],
        )
        .await?;
    assert_eq!(active.try_get::<_, String>(0)?, "running");
    assert_eq!(active.try_get::<_, String>(1)?, live.attempt_id);
    assert_match_draft_status(primary, &SUCCESS, "ocr_running").await?;
    Ok(())
}

async fn verify_candidate_integrity(primary: &mut Client) -> SmokeResult {
    for invalid_state in [
        r"
            UPDATE ocr_jobs
            SET input_snapshot = jsonb_build_object('schemaVersion', '2')
            WHERE ocr_jobs.legacy_id = $1
            ",
        r"
            UPDATE source_images
            SET status = 'DELETE_PENDING', delete_pending_at = clock_timestamp()
            WHERE id = (SELECT source_image_id FROM ocr_jobs WHERE legacy_id=$1)
            ",
    ] {
        let transaction = primary.transaction().await?;
        transaction
            .execute(invalid_state, &[&SUCCESS.job_id])
            .await?;
        assert!(
            matches!(
                load_candidate(&transaction, SUCCESS.job_id).await?,
                CandidateResult::InvalidPersistedContract
            ),
            "invalid immutable input or unavailable source must fail before acquiring ownership"
        );
        transaction.rollback().await?;
    }
    let transaction = primary.transaction().await?;
    let CandidateResult::Ready(candidate) = load_candidate(&transaction, SUCCESS.job_id).await?
    else {
        return Err(
            smoke_error("restored source and snapshot did not yield a ready candidate").into(),
        );
    };
    assert!(candidate.matches());
    transaction.rollback().await?;
    Ok(())
}

async fn verify_expired_takeover(primary: &mut Client, stale: &mut Client) -> SmokeResult {
    let job_id = TAKEOVER.job_id;
    let config_a = control_config("ocr-c2-worker-a")?;
    let config_b = control_config("ocr-c2-worker-b")?;
    let stale_claim = claimed(claim_job(primary, job_id, &config_a).await?)?;
    assert_eq!(stale_claim.attempt_count, 1);
    assert!(matches!(
        claim_result(claim_job(primary, job_id, &config_b).await?)?,
        OcrClaimResult::AlreadyRunning
    ));

    primary
        .execute(
            r"
                UPDATE ocr_jobs
                SET lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
                WHERE ocr_jobs.legacy_id = $1 AND lease_owner = $2 AND CAST(attempt_id AS text) = $3 AND lease_fencing_token = $4
                ",
            &[
                &stale_claim.job_id,
                &config_a.worker_id,
                &stale_claim.attempt_id,
                &stale_claim.fencing_token,
            ],
        )
        .await?;

    let current_claim = claimed(claim_job(primary, job_id, &config_b).await?)?;
    assert_eq!(current_claim.attempt_count, 2);
    assert!(current_claim.fencing_token > stale_claim.fencing_token);
    assert_eq!(
        heartbeat(stale, &stale_claim, &config_a).await?,
        OcrHeartbeatResult::OwnerLost
    );
    assert!(matches!(
        finish_failure(
            stale,
            &stale_claim,
            &config_a,
            OcrFailureCode::ParserFailed,
            1,
        )
        .await,
        Err(OcrControlError::OwnerLost)
    ));

    primary
        .execute(
            r"
        UPDATE ocr_jobs
        SET lease_expires_at = clock_timestamp() - CAST('1 second' AS interval)
        WHERE ocr_jobs.legacy_id = $1
        ",
            &[&TAKEOVER.job_id],
        )
        .await?;
    assert!(matches!(
        claim_result(claim_job(primary, job_id, &config_a).await?)?,
        OcrClaimResult::MissingOrTerminal
    ));
    let row = primary
        .query_one(
            r"
                SELECT status, failure_code, attempt_count, lease_recovery_count, failure_retry_count
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TAKEOVER.job_id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "failed");
    assert_eq!(row.try_get::<_, String>(1)?, "OCR_TIMEOUT");
    assert_eq!(row.try_get::<_, i32>(2)?, 2);
    assert_eq!(row.try_get::<_, i32>(3)?, 1);
    assert_eq!(row.try_get::<_, i32>(4)?, 0);
    assert_match_draft_status(primary, &TAKEOVER, "ocr_failed").await?;
    assert!(matches!(
        claim_result(claim_job(primary, job_id, &config_a).await?)?,
        OcrClaimResult::MissingOrTerminal
    ));
    Ok(())
}

async fn verify_success_and_terminal_duplicate(primary: &mut Client) -> SmokeResult {
    let job_id = SUCCESS.job_id;
    let config = control_config("ocr-c2-worker-success")?;
    let legacy_hints = r#"{"layoutFamily":" MOMOTETSU_WORLD "}"#;
    primary.execute(
        r"
            UPDATE ocr_jobs
            SET input_snapshot = input_snapshot || jsonb_build_object('ocrHintsJson', CAST($2 AS text))
            WHERE ocr_jobs.legacy_id = $1
            ",
        &[&job_id, &legacy_hints],
    ).await?;
    let before = primary
        .query_one(
            r"
                SELECT CAST(input_snapshot AS text)
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&job_id],
        )
        .await?
        .try_get::<_, String>(0)?;
    let claim = claimed(claim_job(primary, job_id, &config).await?)?;
    assert_eq!(
        serde_json::to_value(claim.hints.as_ref())?
            .get("layoutFamily")
            .and_then(serde_json::Value::as_str),
        Some(" MOMOTETSU_WORLD ")
    );
    let completion = tests::valid_completion(RequestedScreenType::TotalAssets);
    finish_success(primary, &claim, &config, &claim.hints, &completion).await?;
    let after = primary
        .query_one(
            r"
                SELECT CAST(input_snapshot AS text)
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&job_id],
        )
        .await?
        .try_get::<_, String>(0)?;
    assert_eq!(
        before, after,
        "claim and durable completion preserve the old immutable input"
    );
    let row = primary
        .query_one(
            r"
                SELECT j.status, CAST(count(d.legacy_id) AS bigint)
                FROM ocr_jobs AS j LEFT JOIN ocr_drafts AS d ON d.legacy_job_id = j.legacy_id
                WHERE j.legacy_id = $1
                GROUP BY j.status
                ",
            &[&SUCCESS.job_id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "succeeded");
    assert_eq!(row.try_get::<_, i64>(1)?, 1);
    assert_match_draft_status(primary, &SUCCESS, "draft_ready").await?;
    assert!(matches!(
        claim_result(claim_job(primary, job_id, &config).await?)?,
        OcrClaimResult::MissingOrTerminal
    ));
    Ok(())
}

async fn verify_success_with_warnings(primary: &mut Client) -> SmokeResult {
    let job_id = SUCCESS_WITH_WARNINGS.job_id;
    let config = control_config("ocr-c2-worker-success-warnings")?;
    let claim = claimed(claim_job(primary, job_id, &config).await?)?;
    let completion = tests::completion_with_missing_amount_warning();
    finish_success(primary, &claim, &config, &OcrHints::default(), &completion).await?;
    assert_match_draft_status(primary, &SUCCESS_WITH_WARNINGS, "needs_review").await?;
    Ok(())
}

async fn prepare_expired_analysis_holder(primary: &Client) -> SmokeResult {
    let schema_version = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    primary
        .execute(
            r"
                WITH fixture_titles AS (
                       INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
                       VALUES (pg_temp.fixture_uuid('game_titles', $1), $1, 'OCR recovery smoke', 'momotetsu_2', 9998)
                       RETURNING id
                     )
                  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
                  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
                  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
                  WHERE release.singleton_key = 'current'
                  ON CONFLICT (game_title_id) DO NOTHING
                ",
            &[&EXPIRED_ANALYSIS_TITLE_ID],
        )
        .await?;
    primary
        .execute(
            r"
                UPDATE series_analysis_title_states
                SET input_revision = 1, algorithm_version = $1, artifact_schema_version = $2, validation_contract_id = $4, pending_work = TRUE
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $3
                ",
            &[
                &ALGORITHM_VERSION,
                &schema_version,
                &EXPIRED_ANALYSIS_TITLE_ID,
                &momo_analysis_core::contract::ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?;
    primary
        .execute(
            r"
                INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                                  artifact_schema_version, status, trigger, started_at, lease_owner, lease_attempt_id, legacy_lease_attempt_id,
                                                  lease_fencing_token, lease_expires_at, attempt_count, fencing_counter)
                VALUES (pg_temp.fixture_uuid('series_analysis_jobs', $1), $1, pg_temp.fixture_uuid('game_titles', $2), 1, $3, $4,
                        'running', 'manual', clock_timestamp(), $5, pg_temp.fixture_uuid('series_analysis_job_attempts', $6), $6, $7,
                        clock_timestamp() - CAST('1 second' AS interval), 1, $7)
                ",
            &[
                &EXPIRED_ANALYSIS_JOB_ID,
                &EXPIRED_ANALYSIS_TITLE_ID,
                &ALGORITHM_VERSION,
                &schema_version,
                &EXPIRED_ANALYSIS_WORKER_ID,
                &EXPIRED_ANALYSIS_ATTEMPT_ID,
                &EXPIRED_ANALYSIS_FENCE,
            ],
        )
        .await?;
    primary
        .execute(
            r"
                INSERT INTO series_analysis_job_attempts (id, legacy_id, job_id, attempt_no, owner, fencing_token, input_revision,
                                                          algorithm_version, artifact_schema_version, status, effective_config_version, calculation_timeout_milliseconds)
                VALUES (pg_temp.fixture_uuid('series_analysis_job_attempts', $1), $1,
                        pg_temp.fixture_uuid('series_analysis_jobs', $2), 1, $3, $4, 1, $5, $6, 'running', 'ocr-recovery-smoke', 60000)
                ",
            &[
                &EXPIRED_ANALYSIS_ATTEMPT_ID,
                &EXPIRED_ANALYSIS_JOB_ID,
                &EXPIRED_ANALYSIS_WORKER_ID,
                &EXPIRED_ANALYSIS_FENCE,
                &ALGORITHM_VERSION,
                &schema_version,
            ],
        )
        .await?;
    Ok(())
}

async fn verify_expired_analysis_recovery_emits_wake(primary: &mut Client) -> SmokeResult {
    prepare_expired_analysis_holder(primary).await?;
    let job_id = ANALYSIS_RECOVERY.job_id;
    let config = control_config("ocr-c2-analysis-recovery")?;
    let claim = claimed(claim_job(primary, job_id, &config).await?)?;
    let status: String = primary
        .query_one(
            r"
                SELECT status
                FROM series_analysis_jobs
                WHERE series_analysis_jobs.legacy_id = $1
                ",
            &[&EXPIRED_ANALYSIS_JOB_ID],
        )
        .await?
        .try_get(0)?;
    assert_eq!(
        status, "running",
        "an OCR claim must not recover another job"
    );
    let transaction = primary.transaction().await?;
    let effects = crate::series_analysis::control::recovery::recover_expired_analysis_job(
        &transaction,
        &ExpiredJobLease {
            job_id: String::from(EXPIRED_ANALYSIS_JOB_ID),
            owner: String::from(EXPIRED_ANALYSIS_WORKER_ID),
            attempt_id: String::from(EXPIRED_ANALYSIS_ATTEMPT_ID),
            fencing_token: EXPIRED_ANALYSIS_FENCE,
        },
    )
    .await?;
    transaction.commit().await?;
    assert_eq!(
        effects.committed(()).effects,
        crate::worker::PostCommitEffects::WakeJobs
    );
    let recovered = primary
        .query_one(
            r"
                SELECT j.status, j.lease_recovery_count, a.status, a.outcome
                FROM series_analysis_jobs AS j
                     INNER JOIN series_analysis_job_attempts AS a ON (SELECT fixture_parent.legacy_id
                                                                      FROM series_analysis_jobs AS fixture_parent
                                                                      WHERE fixture_parent.id = a.job_id) = j.legacy_id
                WHERE j.legacy_id = $1 AND a.legacy_id = $2
                ",
            &[&EXPIRED_ANALYSIS_JOB_ID, &EXPIRED_ANALYSIS_ATTEMPT_ID],
        )
        .await?;
    assert_eq!(recovered.try_get::<_, String>(0)?, "queued");
    assert_eq!(recovered.try_get::<_, i32>(1)?, 1);
    assert_eq!(recovered.try_get::<_, String>(2)?, "terminal");
    assert_eq!(recovered.try_get::<_, String>(3)?, "owner_lost");

    finish_failure(
        primary,
        &claim,
        &config,
        OcrFailureCode::CategoryUndetected,
        1,
    )
    .await?;
    assert_match_draft_status(primary, &ANALYSIS_RECOVERY, "ocr_failed").await?;
    Ok(())
}

async fn verify_independent_jobs_and_counter_exhaustion(primary: &mut Client) -> SmokeResult {
    let first_config = control_config("ocr-c2-priority")?;
    let second_config = control_config("ocr-c2-independent")?;
    let first = claimed(claim_job(primary, PREEMPT.job_id, &first_config).await?)?;
    primary
        .execute(
            r"
                UPDATE ocr_jobs
                SET lease_fencing_token = $2
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id, &i64::MAX],
        )
        .await?;
    assert!(matches!(
        claim_job(primary, TRANSIENT.job_id, &second_config).await,
        Err(OcrControlError::NumericBound)
    ));
    let overflow = primary
        .query_one(
            r"
                SELECT status, attempt_count, lease_fencing_token
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id],
        )
        .await?;
    assert_eq!(overflow.try_get::<_, String>(0)?, "queued");
    assert_eq!(overflow.try_get::<_, i32>(1)?, 0);
    assert_eq!(overflow.try_get::<_, i64>(2)?, i64::MAX);
    primary
        .execute(
            r"
                UPDATE ocr_jobs
                SET lease_fencing_token = 0
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id],
        )
        .await?;
    let second = claimed(claim_job(primary, TRANSIENT.job_id, &second_config).await?)?;
    assert_eq!(first.fencing_token, 1);
    assert_eq!(
        second.fencing_token, 1,
        "fences are monotonic within each job"
    );
    assert_eq!(
        heartbeat(primary, &first, &first_config).await?,
        OcrHeartbeatResult::Continue
    );
    assert_eq!(
        heartbeat(primary, &second, &second_config).await?,
        OcrHeartbeatResult::Continue
    );
    finish_failure(
        primary,
        &first,
        &first_config,
        OcrFailureCode::CategoryUndetected,
        1,
    )
    .await?;
    requeue_interrupted(primary, &second, &second_config).await?;
    let retained: i64 = primary
        .query_one(
            r"
                SELECT lease_fencing_token
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id],
        )
        .await?
        .try_get(0)?;
    assert_eq!(retained, second.fencing_token);
    assert_match_draft_status(primary, &PREEMPT, "ocr_failed").await?;
    Ok(())
}

async fn verify_transient_retry_budget(primary: &mut Client) -> SmokeResult {
    let config = control_config("ocr-c2-transient")?;
    let interrupted_claim = claimed(claim_job(primary, TRANSIENT.job_id, &config).await?)?;
    requeue_interrupted(primary, &interrupted_claim, &config).await?;
    let counters = primary
        .query_one(
            r"
                SELECT failure_retry_count, lease_recovery_count
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id],
        )
        .await?;
    assert_eq!(counters.try_get::<_, i32>(0)?, 0);
    assert_eq!(counters.try_get::<_, i32>(1)?, 0);
    let first_failure_claim = claimed(claim_job(primary, TRANSIENT.job_id, &config).await?)?;
    requeue_transient(primary, &first_failure_claim, &config).await?;
    let row = primary
        .query_one(
            r"
        SELECT status, available_at > clock_timestamp(), failure_retry_count, lease_recovery_count
        FROM ocr_jobs
        WHERE ocr_jobs.legacy_id = $1
        ",
            &[&TRANSIENT.job_id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "queued");
    assert!(row.try_get::<_, bool>(1)?);
    assert_eq!(row.try_get::<_, i32>(2)?, 1);
    assert_eq!(row.try_get::<_, i32>(3)?, 0);
    primary
        .execute(
            r"
                UPDATE ocr_jobs
                SET available_at = clock_timestamp()
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id],
        )
        .await?;
    let second_failure_claim = claimed(claim_job(primary, TRANSIENT.job_id, &config).await?)?;
    requeue_transient(primary, &second_failure_claim, &config).await?;
    let terminal = primary
        .query_one(
            r"
                SELECT status, failure_retry_count, input_snapshot
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TRANSIENT.job_id],
        )
        .await?;
    assert_eq!(terminal.try_get::<_, String>(0)?, "failed");
    assert_eq!(terminal.try_get::<_, i32>(1)?, 1);
    assert_eq!(
        terminal.try_get::<_, serde_json::Value>(2)?,
        persisted_payload(&TRANSIENT)
    );
    assert_match_draft_status(primary, &TRANSIENT, "ocr_failed").await?;
    Ok(())
}

async fn verify_malformed_snapshot(primary: &mut Client) -> SmokeResult {
    primary
        .execute(
            r"
        UPDATE ocr_jobs
        SET input_snapshot = jsonb_build_object('schemaVersion', '2')
        WHERE ocr_jobs.legacy_id = $1
        ",
            &[&MALFORMED.job_id],
        )
        .await?;
    let config = control_config("ocr-c2-transient")?;
    assert!(matches!(
        claim_result(claim_job(primary, MALFORMED.job_id, &config).await?)?,
        OcrClaimResult::InvalidInput
    ));
    let row = primary
        .query_one(
            r"
                SELECT status, failure_code, attempt_count
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&MALFORMED.job_id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "failed");
    assert_eq!(row.try_get::<_, String>(1)?, "QUEUE_FAILURE");
    assert_eq!(row.try_get::<_, i32>(2)?, 0);
    assert_match_draft_status(primary, &MALFORMED, "ocr_failed").await?;
    Ok(())
}

async fn prepare_database(client: &Client) -> SmokeResult {
    cleanup_database(client).await?;
    Ok(())
}

async fn insert_fixture(client: &Client, fixture: &Fixture) -> SmokeResult {
    let idempotency_hash = fixture
        .idempotency_digit
        .repeat(64 / fixture.idempotency_digit.len());
    let sha256 = "ab".repeat(32);
    client
        .execute(
            r"
                INSERT INTO source_images (id, legacy_id, owner_account_id, object_key, idempotency_key_hash, status, media_type,
                                           byte_length, sha256_hex, width, height, storage_etag, available_at)
                VALUES (pg_temp.fixture_uuid('source_images', $1), $1, pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'),
                        $2, $3, 'AVAILABLE', 'image/png', 68, $4, 1, 1, 'c2-smoke-etag', clock_timestamp())
                ",
            &[
                &fixture.source_image_id,
                &fixture.object_key,
                &idempotency_hash,
                &sha256,
            ],
        )
        .await?;
    client
        .execute(
            r"
                INSERT INTO match_drafts (id, legacy_id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
                                          legacy_total_assets_draft_id, created_at, updated_at)
                VALUES (pg_temp.fixture_uuid('match_drafts', $1), $1, pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'),
                        pg_temp.fixture_uuid('members', 'member_ponta'), 'ocr_running', pg_temp.fixture_uuid('ocr_drafts', $2), $2,
                        clock_timestamp(), clock_timestamp())
                ",
            &[&fixture.match_draft_id, &fixture.draft_id],
        )
        .await?;
    client
        .execute(
            r"
                INSERT INTO ocr_jobs (id, legacy_id, draft_id, legacy_draft_id, image_id, image_path, requested_screen_type, status,
                                      source_image_id, input_snapshot, available_at)
                VALUES (pg_temp.fixture_uuid('ocr_jobs', $1), $1, pg_temp.fixture_uuid('ocr_drafts', $2), $2, $3, NULL,
                        'total_assets', 'queued', pg_temp.fixture_uuid('source_images', $3), $4, clock_timestamp())
                ",
            &[
                &fixture.job_id,
                &fixture.draft_id,
                &fixture.source_image_id,
                &persisted_payload(fixture),
            ],
        )
        .await?;
    let submission_id = format!(
        "00000000-0000-4000-8000-{:012}",
        fixture.idempotency_digit.parse::<u32>()?
    );
    client
        .execute(
            r"
        INSERT INTO ocr_submissions (id, legacy_id, owner_account_id, match_draft_id, legacy_match_draft_id, ocr_hints_json,
                                     status, admission_deadline)
        VALUES (pg_temp.fixture_uuid('ocr_submissions', $1), $1,
                pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), pg_temp.fixture_uuid('match_drafts', $2), $2,
                CAST('{}' AS jsonb), 'open', clock_timestamp() + CAST('10 minutes' AS interval))
        ",
            &[&submission_id, &fixture.match_draft_id],
        )
        .await?;
    client
        .execute(
            r"
        INSERT INTO ocr_submission_members (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex,
                                            image_byte_length, status, job_id)
        VALUES (pg_temp.fixture_uuid('ocr_submissions', $1), 'total_assets', $2, $3, 68, 'registered',
                pg_temp.fixture_uuid('ocr_jobs', $4))
        ",
            &[&submission_id, &idempotency_hash, &sha256, &fixture.job_id],
        )
        .await?;
    Ok(())
}

async fn cleanup_database(client: &Client) -> SmokeResult {
    client
        .batch_execute(
            r"
                DELETE FROM match_drafts
                WHERE match_drafts.legacy_id IN ('c2-smoke-match-draft-takeover', 'c2-smoke-match-draft-success', 'c2-smoke-match-draft-success-warnings', 'c2-smoke-match-draft-preempt', 'c2-smoke-match-draft-malformed', 'c2-smoke-match-draft-analysis-recovery', 'c2-smoke-match-draft-transient');
                DELETE FROM ocr_drafts
                WHERE ocr_drafts.legacy_job_id IN ('c2-smoke-job-takeover', 'c2-smoke-job-success', 'c2-smoke-job-success-warnings', 'c2-smoke-job-preempt', 'c2-smoke-job-malformed', 'c2-smoke-job-analysis-recovery', 'c2-smoke-job-transient');
                DELETE FROM ocr_submission_members
                WHERE (SELECT fixture_parent.legacy_id
                       FROM ocr_submissions AS fixture_parent
                       WHERE fixture_parent.id = ocr_submission_members.submission_id) IN (SELECT ocr_submissions.legacy_id AS id
                                                                                           FROM ocr_submissions
                                                                                           WHERE ocr_submissions.legacy_match_draft_id LIKE 'c2-smoke-match-draft-%');
                DELETE FROM ocr_submissions
                WHERE ocr_submissions.legacy_match_draft_id LIKE 'c2-smoke-match-draft-%';
                DELETE FROM ocr_jobs
                WHERE ocr_jobs.legacy_id IN ('c2-smoke-job-takeover', 'c2-smoke-job-success', 'c2-smoke-job-success-warnings', 'c2-smoke-job-preempt', 'c2-smoke-job-malformed', 'c2-smoke-job-analysis-recovery', 'c2-smoke-job-transient');
                DELETE FROM source_images
                WHERE source_images.legacy_id IN ('c2-smoke-source-takeover', 'c2-smoke-source-success', 'c2-smoke-source-success-warnings', 'c2-smoke-source-preempt', 'c2-smoke-source-malformed', 'c2-smoke-source-analysis-recovery', 'c2-smoke-source-transient');
                DELETE FROM series_analysis_job_attempts
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_analysis_jobs AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_job_attempts.job_id) = 'c2-smoke-analysis-recovery-job';
                DELETE FROM series_analysis_jobs
                WHERE series_analysis_jobs.legacy_id = 'c2-smoke-analysis-recovery-job';
                DELETE FROM game_titles
                WHERE game_titles.legacy_id = 'c2-smoke-analysis-recovery-title';
                ",
        )
        .await?;
    Ok(())
}

async fn assert_match_draft_status(
    client: &Client,
    fixture: &Fixture,
    expected: &str,
) -> SmokeResult {
    let status = client
        .query_one(
            r"
                SELECT status
                FROM match_drafts
                WHERE match_drafts.legacy_id = $1
                ",
            &[&fixture.match_draft_id],
        )
        .await?
        .try_get::<_, String>(0)?;
    assert_eq!(status, expected);
    Ok(())
}

fn persisted_payload(fixture: &Fixture) -> serde_json::Value {
    json!({
        "schemaVersion": "2",
        "jobId": fixture.job_id,
        "draftId": fixture.draft_id,
        "sourceImageId": fixture.source_image_id,
        "imageObjectKey": fixture.object_key,
        "sha256": "ab".repeat(32),
        "byteLength": "68",
        "mediaType": "image/png",
        "requestedScreenType": "total_assets",
    })
}

fn control_config(worker_id: &str) -> SmokeResult<OcrControlConfig> {
    OcrControlConfig::new(
        String::from(worker_id),
        Duration::from_secs(5),
        Duration::from_secs(1),
        Duration::from_millis(100),
    )
    .map_err(Into::into)
}

fn claim_result(outcome: ControlOutcome<OcrClaimResult>) -> SmokeResult<OcrClaimResult> {
    if outcome.effects == crate::worker::PostCommitEffects::WakeJobs {
        return Err(smoke_error("normal OCR claim unexpectedly emitted an scheduler wake").into());
    }
    Ok(outcome.value)
}

fn claimed(outcome: ControlOutcome<OcrClaimResult>) -> SmokeResult<ClaimedOcrJob> {
    match claim_result(outcome)? {
        OcrClaimResult::Claimed(claim) => Ok(claim),
        other @ (OcrClaimResult::MissingOrTerminal
        | OcrClaimResult::AlreadyRunning
        | OcrClaimResult::NotYetAvailable
        | OcrClaimResult::InvalidInput) => {
            Err(smoke_error(format!("expected claimed OCR job, got {other:?}")).into())
        }
    }
}

fn smoke_error(message: impl Into<String>) -> io::Error {
    io::Error::other(message.into())
}
