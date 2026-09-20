//! Bounded Redis connections for blocking delivery reads and nonblocking outbox writes.

use std::time::Duration;

use redis::{
    Client, RedisError,
    aio::{ConnectionManager, ConnectionManagerConfig},
};

use crate::pel_recovery::MAXIMUM_READ_BLOCK;

pub(crate) const RESPONSE_TIMEOUT: Duration =
    MAXIMUM_READ_BLOCK.saturating_add(Duration::from_secs(1));
pub(crate) const PUBLISH_RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) async fn connect(client: &Client) -> Result<ConnectionManager, RedisError> {
    client
        .get_connection_manager_with_config(config(RESPONSE_TIMEOUT))
        .await
}

/// The coordinator owns retry timing. A stalled append must release its durable claim for
/// recovery instead of inheriting the driver's unbounded default response wait.
pub(crate) async fn connect_publisher(client: &Client) -> Result<ConnectionManager, RedisError> {
    client
        .get_connection_manager_with_config(config(PUBLISH_RESPONSE_TIMEOUT))
        .await
}

fn config(response_timeout: Duration) -> ConnectionManagerConfig {
    ConnectionManagerConfig::default()
        .set_connection_timeout(CONNECT_TIMEOUT)
        .set_response_timeout(response_timeout)
        // Consumers propagate dependency errors and drop their private connection. The process
        // supervisor/coordinator owns retries; connection retries must not extend shutdown budgets.
        .set_number_of_retries(0)
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    #[tokio::test]
    #[ignore = "requires an isolated STREAM_WAIT_SMOKE_REDIS_URL; pauses that Redis server"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "integration assertions report protocol violations while dependency failures use Result"
    )]
    async fn real_redis_stall_times_out_without_reusing_the_uncertain_connection()
    -> Result<(), Box<dyn std::error::Error>> {
        let client = Client::open(std::env::var("STREAM_WAIT_SMOKE_REDIS_URL")?)?;
        let mut consumer = connect(&client).await?;
        let mut observer = client.get_connection_manager().await?;
        let consumer_id: u64 = redis::cmd("CLIENT")
            .arg("ID")
            .query_async(&mut consumer)
            .await?;
        let pause = RESPONSE_TIMEOUT + Duration::from_secs(1);
        redis::cmd("CLIENT")
            .arg("PAUSE")
            .arg(u64::try_from(pause.as_millis())?)
            .arg("ALL")
            .query_async::<()>(&mut observer)
            .await?;
        let started_at = Instant::now();
        let result = redis::cmd("PING")
            .query_async::<String>(&mut consumer)
            .await;
        let error = result
            .err()
            .ok_or("paused Redis unexpectedly answered before the response timeout")?;
        assert!(
            error.is_timeout(),
            "a dependency stall must fail with the configured timeout"
        );
        assert!(
            !error.is_unrecoverable_error(),
            "redis-rs does not replace a connection merely because one request timed out"
        );
        assert!(started_at.elapsed() >= RESPONSE_TIMEOUT);
        assert!(started_at.elapsed() < pause + Duration::from_secs(1));
        // Timing out a future does not cancel the server command. Consumers propagate the error,
        // causing their dedicated manager to be dropped; they never retry on this uncertain stream.
        drop(consumer);
        tokio::time::sleep(pause.saturating_sub(started_at.elapsed()) + Duration::from_millis(100))
            .await;
        let mut restarted = connect(&client).await?;
        let restarted_id: u64 = redis::cmd("CLIENT")
            .arg("ID")
            .query_async(&mut restarted)
            .await?;
        assert_ne!(consumer_id, restarted_id);
        assert_eq!(
            redis::cmd("PING")
                .query_async::<String>(&mut restarted)
                .await?,
            "PONG"
        );
        Ok(())
    }
}
