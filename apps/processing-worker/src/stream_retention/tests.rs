use std::{error::Error, time::Duration};

use redis::{
    AsyncCommands,
    streams::{StreamPendingReply, StreamRangeReply, StreamReadOptions, StreamReadReply},
};

use super::*;
use crate::ocr::queue::{OcrQueueConfig, PendingRecoveryCursor, recover_cold_page};

type TestResult = Result<(), Box<dyn Error>>;

#[tokio::test]
#[ignore = "requires an isolated STREAM_WAIT_SMOKE_REDIS_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "integration assertions report protocol violations while dependency failures use Result"
)]
async fn real_redis_trim_preserves_pending_unread_and_other_groups() -> TestResult {
    let client = redis::Client::open(std::env::var("STREAM_WAIT_SMOKE_REDIS_URL")?)?;
    let mut redis = crate::stream_connection::connect(&client).await?;
    let stream = format!("momo:stream-retention-smoke:{}", std::process::id());
    seed_deliveries(&mut redis, &stream, 2505, 2503).await?;
    let acknowledged = (1..=2503)
        .filter(|id| ![2001, 2301].contains(id))
        .map(|id| format!("{id}-0"))
        .collect::<Vec<_>>();
    let _: usize = redis.xack(&stream, "owner", &acknowledged).await?;
    assert_eq!(
        trim_acknowledged_prefix(&mut redis, &stream, "other").await?,
        0
    );
    let _: () = redis.xgroup_create(&stream, "peer", "0").await?;
    assert_eq!(
        trim_acknowledged_prefix(&mut redis, &stream, "owner").await?,
        0,
        "another group's unread entries must retain the shared history"
    );
    let _: usize = redis.xgroup_destroy(&stream, "peer").await?;

    let trimmed = trim_acknowledged_prefix(&mut redis, &stream, "owner").await?;
    assert!(
        trimmed > 0 && trimmed <= MAXIMUM_TRIM_ENTRIES,
        "one cold sweep must reclaim only bounded acknowledged history"
    );
    assert_eq!(redis.xlen::<_, usize>(&stream).await?, 2505 - trimmed);
    let second_trim = trim_acknowledged_prefix(&mut redis, &stream, "owner").await?;
    assert!(second_trim <= MAXIMUM_TRIM_ENTRIES);
    let pending: StreamPendingReply = redis.xpending(&stream, "owner").await?;
    assert_eq!(pending.count(), 2);
    let retained: StreamRangeReply = redis.xrange_all(&stream).await?;
    for id in ["2001-0", "2301-0", "2503-0", "2504-0", "2505-0"] {
        assert!(
            retained.ids.iter().any(|entry| entry.id == id),
            "pending, last-delivered and unread entries must remain available: {id}"
        );
    }
    let _: usize = redis.xack(&stream, "owner", &["2001-0", "2301-0"]).await?;
    let final_trim = trim_acknowledged_prefix(&mut redis, &stream, "owner").await?;
    assert!(final_trim > 0 && final_trim <= MAXIMUM_TRIM_ENTRIES);
    let remaining: StreamRangeReply = redis.xrange_all(&stream).await?;
    for id in ["2503-0", "2504-0", "2505-0"] {
        assert!(
            remaining.ids.iter().any(|entry| entry.id == id),
            "the group cursor and unread entries must survive an empty PEL: {id}"
        );
    }
    let _: usize = redis.del(&stream).await?;
    verify_trim_runs_once_per_cold_sweep(&mut redis, &stream).await
}

async fn seed_deliveries(
    redis: &mut ConnectionManager,
    stream: &str,
    entries: usize,
    delivered: usize,
) -> TestResult {
    let mut pipeline = redis::pipe();
    for id in 1..=entries {
        pipeline
            .cmd("XADD")
            .arg(stream)
            .arg(format!("{id}-0"))
            .arg("fixture")
            .arg("payload")
            .ignore();
    }
    pipeline.query_async::<()>(redis).await?;
    let _: () = redis.xgroup_create(stream, "owner", "0").await?;
    let options = StreamReadOptions::default()
        .group("owner", "consumer")
        .count(delivered);
    let _deliveries: StreamReadReply = redis.xread_options(&[stream], &[">"], &options).await?;
    Ok(())
}

async fn verify_trim_runs_once_per_cold_sweep(
    redis: &mut ConnectionManager,
    stream: &str,
) -> TestResult {
    seed_deliveries(redis, stream, 19, 19).await?;
    let queue = OcrQueueConfig::new(
        String::from(stream),
        String::from("owner"),
        format!("{stream}:dead"),
        String::from("consumer"),
        Duration::from_hours(1),
        Duration::from_secs(1),
        2,
        10,
    )?;
    let mut cursor = PendingRecoveryCursor::start();
    let before = eval_calls(redis).await?;
    assert!(
        !recover_cold_page(redis, &queue, &mut cursor)
            .await?
            .complete
    );
    assert!(
        recover_cold_page(redis, &queue, &mut cursor)
            .await?
            .complete
    );
    assert_eq!(
        eval_calls(redis).await?,
        before + 1,
        "retention must run only on the first recovery page"
    );
    let _: usize = redis.del(stream).await?;
    Ok(())
}

async fn eval_calls(redis: &mut ConnectionManager) -> Result<u64, Box<dyn Error>> {
    let info: String = redis::cmd("INFO")
        .arg("commandstats")
        .query_async(redis)
        .await?;
    Ok(info
        .lines()
        .find_map(|line| line.strip_prefix("cmdstat_eval:calls="))
        .and_then(|value| value.split(',').next())
        .map(str::parse)
        .transpose()?
        .unwrap_or(0))
}
