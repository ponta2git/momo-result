use std::{error::Error, io, time::Duration};

use serde_json::json;
use tokio_postgres::Client;

use momo_analysis_core::contract::ARTIFACT_SCHEMA_VERSION;

use super::*;
use crate::{
    execution_slot::{
        ExecutionSlotIdentity, ExecutionTaskKind, clear_stale_preemption, release_owned,
    },
    series_analysis::control::ALGORITHM_VERSION,
};

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
    let mut primary = crate::postgres::connect(&database_url).await?;
    let mut stale = crate::postgres::connect(&database_url).await?;
    prepare_database(&primary).await?;
    claim_shutdown::verify(&database_url, &primary).await?;
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
    verify_analysis_preemption_and_stale_intent(&mut primary).await?;
    verify_transient_retry_budget(&mut primary).await?;
    verify_malformed_snapshot(&mut primary).await?;

    cleanup_database(&primary).await?;
    Ok(())
}

async fn verify_candidate_integrity(primary: &mut Client) -> SmokeResult {
    for invalid_state in [
        "UPDATE ocr_jobs SET input_snapshot = jsonb_build_object('schemaVersion', '2') WHERE id = $1",
        "UPDATE source_images SET status = 'DELETE_PENDING', delete_pending_at = clock_timestamp() \
         WHERE id = (SELECT source_image_id FROM ocr_jobs WHERE id = $1)",
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
            "UPDATE worker_execution_slots SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE slot_key = 'shared-heavy-work' AND task_kind = 'ocr' AND owner = $1\x20\
               AND job_id = $2 AND attempt_id = $3 AND fencing_token = $4",
            &[
                &config_a.worker_id,
                &stale_claim.job_id,
                &stale_claim.attempt_id,
                &stale_claim.fencing_token,
            ],
        )
        .await?;
    primary
        .execute(
            "UPDATE ocr_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'\x20\
             WHERE id = $1 AND lease_owner = $2 AND attempt_id::text = $3\x20\
               AND lease_fencing_token = $4",
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

    primary.execute("UPDATE worker_execution_slots SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE slot_key='shared-heavy-work' AND job_id=$1", &[&TAKEOVER.job_id]).await?;
    primary.execute("UPDATE ocr_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", &[&TAKEOVER.job_id]).await?;
    assert!(matches!(
        claim_result(claim_job(primary, job_id, &config_a).await?)?,
        OcrClaimResult::MissingOrTerminal
    ));
    let row = primary
        .query_one(
            "SELECT status, failure_code, attempt_count, lease_recovery_count, failure_retry_count FROM ocr_jobs WHERE id = $1",
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
    let claim = claimed(claim_job(primary, job_id, &config).await?)?;
    let completion = tests::valid_completion(RequestedScreenType::TotalAssets);
    finish_success(primary, &claim, &config, &OcrHints::default(), &completion).await?;
    let row = primary
        .query_one(
            "SELECT j.status, COUNT(d.id)::bigint FROM ocr_jobs j\x20\
             LEFT JOIN ocr_drafts d ON d.job_id = j.id WHERE j.id = $1 GROUP BY j.status",
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
            "INSERT INTO game_titles (id, name, layout_family, display_order)\x20\
             VALUES ($1, 'OCR recovery smoke', 'momotetsu2', 9998)",
            &[&EXPIRED_ANALYSIS_TITLE_ID],
        )
        .await?;
    primary
        .execute(
            "UPDATE series_analysis_title_states SET input_revision = 1, algorithm_version = $1,\x20\
               artifact_schema_version = $2, validation_contract_id = $4, pending_work = true WHERE game_title_id = $3",
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
            "INSERT INTO series_analysis_jobs (id, game_title_id, input_revision,\x20\
               algorithm_version, artifact_schema_version, status, trigger, started_at,\x20\
               lease_owner, lease_attempt_id, lease_fencing_token, lease_expires_at, attempt_count)\x20\
             VALUES ($1, $2, 1, $3, $4, 'running', 'manual', clock_timestamp(), $5, $6, $7,\x20\
               clock_timestamp() - interval '1 second', 1)",
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
            "INSERT INTO series_analysis_job_attempts (id, job_id, attempt_no, owner,\x20\
               fencing_token, input_revision, algorithm_version, artifact_schema_version, status,\x20\
               effective_config_version, calculation_timeout_milliseconds)\x20\
             VALUES ($1, $2, 1, $3, $4, 1, $5, $6, 'running', 'ocr-recovery-smoke', 60000)",
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
    let installed = primary
        .execute(
            "UPDATE worker_execution_slots SET task_kind = 'analysis', owner = $1, job_id = $2,\x20\
               attempt_id = $3, holder_preemptible = true, lease_expires_at =\x20\
               clock_timestamp() - interval '1 second', fencing_token = $4,\x20\
               preempt_requested_by = NULL, preempt_requested_at = NULL,\x20\
               updated_at = clock_timestamp() WHERE slot_key = 'shared-heavy-work' AND owner IS NULL",
            &[
                &EXPIRED_ANALYSIS_WORKER_ID,
                &EXPIRED_ANALYSIS_JOB_ID,
                &EXPIRED_ANALYSIS_ATTEMPT_ID,
                &EXPIRED_ANALYSIS_FENCE,
            ],
        )
        .await?;
    if installed != 1 {
        return Err(
            smoke_error("expired Analysis fixture could not acquire the empty slot").into(),
        );
    }
    Ok(())
}

async fn verify_expired_analysis_recovery_emits_wake(primary: &mut Client) -> SmokeResult {
    prepare_expired_analysis_holder(primary).await?;
    let job_id = ANALYSIS_RECOVERY.job_id;
    let config = control_config("ocr-c2-analysis-recovery")?;
    let claim = claimed_with_analysis_wake(claim_job(primary, job_id, &config).await?)?;
    let recovered = primary
        .query_one(
            "SELECT j.status, j.lease_recovery_count, a.status, a.outcome\x20\
             FROM series_analysis_jobs j JOIN series_analysis_job_attempts a ON a.job_id = j.id\x20\
             WHERE j.id = $1 AND a.id = $2",
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

async fn verify_analysis_preemption_and_stale_intent(primary: &mut Client) -> SmokeResult {
    let job_id = PREEMPT.job_id;
    let config = control_config("ocr-c2-priority")?;
    let row = primary
        .query_opt(
            "UPDATE worker_execution_slots SET task_kind = 'analysis', owner = 'analysis-c2-holder',\x20\
               job_id = 'analysis-c2-job', attempt_id = 'analysis-c2-attempt',\x20\
               holder_preemptible = true, lease_expires_at = clock_timestamp() + interval '1 minute',\x20\
               fencing_token = fencing_token + 1, preempt_requested_by = NULL,\x20\
               preempt_requested_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE slot_key = 'shared-heavy-work' AND owner IS NULL RETURNING fencing_token",
            &[],
        )
        .await?
        .ok_or_else(|| smoke_error("analysis preemption fixture could not acquire the empty slot"))?;
    let analysis_fence = row.try_get::<_, i64>(0)?;
    assert!(matches!(
        claim_result(claim_job(primary, job_id, &config).await?)?,
        OcrClaimResult::PreemptionRequested
    ));
    let requester = primary
        .query_one(
            "SELECT preempt_requested_by FROM worker_execution_slots\x20\
             WHERE slot_key = 'shared-heavy-work'",
            &[],
        )
        .await?
        .try_get::<_, Option<String>>(0)?;
    assert_eq!(requester.as_deref(), Some("ocr-c2-priority"));

    let release_transaction = primary.transaction().await?;
    assert!(
        release_owned(
            &release_transaction,
            ExecutionSlotIdentity {
                task_kind: ExecutionTaskKind::Analysis,
                owner: "analysis-c2-holder",
                job_id: "analysis-c2-job",
                attempt_id: "analysis-c2-attempt",
                fencing_token: analysis_fence,
            },
        )
        .await?
    );
    release_transaction.commit().await?;
    let claim = claimed(claim_job(primary, job_id, &config).await?)?;
    let slot = primary
        .query_one(
            "SELECT task_kind, holder_preemptible, preempt_requested_by IS NULL\x20\
             FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work'",
            &[],
        )
        .await?;
    assert_eq!(slot.try_get::<_, String>(0)?, "ocr");
    assert!(!slot.try_get::<_, bool>(1)?);
    assert!(slot.try_get::<_, bool>(2)?);
    finish_failure(
        primary,
        &claim,
        &config,
        OcrFailureCode::CategoryUndetected,
        1,
    )
    .await?;
    assert_match_draft_status(primary, &PREEMPT, "ocr_failed").await?;

    primary
        .execute(
            "UPDATE worker_execution_slots SET preempt_requested_by = 'ocr-c2-crashed',\x20\
               preempt_requested_at = clock_timestamp() - interval '2 seconds'\x20\
             WHERE slot_key = 'shared-heavy-work' AND owner IS NULL",
            &[],
        )
        .await?;
    let stale_intent_transaction = primary.transaction().await?;
    assert!(clear_stale_preemption(&stale_intent_transaction, 1_000).await?);
    stale_intent_transaction.commit().await?;
    Ok(())
}

async fn verify_transient_retry_budget(primary: &mut Client) -> SmokeResult {
    let config = control_config("ocr-c2-transient")?;
    let claim = claimed(claim_job(primary, TRANSIENT.job_id, &config).await?)?;
    requeue_interrupted(primary, &claim, &config).await?;
    let counters = primary
        .query_one(
            "SELECT failure_retry_count, lease_recovery_count FROM ocr_jobs WHERE id=$1",
            &[&TRANSIENT.job_id],
        )
        .await?;
    assert_eq!(counters.try_get::<_, i32>(0)?, 0);
    assert_eq!(counters.try_get::<_, i32>(1)?, 0);
    let claim = claimed(claim_job(primary, TRANSIENT.job_id, &config).await?)?;
    requeue_transient(primary, &claim, &config).await?;
    let row = primary.query_one("SELECT status, available_at > clock_timestamp(), failure_retry_count, lease_recovery_count FROM ocr_jobs WHERE id=$1", &[&TRANSIENT.job_id]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, "queued");
    assert!(row.try_get::<_, bool>(1)?);
    assert_eq!(row.try_get::<_, i32>(2)?, 1);
    assert_eq!(row.try_get::<_, i32>(3)?, 0);
    primary
        .execute(
            "UPDATE ocr_jobs SET available_at=clock_timestamp() WHERE id=$1",
            &[&TRANSIENT.job_id],
        )
        .await?;
    let claim = claimed(claim_job(primary, TRANSIENT.job_id, &config).await?)?;
    requeue_transient(primary, &claim, &config).await?;
    let row = primary
        .query_one(
            "SELECT status, failure_retry_count, input_snapshot FROM ocr_jobs WHERE id=$1",
            &[&TRANSIENT.job_id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "failed");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    assert_eq!(
        row.try_get::<_, serde_json::Value>(2)?,
        persisted_payload(&TRANSIENT)
    );
    assert_match_draft_status(primary, &TRANSIENT, "ocr_failed").await?;
    Ok(())
}

async fn verify_malformed_snapshot(primary: &mut Client) -> SmokeResult {
    primary.execute("UPDATE ocr_jobs SET input_snapshot=jsonb_build_object('schemaVersion','2') WHERE id=$1", &[&MALFORMED.job_id]).await?;
    let config = control_config("ocr-c2-transient")?;
    assert!(matches!(
        claim_result(claim_job(primary, MALFORMED.job_id, &config).await?)?,
        OcrClaimResult::InvalidInput
    ));
    let row = primary
        .query_one(
            "SELECT status, failure_code, attempt_count FROM ocr_jobs WHERE id=$1",
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
    let owner = client
        .query_one(
            "SELECT owner FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work'",
            &[],
        )
        .await?
        .try_get::<_, Option<String>>(0)?;
    if owner.is_some() {
        return Err(smoke_error("shared execution slot is not quiescent").into());
    }
    client
        .execute(
            "UPDATE worker_execution_slots SET preempt_requested_by = NULL,\x20\
               preempt_requested_at = NULL WHERE slot_key = 'shared-heavy-work'",
            &[],
        )
        .await?;
    Ok(())
}

async fn insert_fixture(client: &Client, fixture: &Fixture) -> SmokeResult {
    let idempotency_hash = fixture
        .idempotency_digit
        .repeat(64 / fixture.idempotency_digit.len());
    let sha256 = "ab".repeat(32);
    client
        .execute(
            "INSERT INTO source_images (id, owner_account_id, object_key, idempotency_key_hash,\x20\
               status, media_type, byte_length, sha256_hex, width, height, storage_etag, available_at)\x20\
             VALUES ($1, 'account_ponta', $2, $3, 'AVAILABLE', 'image/png', 68, $4, 1, 1,\x20\
               'c2-smoke-etag', clock_timestamp())",
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
            "INSERT INTO match_drafts (id, created_by_account_id, created_by_member_id, status,\x20\
               total_assets_draft_id, created_at, updated_at)\x20\
             VALUES ($1, 'account_ponta', 'member_ponta', 'ocr_running', $2,\x20\
               clock_timestamp(), clock_timestamp())",
            &[&fixture.match_draft_id, &fixture.draft_id],
        )
        .await?;
    client
        .execute(
            "INSERT INTO ocr_jobs (id, draft_id, image_id, image_path, requested_screen_type,\x20\
               status, source_image_id, input_snapshot, available_at)\x20\
             VALUES ($1, $2, $3, NULL, 'total_assets', 'queued', $3, $4, clock_timestamp())",
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
    client.execute("INSERT INTO ocr_submissions (id, owner_account_id, match_draft_id, ocr_hints_json, status, admission_deadline) VALUES ($1, 'account_ponta', $2, '{}'::jsonb, 'open', clock_timestamp() + interval '10 minutes')", &[&submission_id, &fixture.match_draft_id]).await?;
    client.execute("INSERT INTO ocr_submission_members (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex, image_byte_length, status, job_id) VALUES ($1, 'total_assets', $2, $3, 68, 'registered', $4)", &[&submission_id, &idempotency_hash, &sha256, &fixture.job_id]).await?;
    Ok(())
}

async fn cleanup_database(client: &Client) -> SmokeResult {
    client
        .batch_execute(
            "UPDATE worker_execution_slots SET task_kind = NULL, owner = NULL, job_id = NULL,\x20\
               attempt_id = NULL, holder_preemptible = NULL, lease_expires_at = NULL,\x20\
               preempt_requested_by = NULL, preempt_requested_at = NULL,\x20\
               updated_at = clock_timestamp() WHERE slot_key = 'shared-heavy-work' AND (\x20\
                 owner IN ('ocr-c2-worker-a','ocr-c2-worker-b','ocr-c2-worker-success',\x20\
                   'ocr-c2-worker-success-warnings',\x20\
                   'ocr-c2-priority','ocr-c2-analysis-recovery','ocr-c2-transient',\x20\
                   'analysis-c2-holder','c2-smoke-analysis-recovery-worker')\x20\
                 OR (owner IS NULL AND preempt_requested_by IN ('ocr-c2-priority','ocr-c2-crashed'))\x20\
               );\x20\
             DELETE FROM match_drafts WHERE id IN (\x20\
               'c2-smoke-match-draft-takeover','c2-smoke-match-draft-success',\x20\
               'c2-smoke-match-draft-success-warnings',\x20\
               'c2-smoke-match-draft-preempt','c2-smoke-match-draft-malformed',\x20\
               'c2-smoke-match-draft-analysis-recovery','c2-smoke-match-draft-transient');\x20\
             DELETE FROM ocr_drafts WHERE job_id IN (\x20\
               'c2-smoke-job-takeover','c2-smoke-job-success','c2-smoke-job-success-warnings',\x20\
               'c2-smoke-job-preempt','c2-smoke-job-malformed',\x20\
               'c2-smoke-job-analysis-recovery','c2-smoke-job-transient');\x20\
             DELETE FROM ocr_submission_members WHERE submission_id IN (SELECT id FROM ocr_submissions WHERE match_draft_id LIKE 'c2-smoke-match-draft-%');\x20\
             DELETE FROM ocr_submissions WHERE match_draft_id LIKE 'c2-smoke-match-draft-%';\x20\
             DELETE FROM ocr_jobs WHERE id IN (\x20\
               'c2-smoke-job-takeover','c2-smoke-job-success','c2-smoke-job-success-warnings',\x20\
               'c2-smoke-job-preempt','c2-smoke-job-malformed',\x20\
               'c2-smoke-job-analysis-recovery','c2-smoke-job-transient');\x20\
             DELETE FROM source_images WHERE id IN (\x20\
               'c2-smoke-source-takeover','c2-smoke-source-success',\x20\
               'c2-smoke-source-success-warnings',\x20\
               'c2-smoke-source-preempt','c2-smoke-source-malformed',\x20\
               'c2-smoke-source-analysis-recovery','c2-smoke-source-transient');\x20\
             DELETE FROM series_analysis_job_attempts\x20\
               WHERE job_id = 'c2-smoke-analysis-recovery-job';\x20\
             DELETE FROM series_analysis_jobs WHERE id = 'c2-smoke-analysis-recovery-job';\x20\
             DELETE FROM game_titles WHERE id = 'c2-smoke-analysis-recovery-title';",
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
            "SELECT status FROM match_drafts WHERE id = $1",
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

fn claimed_with_analysis_wake(
    outcome: ControlOutcome<OcrClaimResult>,
) -> SmokeResult<ClaimedOcrJob> {
    if outcome.effects != crate::scheduler::PostCommitEffects::WakeJobs {
        return Err(smoke_error("expired Analysis recovery did not emit its shared wake").into());
    }
    match outcome.value {
        OcrClaimResult::Claimed(claim) => Ok(claim),
        other @ (OcrClaimResult::Busy
        | OcrClaimResult::PreemptionRequested
        | OcrClaimResult::MissingOrTerminal
        | OcrClaimResult::AlreadyRunning
        | OcrClaimResult::NotYetAvailable
        | OcrClaimResult::InvalidInput) => Err(smoke_error(format!(
            "expected OCR claim after expired Analysis recovery, got {other:?}"
        ))
        .into()),
    }
}

fn claim_result(outcome: ControlOutcome<OcrClaimResult>) -> SmokeResult<OcrClaimResult> {
    if outcome.effects == crate::scheduler::PostCommitEffects::WakeJobs {
        return Err(smoke_error("normal OCR claim unexpectedly emitted an scheduler wake").into());
    }
    Ok(outcome.value)
}

fn claimed(outcome: ControlOutcome<OcrClaimResult>) -> SmokeResult<ClaimedOcrJob> {
    match claim_result(outcome)? {
        OcrClaimResult::Claimed(claim) => Ok(claim),
        other @ (OcrClaimResult::Busy
        | OcrClaimResult::PreemptionRequested
        | OcrClaimResult::MissingOrTerminal
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
