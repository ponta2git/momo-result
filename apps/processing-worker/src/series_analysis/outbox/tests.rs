use std::error::Error;

use redis::{AsyncCommands, aio::ConnectionManager, streams::StreamRangeReply};

use super::*;

type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

const TITLE_ID: &str = "analysis-outbox-smoke-title";
const JOB_ID: &str = "analysis-outbox-smoke-job";
const OUTBOX_ID: &str = "analysis-outbox-smoke-delivery";
const HISTORICAL_OUTBOX_ID: &str = "analysis-outbox-smoke-historical-delivery";
const STREAM: &str = "analysis-outbox-smoke-stream";

#[test]
fn queue_payload_and_retry_backoff_match_the_delivery_contract() {
    assert_eq!(
        queue_fields("analysis-job-1"),
        [
            ("schemaVersion", String::from("1")),
            ("jobId", String::from("analysis-job-1")),
        ]
    );
    assert_eq!(
        (0..=2)
            .map(delivery_retry_delay)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string()),
        Ok(vec![
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
        ])
    );
}

#[test]
fn configuration_rejects_unbounded_or_immediate_work() {
    assert!(matches!(
        SeriesAnalysisOutboxConfig::new(String::new(), 0, Duration::ZERO, Duration::ZERO,),
        Err(SeriesAnalysisOutboxError::InvalidConfiguration)
    ));
    assert!(
        SeriesAnalysisOutboxConfig::new(
            String::from("analysis-stream"),
            10,
            Duration::from_secs(30),
            Duration::from_mins(5),
        )
        .is_ok()
    );
    assert!(SeriesAnalysisOutboxConfig::for_runtime(String::from("analysis-stream")).is_ok());
    assert!(matches!(
        SeriesAnalysisOutboxConfig::new(
            String::from("analysis-stream"),
            10,
            Duration::MAX,
            Duration::from_mins(5),
        ),
        Err(SeriesAnalysisOutboxError::DurationBound(_))
    ));
}

#[test]
fn no_progress_due_work_uses_a_bounded_lock_contention_retry() {
    assert_eq!(
        bounded_idle_delay(Duration::ZERO),
        LOCK_CONTENTION_RETRY_DELAY
    );
    assert_eq!(
        bounded_idle_delay(Duration::from_secs(9)),
        Duration::from_secs(9)
    );
    assert_eq!(None.map(bounded_idle_delay), None);
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_OUTBOX_SMOKE_DATABASE_URL and ANALYSIS_OUTBOX_SMOKE_REDIS_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "the isolated database and Redis scenario keeps durable boundaries visible"
)]
async fn real_postgres_and_redis_preserve_claim_and_payload_contract() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_DATABASE_URL")?;
    let redis_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_REDIS_URL")?;
    let database = crate::postgres::connect(&database_url).await?;
    let redis_client = redis::Client::open(redis_url)?;
    let mut observer = redis_client.get_connection_manager().await?;
    let _: usize = observer.del(STREAM).await?;
    prepare_outbox(&database).await?;

    let config = SeriesAnalysisOutboxConfig::new(
        String::from(STREAM),
        10,
        Duration::from_secs(30),
        Duration::from_mins(5),
    )?;
    let redis = redis_client.get_connection_manager().await?;
    let mut driver = SeriesAnalysisOutboxDriver::new(database, redis, config);

    assert_publish_retry_follows_job_availability(&mut driver, &mut observer).await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let state = driver
        .database
        .query_one(
            "SELECT status, redis_message_id FROM series_analysis_queue_outbox WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    let status: String = state.try_get("status")?;
    let message_id: Option<String> = state.try_get("redis_message_id")?;
    assert_eq!(status, "delivered");

    let entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
    let entry = entries.ids.first().ok_or("Redis stream entry is missing")?;
    assert_eq!(message_id.as_deref(), Some(entry.id.as_str()));
    assert_eq!(entry.get::<String>("schemaVersion").as_deref(), Some("1"));
    assert_eq!(entry.get::<String>("jobId").as_deref(), Some(JOB_ID));

    let idle = driver.drain_once().await?;
    assert_ne!(idle, DrainBatch::progress());
    assert_ne!(idle, DrainBatch::idle(None));

    driver
        .database
        .execute(
            "UPDATE series_analysis_queue_outbox SET delivered_at = now() - interval '6 minutes' WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let entries_after_redelivery: StreamRangeReply = observer.xrange_all(STREAM).await?;
    assert_eq!(entries_after_redelivery.ids.len(), 2);

    assert_future_job_defers_stale_deliveries(&mut driver, &mut observer).await?;
    assert_terminal_retry_uses_shared_mutation_lock_order(&mut driver, &database_url).await?;
    assert_recent_delivery_preserves_queued_job(&mut driver).await?;
    assert_locked_due_delivery_uses_bounded_retry(&mut driver, &database_url).await?;

    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
        .await?;
    Ok(())
}

async fn assert_locked_due_delivery_uses_bounded_retry(
    driver: &mut SeriesAnalysisOutboxDriver,
    database_url: &str,
) -> SmokeResult {
    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET status = 'queued', available_at = clock_timestamp(),\
             lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\
             lease_expires_at = NULL WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "INSERT INTO series_analysis_queue_outbox\
             (id, job_id, dedupe_key, status, next_attempt_at)\
             VALUES ($1, $2, $1, 'pending', clock_timestamp())",
            &[&OUTBOX_ID, &JOB_ID],
        )
        .await?;
    let mut lock_database = crate::postgres::connect(database_url).await?;
    let lock = lock_database.transaction().await?;
    lock.query_one(
        "SELECT id FROM series_analysis_queue_outbox WHERE id = $1 FOR UPDATE",
        &[&OUTBOX_ID],
    )
    .await?;

    let before = Instant::now();
    let batch = tokio::time::timeout(Duration::from_secs(1), driver.drain_once()).await??;
    let deadline = batch
        .idle_deadline()
        .ok_or("locked due delivery did not yield a bounded idle deadline")?;
    assert!(
        deadline >= before + LOCK_CONTENTION_RETRY_DELAY,
        "locked due delivery retried before the contention floor"
    );
    lock.rollback().await?;
    Ok(())
}

async fn assert_terminal_retry_uses_shared_mutation_lock_order(
    driver: &mut SeriesAnalysisOutboxDriver,
    database_url: &str,
) -> SmokeResult {
    let claim = prepare_terminal_retry_claim(driver, Duration::from_mins(6)).await?;
    let mut lifecycle_database = crate::postgres::connect(database_url).await?;
    let lifecycle = lifecycle_database.transaction().await?;
    let lifecycle_pid = lifecycle
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get::<_, i32>(0)?;
    lifecycle
        .query_one(
            "SELECT slot_key FROM worker_execution_slots\x20\
             WHERE slot_key = 'shared-heavy-work' FOR UPDATE",
            &[],
        )
        .await?;

    let retry_database = crate::postgres::connect(database_url).await?;
    let retry_pid = retry_database
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get::<_, i32>(0)?;
    let mut retry_driver = SeriesAnalysisOutboxDriver::new(
        retry_database,
        driver.redis.clone(),
        driver.config.clone(),
    );
    let retry = tokio::spawn(async move {
        retry_driver
            .release_for_retry(&claim, Duration::from_secs(2))
            .await
    });

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let blocked_by_lifecycle = lifecycle
                .query_one(
                    "SELECT $1::int = ANY(pg_blocking_pids($2::int))",
                    &[&lifecycle_pid, &retry_pid],
                )
                .await?
                .try_get::<_, bool>(0)?;
            if blocked_by_lifecycle {
                return Ok::<(), tokio_postgres::Error>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;

    // The terminal retry must wait at the standard slot prefix. Its lifecycle peer can therefore
    // continue through title -> job -> outbox without a reverse-order lock or deadlock.
    lifecycle
        .query_one(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE NOWAIT",
            &[&TITLE_ID],
        )
        .await?;
    lifecycle
        .query_one(
            "SELECT id FROM series_analysis_jobs WHERE id = $1 FOR UPDATE NOWAIT",
            &[&JOB_ID],
        )
        .await?;
    lifecycle
        .query_one(
            "SELECT id FROM series_analysis_queue_outbox WHERE id = $1 FOR UPDATE NOWAIT",
            &[&OUTBOX_ID],
        )
        .await?;
    lifecycle.commit().await?;
    assert!(tokio::time::timeout(Duration::from_secs(2), retry).await???);

    let state = driver
        .database
        .query_one(
            "SELECT j.status AS job_status, q.status AS outbox_status,\x20\
                    historical.status AS historical_status\x20\
             FROM series_analysis_jobs j\x20\
             JOIN series_analysis_queue_outbox q ON q.job_id = j.id\x20\
             JOIN series_analysis_queue_outbox historical ON historical.job_id = j.id\x20\
             WHERE j.id = $1 AND q.id = $2 AND historical.id = $3",
            &[&JOB_ID, &OUTBOX_ID, &HISTORICAL_OUTBOX_ID],
        )
        .await?;
    assert_eq!(state.try_get::<_, String>("job_status")?, "failed");
    assert_eq!(state.try_get::<_, String>("outbox_status")?, "failed");
    assert_eq!(
        state.try_get::<_, String>("historical_status")?,
        "delivered"
    );
    assert_eq!(driver.reconcile_queued().await?, 0);
    Ok(())
}

async fn assert_recent_delivery_preserves_queued_job(
    driver: &mut SeriesAnalysisOutboxDriver,
) -> SmokeResult {
    let claim = prepare_terminal_retry_claim(driver, Duration::ZERO).await?;
    assert!(
        driver
            .release_for_retry(&claim, Duration::from_secs(2))
            .await?
    );
    let state = driver
        .database
        .query_one(
            "SELECT j.status AS job_status, q.status AS outbox_status\x20\
             FROM series_analysis_jobs j\x20\
             JOIN series_analysis_queue_outbox q ON q.job_id = j.id\x20\
             WHERE j.id = $1 AND q.id = $2",
            &[&JOB_ID, &OUTBOX_ID],
        )
        .await?;
    assert_eq!(state.try_get::<_, String>("job_status")?, "queued");
    assert_eq!(state.try_get::<_, String>("outbox_status")?, "failed");
    assert_eq!(driver.reconcile_queued().await?, 0);
    Ok(())
}

async fn prepare_terminal_retry_claim(
    driver: &mut SeriesAnalysisOutboxDriver,
    delivered_age: Duration,
) -> SmokeResult<OutboxClaim> {
    let delivered_age_milliseconds = postgres_duration_milliseconds(delivered_age)?;
    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET status = 'queued', available_at = clock_timestamp(),\x20\
               finished_at = NULL, safe_failure_code = NULL WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            r"
            INSERT INTO series_analysis_queue_outbox (
              id, job_id, dedupe_key, status, attempt_count, next_attempt_at,
              delivered_at, redis_message_id
            ) VALUES
              (
                $1, $2, $3, 'pending', 2,
                clock_timestamp() - interval '1 second', NULL, NULL
              ),
              (
                $4, $2, $5, 'delivered', 0,
                clock_timestamp() - ($6::bigint * interval '1 millisecond'),
                clock_timestamp() - ($6::bigint * interval '1 millisecond'),
                'historical-redis-message'
              )
            ",
            &[
                &OUTBOX_ID,
                &JOB_ID,
                &"analysis-outbox-lock-order",
                &HISTORICAL_OUTBOX_ID,
                &"analysis-outbox-historical-delivery",
                &delivered_age_milliseconds,
            ],
        )
        .await?;
    driver
        .claim_due()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "lock-order outbox delivery was not claimed".into())
}

async fn assert_publish_retry_follows_job_availability(
    driver: &mut SeriesAnalysisOutboxDriver,
    observer: &mut ConnectionManager,
) -> SmokeResult {
    let _: () = observer.set(STREAM, "force-wrong-type").await?;
    let claims = driver.claim_due().await?;
    assert_eq!(claims.len(), 1);
    let claim = claims
        .first()
        .ok_or("due Analysis outbox delivery was not claimed")?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               available_at = clock_timestamp() + interval '1 hour' WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(driver.publish_claim(claim).await?, PublishResult::Retried);
    let retry_state = driver
        .database
        .query_one(
            "SELECT q.status, q.attempt_count,\x20\
               q.next_attempt_at > q.last_attempt_at AS delayed,\x20\
               q.next_attempt_at = j.available_at AS follows_job_availability\x20\
             FROM series_analysis_queue_outbox q\x20\
             JOIN series_analysis_jobs j ON j.id = q.job_id WHERE q.id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    assert_eq!(retry_state.try_get::<_, String>("status")?, "pending");
    assert_eq!(retry_state.try_get::<_, i32>("attempt_count")?, 1);
    assert!(retry_state.try_get::<_, bool>("delayed")?);
    assert!(retry_state.try_get::<_, bool>("follows_job_availability")?);

    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_queue_outbox\x20\
             SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    Ok(())
}

async fn assert_future_job_defers_stale_deliveries(
    driver: &mut SeriesAnalysisOutboxDriver,
    observer: &mut ConnectionManager,
) -> SmokeResult {
    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               available_at = clock_timestamp() + interval '1 hour' WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            r"
            INSERT INTO series_analysis_queue_outbox (
              id, job_id, dedupe_key, status, next_attempt_at,
              last_attempt_at, claim_expires_at
            ) VALUES
              (
                'analysis-outbox-smoke-stale-pending', $1,
                'analysis-outbox-smoke-stale-pending', 'pending',
                clock_timestamp() - interval '1 minute', NULL, NULL
              ),
              (
                'analysis-outbox-smoke-stale-in-flight', $1,
                'analysis-outbox-smoke-stale-in-flight', 'in_flight',
                clock_timestamp() - interval '2 minutes',
                clock_timestamp() - interval '2 minutes',
                clock_timestamp() - interval '1 minute'
              )
            ",
            &[&JOB_ID],
        )
        .await?;
    let future_delay = driver
        .next_delay()
        .await?
        .ok_or("future Analysis job has no durable wake deadline")?;
    assert!(future_delay > Duration::from_mins(50));
    let future_idle = driver.drain_once().await?;
    assert_ne!(future_idle, DrainBatch::progress());
    assert_ne!(future_idle, DrainBatch::idle(None));
    let future_entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
    assert!(future_entries.ids.is_empty());
    let future_outbox_count = driver
        .database
        .query_one(
            "SELECT COUNT(*)::bigint FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?
        .try_get::<_, i64>(0)?;
    assert_eq!(future_outbox_count, 2);

    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let due_entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
    assert_eq!(due_entries.ids.len(), 1);
    Ok(())
}

async fn prepare_outbox(database: &Client) -> SmokeResult {
    database
        .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
        .await?;
    database
        .execute(
            "INSERT INTO game_titles (id, name, layout_family, display_order) VALUES ($1, $2, $3, $4)",
            &[&TITLE_ID, &"Analysis outbox smoke", &"momotetsu2", &9_999_i32],
        )
        .await?;
    database
        .execute(
            r"
            INSERT INTO series_analysis_jobs (
              id, game_title_id, input_revision, algorithm_version,
              artifact_schema_version, status, trigger, requested_at, available_at
            ) VALUES ($1, $2, 1, 'series-analysis-v1', 1, 'queued', 'manual', now(), now())
            ",
            &[&JOB_ID, &TITLE_ID],
        )
        .await?;
    database
        .execute(
            r"
            INSERT INTO series_analysis_queue_outbox (
              id, job_id, dedupe_key, next_attempt_at, created_at, updated_at
            ) VALUES (
              $1, $2, $3, clock_timestamp() - interval '1 second',
              clock_timestamp(), clock_timestamp()
            )
            ",
            &[&OUTBOX_ID, &JOB_ID, &"analysis-outbox-smoke-dedupe"],
        )
        .await?;
    Ok(())
}
