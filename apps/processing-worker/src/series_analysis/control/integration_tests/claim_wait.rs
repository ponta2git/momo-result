use std::{sync::Arc, time::Instant};

use redis::{AsyncCommands, aio::ConnectionManager, streams::StreamPendingCountReply};
use tokio::{
    sync::{Notify, watch},
    time,
};

use super::{
    ClaimResult, ClaimedJob, Client, Duration, JOB_ID, SmokeResult, TempDir, cleanup_database,
    notifications, prepare_owned_attempt,
};
use crate::{
    busy_retry::BusyRetryBudget,
    execution_slot::{
        ExecutionSlotIdentity, ExecutionTaskKind, NewExecutionSlotHolder, SlotAcquisition,
        acquire_ocr, lock, release_owned,
    },
    notifications::NotificationSink,
    outbox::PostCommitSink,
    postgres::test_support::{CommitFault, DelayedDatabase},
    series_analysis::{
        ConsumerError,
        claim_wait::claim_delivery,
        config::AnalysisConsumerConfig,
        queue::{ensure_consumer_group, read_new_delivery},
    },
};

const OCR_OWNER: &str = "analysis-busy-smoke-ocr-worker";
const OCR_JOB: &str = "analysis-busy-smoke-ocr-job";
const OCR_ATTEMPT: &str = "analysis-busy-smoke-ocr-attempt";

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL and ANALYSIS_OUTBOX_SMOKE_REDIS_URL"]
async fn real_postgres_and_redis_busy_rechecks_preserve_pending_and_owned_claims() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let redis_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_REDIS_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    let mut secondary = crate::postgres::connect(&database_url).await?;
    cleanup_database(&client).await?;
    prepare_owned_attempt(&client).await?;
    let directory = TempDir::new()?;
    let mut config =
        notifications::config(&database_url, NotificationSink::default(), directory.path())?;
    config.lease_duration = Duration::from_secs(70);
    config.redis_stream = format!("momo:analysis-busy-smoke:{}", std::process::id());
    config.redis_group = String::from("analysis-busy-smoke");
    let redis_client = redis::Client::open(redis_url)?;
    let mut redis = crate::stream_connection::connect(&redis_client).await?;
    let _: usize = redis.del(&config.redis_stream).await?;
    ensure_consumer_group(&mut redis, &config).await?;
    let (sink, _wake) = PostCommitSink::channel();
    let (_shutdown_sender, mut shutdown) = watch::channel(false);

    reset_queued_job(&client).await?;
    let holder = occupy_slot(&mut secondary).await?;
    let (first_message, received_at) = receive(&mut redis, &config).await?;
    let mut budget = BusyRetryBudget::new(config.lease_duration);
    let result = time::timeout(
        Duration::from_secs(15),
        Box::pin(claim_delivery(
            &mut client,
            JOB_ID,
            &config,
            &sink,
            received_at + config.lease_duration,
            &mut budget,
            &mut shutdown,
        )),
    )
    .await??;
    assert!(matches!(result, Some(ClaimResult::Busy)));
    assert!(
        !budget.available(time::Instant::now()),
        "busy checks exhaust the shared budget"
    );
    assert_queued(&client).await?;
    assert_pending_once(&mut redis, &config, &first_message).await?;

    // A different received entry cannot reset the consumer-wide budget.
    let (next_message, next_received_at) = receive(&mut redis, &config).await?;
    assert!(matches!(
        Box::pin(claim_delivery(
            &mut client,
            JOB_ID,
            &config,
            &sink,
            next_received_at + config.lease_duration,
            &mut budget,
            &mut shutdown,
        ))
        .await?,
        Some(ClaimResult::Busy)
    ));
    assert_queued(&client).await?;
    assert_pending_once(&mut redis, &config, &next_message).await?;
    release_ocr(&mut secondary, holder).await?;

    // With an available budget, the same pending entry starts before the old Redis idle threshold.
    let holder = occupy_slot(&mut secondary).await?;
    let backend_pid = read_backend_pid(&client).await?;
    let mut budget = BusyRetryBudget::new(config.lease_duration);
    let (result, released) = tokio::join!(
        claim_delivery(
            &mut client,
            JOB_ID,
            &config,
            &sink,
            next_received_at + config.lease_duration,
            &mut budget,
            &mut shutdown,
        ),
        release_after_initial_busy(&mut secondary, backend_pid, holder),
    );
    released?;
    let claim = claimed(result?)?;
    assert!(next_received_at.elapsed() < config.lease_duration);
    assert_owned_once(&client, &claim).await?;
    assert_pending_once(&mut redis, &config, &next_message).await?;

    reset_queued_job(&client).await?;
    let holder = occupy_slot(&mut secondary).await?;
    let mut budget = BusyRetryBudget::new(config.lease_duration);
    let expired_start_deadline = Instant::now();
    assert!(matches!(
        Box::pin(claim_delivery(
            &mut client,
            JOB_ID,
            &config,
            &sink,
            expired_start_deadline,
            &mut budget,
            &mut shutdown,
        ))
        .await?,
        Some(ClaimResult::Busy)
    ));
    assert_queued(&client).await?;
    assert!(
        budget.available(time::Instant::now()),
        "ordinary recovery wins without spending the budget"
    );

    client.execute(
        "UPDATE series_analysis_jobs SET available_at = clock_timestamp() + interval '1 minute' WHERE id = $1",
        &[&JOB_ID],
    ).await?;
    let backend_pid = read_backend_pid(&client).await?;
    let (result, released) = tokio::join!(
        claim_delivery(
            &mut client,
            JOB_ID,
            &config,
            &sink,
            Instant::now() + config.lease_duration,
            &mut budget,
            &mut shutdown,
        ),
        release_after_initial_busy(&mut secondary, backend_pid, holder),
    );
    released?;
    assert!(matches!(result?, Some(ClaimResult::NotYetAvailable { .. })));
    assert_queued(&client).await?;
    assert_pending_once(&mut redis, &config, &next_message).await?;

    Box::pin(verify_shutdown_keeps_a_completed_claim(
        &mut client,
        &mut secondary,
        &config,
        &sink,
    ))
    .await?;
    assert_pending_once(&mut redis, &config, &next_message).await?;

    for (fault, committed) in [
        (CommitFault::BeforeCommit, false),
        (CommitFault::LostReply, true),
    ] {
        reset_queued_job(&client).await?;
        let holder = occupy_slot(&mut secondary).await?;
        let proxy = DelayedDatabase::commit_fault(&database_url, fault).await?;
        let mut uncertain = crate::postgres::connect(&proxy.url).await?;
        let backend_pid = read_backend_pid(&uncertain).await?;
        let mut budget = BusyRetryBudget::new(config.lease_duration);
        let (result, released) = tokio::join!(
            claim_delivery(
                &mut uncertain,
                JOB_ID,
                &config,
                &sink,
                Instant::now() + config.lease_duration,
                &mut budget,
                &mut shutdown,
            ),
            release_after_initial_busy(&mut secondary, backend_pid, holder),
        );
        released?;
        assert!(matches!(result, Err(ConsumerError::Control(_))));
        let row = client
            .query_one(
                "SELECT status = 'running', attempt_count FROM series_analysis_jobs WHERE id = $1",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(
            row.try_get::<_, bool>(0)?,
            committed,
            "commit uncertainty must not be reclassified as Busy"
        );
        assert_eq!(row.try_get::<_, i32>(1)?, i32::from(committed));
        assert_pending_once(&mut redis, &config, &next_message).await?;
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
    // Keep the normal control bound so container round trips can reach COMMIT. The signal below
    // proves the tested timeout happens after the proxy has received its successful reply.
    let observation_timeout = config.control_response_timeout() + Duration::from_secs(2);
    let mut budget = BusyRetryBudget::new(config.lease_duration);
    let (result, held) = tokio::join!(
        time::timeout(
            observation_timeout,
            Box::pin(claim_delivery(
                &mut uncertain,
                JOB_ID,
                &config,
                &sink,
                Instant::now() + config.lease_duration,
                &mut budget,
                &mut shutdown,
            )),
        ),
        time::timeout(observation_timeout, committed.notified()),
    );
    held.map_err(|_elapsed| "fixture did not observe the committed claim")?;
    assert!(
        matches!(result, Ok(Err(ConsumerError::ControlTimeout))),
        "an unanswered COMMIT must fail within the operation bound"
    );
    assert!(matches!(
        time::timeout(
            observation_timeout,
            crate::series_analysis::finish_consumer(
                &uncertain,
                &config,
                Err(ConsumerError::ControlTimeout),
            ),
        )
        .await?,
        Err(ConsumerError::ControlTimeout)
    ));
    drop(uncertain);
    let row = client
        .query_one(
            "SELECT status, attempt_count FROM series_analysis_jobs WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "running");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    assert_pending_once(&mut redis, &config, &next_message).await?;

    reset_queued_job(&client).await?;
    cleanup_database(&client).await?;
    let _: usize = redis.del(&config.redis_stream).await?;
    drop(config);
    Ok(())
}

async fn verify_shutdown_keeps_a_completed_claim(
    client: &mut Client,
    secondary: &mut Client,
    config: &AnalysisConsumerConfig,
    sink: &PostCommitSink,
) -> SmokeResult {
    reset_queued_job(client).await?;
    let holder = occupy_slot(secondary).await?;
    let mut budget = BusyRetryBudget::new(config.lease_duration);
    let (shutdown_sender, mut shutdown) = watch::channel(true);
    assert!(
        Box::pin(claim_delivery(
            client,
            JOB_ID,
            config,
            sink,
            Instant::now() + config.lease_duration,
            &mut budget,
            &mut shutdown,
        ))
        .await?
        .is_none()
    );
    assert_queued(client).await?;
    shutdown_sender.send(false)?;

    let backend_pid = read_backend_pid(client).await?;
    let unblock = async {
        wait_for_initial_busy(secondary, backend_pid).await?;
        let held = secondary.transaction().await?;
        // Free the slot without committing yet: the next claim must start and block on this row.
        assert!(release_owned(&held, ocr_identity(holder)).await?);
        let deadline = time::Instant::now() + Duration::from_secs(5);
        loop {
            let waiting: bool = held.query_one(
                "SELECT COALESCE(wait_event_type = 'Lock', false) FROM pg_stat_activity WHERE pid = $1",
                &[&backend_pid],
            ).await?.try_get(0)?;
            if waiting {
                shutdown_sender.send(true)?;
                held.commit().await?;
                return Ok::<(), Box<dyn std::error::Error + Send + Sync>>(());
            }
            if time::Instant::now() >= deadline {
                return Err("busy recheck did not reach the held execution-slot lock".into());
            }
            time::sleep(Duration::from_millis(10)).await;
        }
    };
    let (result, released) = tokio::join!(
        claim_delivery(
            client,
            JOB_ID,
            config,
            sink,
            Instant::now() + config.lease_duration,
            &mut budget,
            &mut shutdown,
        ),
        unblock,
    );
    released?;
    let claim = claimed(result?)?;
    assert_owned_once(client, &claim).await?;
    assert!(
        *shutdown.borrow(),
        "the claim must complete after shutdown arrives"
    );
    Ok(())
}

async fn receive(
    redis: &mut ConnectionManager,
    config: &AnalysisConsumerConfig,
) -> SmokeResult<(String, Instant)> {
    let message_id: String = redis
        .xadd(
            &config.redis_stream,
            "*",
            &[("schemaVersion", "1"), ("jobId", JOB_ID)],
        )
        .await?;
    let delivery = read_new_delivery(redis, config, Duration::ZERO)
        .await?
        .ok_or("analysis delivery missing")?;
    assert_eq!(delivery.id, message_id);
    Ok((message_id, Instant::now()))
}

async fn assert_pending_once(
    redis: &mut ConnectionManager,
    config: &AnalysisConsumerConfig,
    message_id: &str,
) -> SmokeResult {
    let pending: StreamPendingCountReply = redis
        .xpending_count(
            &config.redis_stream,
            &config.redis_group,
            message_id,
            message_id,
            1,
        )
        .await?;
    let entry = pending
        .ids
        .first()
        .ok_or("analysis delivery was acknowledged before completion")?;
    assert_eq!(entry.id, message_id);
    assert_eq!(
        entry.times_delivered, 1,
        "local DB retries must not reclaim Redis deliveries"
    );
    Ok(())
}

async fn read_backend_pid(client: &Client) -> SmokeResult<i32> {
    Ok(client
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get(0)?)
}

async fn wait_for_initial_busy(observer: &Client, backend_pid: i32) -> SmokeResult {
    let deadline = time::Instant::now() + Duration::from_secs(5);
    loop {
        let waiting: bool = observer
            .query_one(
                "SELECT state = 'idle' AND query = 'ROLLBACK' FROM pg_stat_activity WHERE pid = $1",
                &[&backend_pid],
            )
            .await?
            .try_get(0)?;
        if waiting {
            return Ok(());
        }
        if time::Instant::now() >= deadline {
            return Err("the initial claim did not finish while OCR held the slot".into());
        }
        time::sleep(Duration::from_millis(10)).await;
    }
}

async fn release_after_initial_busy(
    observer: &mut Client,
    backend_pid: i32,
    fencing_token: i64,
) -> SmokeResult {
    wait_for_initial_busy(observer, backend_pid).await?;
    release_ocr(observer, fencing_token).await
}

fn claimed(result: Option<ClaimResult>) -> SmokeResult<ClaimedJob> {
    match result {
        Some(ClaimResult::Claimed(claim)) => Ok(claim),
        _ => Err("the locally pending delivery was not claimed".into()),
    }
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
