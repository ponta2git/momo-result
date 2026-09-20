//! Bounded removal of acknowledged history from a dedicated consumer-group stream.

use redis::{RedisError, aio::ConnectionManager};

const TRIM_ACKNOWLEDGED_PREFIX: &str =
    include_str!("stream_retention/trim_acknowledged_prefix.lua");
const MAXIMUM_TRIM_ENTRIES: usize = 1000;

pub(crate) async fn trim_acknowledged_prefix(
    redis: &mut ConnectionManager,
    stream: &str,
    group: &str,
) -> Result<usize, RedisError> {
    redis::cmd("EVAL")
        .arg(TRIM_ACKNOWLEDGED_PREFIX)
        .arg(1)
        .arg(stream)
        .arg(group)
        .arg(MAXIMUM_TRIM_ENTRIES)
        .query_async(redis)
        .await
}

#[cfg(test)]
mod tests;
