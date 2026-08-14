use momo_analysis_core::contract::{QUEUE_SCHEMA_VERSION, QueuePayload};
use redis::{
    AsyncCommands, RedisError,
    aio::ConnectionManager,
    streams::{
        StreamAutoClaimOptions, StreamAutoClaimReply, StreamId, StreamReadOptions, StreamReadReply,
    },
};

use crate::series_analysis::config::AnalysisConsumerConfig;

use super::ConsumerError;

const AUTO_CLAIM_COUNT: usize = 1;
const AUTO_CLAIM_START: &str = "0-0";

#[derive(Debug)]
pub(super) struct AutoClaimCursor {
    start_id: String,
}

impl AutoClaimCursor {
    #[must_use]
    pub(super) fn start() -> Self {
        Self {
            start_id: String::from(AUTO_CLAIM_START),
        }
    }

    fn current(&self) -> &str {
        &self.start_id
    }

    fn advance(&mut self, reply: StreamAutoClaimReply) -> Option<StreamId> {
        self.start_id = reply.next_stream_id;
        reply.claimed.into_iter().next()
    }
}

pub(super) async fn ensure_consumer_group(
    redis: &mut ConnectionManager,
    config: &AnalysisConsumerConfig,
) -> Result<(), ConsumerError> {
    let result: Result<(), RedisError> = redis
        .xgroup_create_mkstream(&config.redis_stream, &config.redis_group, "0")
        .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.code() == Some("BUSYGROUP") => Ok(()),
        Err(error) => Err(ConsumerError::Redis(error)),
    }
}

pub(super) async fn next_delivery(
    redis: &mut ConnectionManager,
    config: &AnalysisConsumerConfig,
    recovery_cursor: &mut AutoClaimCursor,
) -> Result<Option<StreamId>, ConsumerError> {
    let minimum_idle = usize::try_from(config.lease_duration.as_millis())?;
    let claimed: StreamAutoClaimReply = redis
        .xautoclaim_options(
            &config.redis_stream,
            &config.redis_group,
            &config.worker_id,
            minimum_idle,
            recovery_cursor.current(),
            StreamAutoClaimOptions::default().count(AUTO_CLAIM_COUNT),
        )
        .await?;
    if let Some(delivery) = recovery_cursor.advance(claimed) {
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
    config: &AnalysisConsumerConfig,
    message_id: &str,
) -> Result<(), ConsumerError> {
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
    fn auto_claim_cursor_advances_across_empty_pages_and_wraps_after_a_full_scan() {
        let mut cursor = AutoClaimCursor::start();

        let first = cursor.advance(StreamAutoClaimReply {
            next_stream_id: String::from("42-0"),
            claimed: Vec::new(),
            deleted_ids: Vec::new(),
        });
        assert!(
            first.is_none(),
            "an ineligible scan page must not invent a delivery"
        );
        assert_eq!(
            cursor.current(),
            "42-0",
            "the next scan must continue after the ineligible PEL prefix"
        );

        let claimed = StreamId {
            id: String::from("84-0"),
            map: HashMap::new(),
        };
        let second = cursor.advance(StreamAutoClaimReply {
            next_stream_id: String::from(AUTO_CLAIM_START),
            claimed: vec![claimed.clone()],
            deleted_ids: Vec::new(),
        });
        assert_eq!(second.map(|delivery| delivery.id), Some(claimed.id));
        assert_eq!(
            cursor.current(),
            AUTO_CLAIM_START,
            "Redis 0-0 completion cursor must restart the next recovery scan"
        );
    }

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
