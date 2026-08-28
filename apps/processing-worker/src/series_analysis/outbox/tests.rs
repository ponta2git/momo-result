use std::error::Error;

use redis::{AsyncCommands, streams::StreamRangeReply};

use super::*;

type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

const TITLE_ID: &str = "analysis-outbox-smoke-title";
const JOB_ID: &str = "analysis-outbox-smoke-job";
const OUTBOX_ID: &str = "analysis-outbox-smoke-delivery";
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
            .map(|attempt| delivery_retry_delay(attempt, Duration::from_mins(1)))
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
        SeriesAnalysisOutboxConfig::new(
            String::new(),
            0,
            Duration::ZERO,
            Duration::ZERO,
            Duration::ZERO,
        ),
        Err(SeriesAnalysisOutboxError::InvalidConfiguration)
    ));
    assert!(
        SeriesAnalysisOutboxConfig::new(
            String::from("analysis-stream"),
            10,
            Duration::from_secs(30),
            Duration::from_mins(1),
            Duration::from_mins(5),
        )
        .is_ok()
    );
    assert!(SeriesAnalysisOutboxConfig::for_runtime(String::from("analysis-stream")).is_ok());
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
        Duration::from_mins(1),
        Duration::from_mins(5),
    )?;
    let redis = redis_client.get_connection_manager().await?;
    let mut driver = SeriesAnalysisOutboxDriver::new(database, redis, config);

    let _: () = observer.set(STREAM, "force-wrong-type").await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let retry_state = driver
        .database
        .query_one(
            "SELECT status, attempt_count, next_attempt_at > last_attempt_at AS delayed FROM series_analysis_queue_outbox WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    assert_eq!(retry_state.try_get::<_, String>("status")?, "pending");
    assert_eq!(retry_state.try_get::<_, i32>("attempt_count")?, 1);
    assert!(retry_state.try_get::<_, bool>("delayed")?);

    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_queue_outbox\x20\
             SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
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

    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
        .await?;
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
