use momo_analysis_core::contract::{QUEUE_SCHEMA_VERSION, QueuePayload};
use redis::{
    AsyncCommands, RedisError,
    aio::ConnectionManager,
    streams::{
        StreamAutoClaimOptions, StreamAutoClaimReply, StreamId, StreamReadOptions, StreamReadReply,
    },
};

use crate::config::WorkerRuntimeConfig;

use super::WorkerError;

pub(super) async fn ensure_consumer_group(
    redis: &mut ConnectionManager,
    config: &WorkerRuntimeConfig,
) -> Result<(), WorkerError> {
    let result: Result<(), RedisError> = redis
        .xgroup_create_mkstream(&config.redis_stream, &config.redis_group, "0")
        .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.code() == Some("BUSYGROUP") => Ok(()),
        Err(error) => Err(WorkerError::Redis(error)),
    }
}

pub(super) async fn next_delivery(
    redis: &mut ConnectionManager,
    config: &WorkerRuntimeConfig,
) -> Result<Option<StreamId>, WorkerError> {
    let minimum_idle = usize::try_from(config.lease_duration.as_millis())?;
    let claimed: StreamAutoClaimReply = redis
        .xautoclaim_options(
            &config.redis_stream,
            &config.redis_group,
            &config.worker_id,
            minimum_idle,
            "0-0",
            StreamAutoClaimOptions::default().count(1),
        )
        .await?;
    if let Some(delivery) = claimed.claimed.into_iter().next() {
        return Ok(Some(delivery));
    }

    let block = usize::try_from(config.redis_block.as_millis())?;
    let options = StreamReadOptions::default()
        .group(&config.redis_group, &config.worker_id)
        .count(1)
        .block(block);
    let reply: Option<StreamReadReply> = redis
        .xread_options(&[&config.redis_stream], &[">"], &options)
        .await?;
    Ok(reply.and_then(|reply| reply.keys.into_iter().flat_map(|stream| stream.ids).next()))
}

pub(super) fn payload_from_delivery(delivery: &StreamId) -> Option<QueuePayload> {
    if delivery.len() != 2 {
        return None;
    }
    let schema_version = delivery.get::<u32>("schemaVersion")?;
    let job_id = delivery.get::<String>("jobId")?;
    let payload = QueuePayload {
        schema_version,
        job_id,
    };
    if payload.schema_version != QUEUE_SCHEMA_VERSION || payload.validate().is_err() {
        None
    } else {
        Some(payload)
    }
}

pub(super) async fn acknowledge(
    redis: &mut ConnectionManager,
    config: &WorkerRuntimeConfig,
    message_id: &str,
) -> Result<(), WorkerError> {
    let _: usize = redis
        .xack(&config.redis_stream, &config.redis_group, &[message_id])
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use redis::Value;

    use super::*;

    #[test]
    fn queue_delivery_rejects_extra_fields() {
        let delivery = StreamId {
            id: String::from("1-0"),
            map: HashMap::from([
                (String::from("schemaVersion"), Value::Int(1)),
                (
                    String::from("jobId"),
                    Value::BulkString(b"analysis-job-1".to_vec()),
                ),
                (String::from("attempt"), Value::Int(2)),
            ]),
        };

        assert!(payload_from_delivery(&delivery).is_none());
    }

    #[test]
    fn queue_delivery_accepts_only_the_minimal_contract() {
        let delivery = StreamId {
            id: String::from("1-0"),
            map: HashMap::from([
                (String::from("schemaVersion"), Value::Int(1)),
                (
                    String::from("jobId"),
                    Value::BulkString(b"analysis-job-1".to_vec()),
                ),
            ]),
        };

        assert_eq!(
            payload_from_delivery(&delivery),
            Some(QueuePayload {
                schema_version: 1,
                job_id: String::from("analysis-job-1"),
            })
        );
    }
}
