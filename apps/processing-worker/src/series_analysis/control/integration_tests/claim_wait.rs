use super::{
    ClaimResult, ClaimedJob, Client, Duration, JOB_ID, SmokeResult, TempDir, cleanup_database,
    notifications, prepare_owned_attempt,
};
use crate::{
    execution_slot::{
        ExecutionSlotIdentity, ExecutionTaskKind, NewExecutionSlotHolder, SlotAcquisition,
        acquire_ocr, lock, release_owned,
    },
    notifications::NotificationSink,
    postgres::test_support::{CommitFault, DelayedDatabase},
    series_analysis::{
        ConsumerError,
        control::{RequeueCause, claim_job, requeue_interrupted},
        control_operation,
    },
};
use std::sync::Arc;
use tokio::{sync::Notify, time};
const OCR_OWNER: &str = "analysis-busy-smoke-ocr-worker";
const OCR_JOB: &str = "analysis-busy-smoke-ocr-job";
const OCR_ATTEMPT: &str = "analysis-busy-smoke-ocr-attempt";

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_claims_preserve_busy_deadlines_and_uncertain_commits() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    let mut secondary = crate::postgres::connect(&database_url).await?;
    cleanup_database(&client).await?;
    prepare_owned_attempt(&client).await?;
    let directory = TempDir::new()?;
    let config =
        notifications::config(&database_url, NotificationSink::default(), directory.path())?;
    reset_queued_job(&client).await?;
    let fence = occupy_slot(&mut secondary).await?;
    assert!(matches!(
        claim_job(&mut client, JOB_ID, &config).await?.value,
        ClaimResult::Busy
    ));
    assert_queued(&client).await?;
    release_ocr(&mut secondary, fence).await?;
    client.execute("UPDATE series_analysis_jobs SET available_at=clock_timestamp()+interval '1 hour' WHERE id=$1", &[&JOB_ID]).await?;
    assert!(matches!(
        claim_job(&mut client, JOB_ID, &config).await?.value,
        ClaimResult::NotYetAvailable { .. }
    ));
    assert_queued(&client).await?;
    reset_queued_job(&client).await?;
    let ClaimResult::Claimed(claim) = claim_job(&mut client, JOB_ID, &config).await?.value else {
        return Err("available job did not claim".into());
    };
    assert_owned_once(&client, &claim).await?;
    let interrupted = requeue_interrupted(
        &mut client,
        &claim,
        &config,
        RequeueCause::GracefulStop,
        &super::AttemptMetrics::default(),
    )
    .await?;
    assert_eq!(
        interrupted.effects,
        crate::scheduler::PostCommitEffects::WakeJobs
    );
    let row = client
        .query_one(
            "SELECT transient_retry_count,lease_recovery_count FROM series_analysis_jobs WHERE id=$1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(row.try_get::<_, i32>(0)?, 0);
    assert_eq!(row.try_get::<_, i32>(1)?, 0);

    for (fault, committed) in [
        (CommitFault::BeforeCommit, false),
        (CommitFault::LostReply, true),
    ] {
        reset_queued_job(&client).await?;
        let proxy = DelayedDatabase::commit_fault(&database_url, fault).await?;
        let mut uncertain = crate::postgres::connect(&proxy.url).await?;
        assert!(
            control_operation(&config, claim_job(&mut uncertain, JOB_ID, &config))
                .await
                .is_err()
        );
        drop(uncertain);
        let row = client
            .query_one(
                "SELECT status='running',attempt_count FROM series_analysis_jobs WHERE id=$1",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(row.try_get::<_, bool>(0)?, committed);
        assert_eq!(row.try_get::<_, i32>(1)?, i32::from(committed));
    }
    reset_queued_job(&client).await?;
    let committed = Arc::new(Notify::new());
    let proxy = DelayedDatabase::commit_fault(
        &database_url,
        CommitFault::HoldReply {
            committed: Arc::clone(&committed),
            release: Arc::new(Notify::new()),
        },
    )
    .await?;
    let mut uncertain = crate::postgres::connect(&proxy.url).await?;
    let (result, observed) = tokio::join!(
        control_operation(&config, claim_job(&mut uncertain, JOB_ID, &config)),
        time::timeout(
            config.control_response_timeout() + Duration::from_secs(2),
            committed.notified()
        )
    );
    drop(config);
    observed?;
    assert!(matches!(result, Err(ConsumerError::ControlTimeout)));
    drop(uncertain);
    let row = client
        .query_one(
            "SELECT status,attempt_count FROM series_analysis_jobs WHERE id=$1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "running");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    reset_queued_job(&client).await?;
    cleanup_database(&client).await?;
    Ok(())
}

async fn assert_queued(client: &Client) -> SmokeResult {
    let row = client
        .query_one(
            "SELECT status, attempt_count FROM series_analysis_jobs WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "queued");
    assert_eq!(
        row.try_get::<_, i32>(1)?,
        0,
        "busy waiting must not create a DB attempt"
    );
    Ok(())
}

async fn assert_owned_once(client: &Client, claim: &ClaimedJob) -> SmokeResult {
    let row = client.query_one("SELECT status, attempt_count, lease_fencing_token FROM series_analysis_jobs WHERE id = $1", &[&JOB_ID]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, "running");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    assert_eq!(row.try_get::<_, i64>(2)?, claim.fencing_token);
    Ok(())
}

async fn reset_queued_job(client: &Client) -> SmokeResult {
    client.execute("UPDATE worker_execution_slots SET task_kind=NULL, owner=NULL, job_id=NULL, attempt_id=NULL, holder_preemptible=NULL, lease_expires_at=NULL, preempt_requested_by=NULL, preempt_requested_at=NULL WHERE job_id IN ($1, $2)", &[&JOB_ID, &OCR_JOB]).await?;
    client
        .execute(
            "DELETE FROM series_analysis_job_attempts WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    client.execute("UPDATE series_analysis_jobs SET status='queued', started_at=NULL, finished_at=NULL, lease_owner=NULL, lease_attempt_id=NULL, lease_fencing_token=NULL, lease_expires_at=NULL, lease_validation_contract_id=NULL, attempt_count=0, available_at=clock_timestamp() WHERE id=$1", &[&JOB_ID]).await?;
    Ok(())
}

async fn occupy_slot(client: &mut Client) -> SmokeResult<i64> {
    let transaction = client.transaction().await?;
    let slot = lock(&transaction).await?;
    let acquired = acquire_ocr(
        &transaction,
        slot.fencing_token,
        NewExecutionSlotHolder {
            owner: OCR_OWNER,
            job_id: OCR_JOB,
            attempt_id: OCR_ATTEMPT,
        },
        70_000,
    )
    .await?;
    let SlotAcquisition::Acquired(fence) = acquired else {
        return Err("fixture OCR slot is occupied".into());
    };
    transaction.commit().await?;
    Ok(fence)
}

async fn release_ocr(client: &mut Client, fencing_token: i64) -> SmokeResult {
    let transaction = client.transaction().await?;
    assert!(release_owned(&transaction, ocr_identity(fencing_token)).await?);
    transaction.commit().await?;
    Ok(())
}

fn ocr_identity(fencing_token: i64) -> ExecutionSlotIdentity<'static> {
    ExecutionSlotIdentity {
        task_kind: ExecutionTaskKind::Ocr,
        owner: OCR_OWNER,
        job_id: OCR_JOB,
        attempt_id: OCR_ATTEMPT,
        fencing_token,
    }
}
