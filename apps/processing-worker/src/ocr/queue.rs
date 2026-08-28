use std::{collections::BTreeMap, time::Duration};

use redis::{
    AsyncCommands, RedisError,
    aio::ConnectionManager,
    streams::{
        StreamClaimReply, StreamId, StreamPendingCountReply, StreamReadOptions, StreamReadReply,
    },
};
use thiserror::Error;

use super::contract::{
    OcrQueueContractError, ValidatedOcrDelivery, parse_validated_delivery, recoverable_job_id,
};

const MAXIMUM_PENDING_SCAN_COUNT: usize = 100;
const MAXIMUM_DELIVERY_ATTEMPTS: usize = 10;
const PENDING_CURSOR_START: &str = "-";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OcrQueueConfig {
    stream: String,
    group: String,
    dead_letter_stream: String,
    consumer: String,
    claim_idle: Duration,
    block: Duration,
    maximum_delivery_attempts: usize,
    pending_scan_count: usize,
}

impl OcrQueueConfig {
    #[expect(
        clippy::too_many_arguments,
        reason = "the queue topology and every bounded delivery policy are mandatory together"
    )]
    pub(crate) fn new(
        stream: String,
        group: String,
        dead_letter_stream: String,
        consumer: String,
        claim_idle: Duration,
        block: Duration,
        maximum_delivery_attempts: usize,
        pending_scan_count: usize,
    ) -> Result<Self, OcrQueueError> {
        if [
            stream.as_str(),
            group.as_str(),
            dead_letter_stream.as_str(),
            consumer.as_str(),
        ]
        .into_iter()
        .any(|value| !valid_identifier(value))
            || claim_idle.is_zero()
            || block.is_zero()
            || !(1..=MAXIMUM_DELIVERY_ATTEMPTS).contains(&maximum_delivery_attempts)
            || !(1..=MAXIMUM_PENDING_SCAN_COUNT).contains(&pending_scan_count)
        {
            return Err(OcrQueueError::InvalidConfiguration);
        }
        Ok(Self {
            stream,
            group,
            dead_letter_stream,
            consumer,
            claim_idle,
            block,
            maximum_delivery_attempts,
            pending_scan_count,
        })
    }

    pub(crate) const fn claim_idle(&self) -> Duration {
        self.claim_idle
    }

    pub(crate) const fn block(&self) -> Duration {
        self.block
    }

    pub(crate) fn consumer(&self) -> &str {
        &self.consumer
    }
}

/// Cursor for a bounded `XPENDING` PEL sweep.
///
/// The next request uses Redis's exclusive range syntax, so a partial sweep cannot repeatedly
/// inspect its first entry. The cursor is intentionally local: a restart starts one bounded cold
/// scan from the beginning, which is the durable safe fallback for work left by another worker.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PendingRecoveryCursor {
    start_id: String,
}

impl PendingRecoveryCursor {
    #[must_use]
    pub(crate) fn start() -> Self {
        Self {
            start_id: String::from(PENDING_CURSOR_START),
        }
    }

    fn current(&self) -> &str {
        &self.start_id
    }

    fn advance_after(&mut self, message_id: &str) {
        self.start_id = format!("({message_id}");
    }

    fn reset(&mut self) {
        self.start_id = String::from(PENDING_CURSOR_START);
    }
}

/// A young pending entry found during the bounded cold scan.
#[derive(Debug)]
pub(crate) struct PendingRecoveryTarget {
    pub(crate) message_id: String,
    pub(crate) remaining_idle: Duration,
}

/// Result of one bounded PEL recovery page.
#[derive(Debug)]
pub(crate) struct ColdRecoveryPage {
    pub(crate) complete: bool,
    pub(crate) delivery: Option<OcrQueueDelivery>,
    pub(crate) targets: Vec<PendingRecoveryTarget>,
}

/// Result of checking one locally known pending delivery at its idle threshold.
#[derive(Debug)]
pub(crate) enum TargetedRecovery {
    Delivery(OcrQueueDelivery),
    NotYetEligible(Duration),
    Missing,
}

#[derive(Debug)]
pub(crate) struct OcrQueueDelivery {
    pub(crate) message_id: String,
    pub(crate) body: OcrQueueDeliveryBody,
}

#[derive(Debug)]
pub(crate) enum OcrQueueDeliveryBody {
    Job(Box<ValidatedOcrDelivery>),
    Malformed {
        recoverable_job_id: Option<String>,
        error: OcrQueueContractError,
    },
    MaximumAttempts {
        recoverable_job_id: Option<String>,
        delivery_count: usize,
        contract_error: Option<OcrQueueContractError>,
    },
}

#[derive(Debug, Error)]
pub(crate) enum OcrQueueError {
    #[error("OCR Redis operation failed")]
    Redis(#[from] RedisError),
    #[error("OCR queue configuration is unsafe")]
    InvalidConfiguration,
    #[error("OCR queue duration exceeds the Redis protocol bound")]
    DurationBound,
    #[error("OCR dead-letter transaction returned an unexpected acknowledgement count")]
    DeadLetterTransaction,
}

impl OcrQueueError {
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Redis(_) => "ocr_redis_operation",
            Self::InvalidConfiguration => "ocr_queue_configuration",
            Self::DurationBound => "ocr_queue_duration_bound",
            Self::DeadLetterTransaction => "ocr_dead_letter_transaction",
        }
    }
}

pub(crate) async fn ensure_consumer_group(
    redis: &mut ConnectionManager,
    config: &OcrQueueConfig,
) -> Result<(), OcrQueueError> {
    let result: Result<(), RedisError> = redis
        .xgroup_create_mkstream(&config.stream, &config.group, "0")
        .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.code() == Some("BUSYGROUP") => Ok(()),
        Err(error) => Err(OcrQueueError::Redis(error)),
    }
}

/// Waits only for entries that have never been delivered to the consumer group.
///
/// `XREADGROUP ... > BLOCK` is deliberately kept separate from PEL recovery. Redis wakes this
/// blocking request immediately when an `XADD` makes a new entry available.
pub(crate) async fn read_new_delivery(
    redis: &mut ConnectionManager,
    config: &OcrQueueConfig,
) -> Result<Option<OcrQueueDelivery>, OcrQueueError> {
    let block = duration_milliseconds(config.block)?;
    let options = StreamReadOptions::default()
        .group(&config.group, &config.consumer)
        .count(1)
        .block(block);
    let reply: Option<StreamReadReply> = redis
        .xread_options(&[&config.stream], &[">"], &options)
        .await?;
    Ok(reply
        .and_then(|reply| reply.keys.into_iter().flat_map(|stream| stream.ids).next())
        .map(|delivery| decode_delivery(&delivery, None, config.maximum_delivery_attempts)))
}

/// Scans at most one configured `XPENDING` page and claims at most one eligible delivery.
///
/// The caller interleaves pages with a normal blocking read, and caps the number of pages in a
/// sweep. Young entries become bounded local target-time checks so a graceful restart does not
/// unnecessarily defer a transient retry to the next cold scan.
pub(crate) async fn recover_cold_page(
    redis: &mut ConnectionManager,
    config: &OcrQueueConfig,
    cursor: &mut PendingRecoveryCursor,
) -> Result<ColdRecoveryPage, OcrQueueError> {
    let pending: StreamPendingCountReply = redis
        .xpending_count(
            &config.stream,
            &config.group,
            cursor.current(),
            "+",
            config.pending_scan_count,
        )
        .await?;
    let minimum_idle = duration_milliseconds(config.claim_idle)?;
    let page_length = pending.ids.len();
    if page_length == 0 {
        cursor.reset();
        return Ok(ColdRecoveryPage {
            complete: true,
            delivery: None,
            targets: Vec::new(),
        });
    }

    let mut targets = Vec::new();
    for (index, candidate) in pending.ids.into_iter().enumerate() {
        if candidate.last_delivered_ms < minimum_idle {
            targets.push(PendingRecoveryTarget {
                message_id: candidate.id.clone(),
                remaining_idle: remaining_idle(minimum_idle, candidate.last_delivered_ms)?,
            });
            cursor.advance_after(&candidate.id);
            continue;
        }

        let is_last_entry_in_page = index + 1 == page_length;
        let complete = is_last_entry_in_page && page_length < config.pending_scan_count;
        cursor.advance_after(&candidate.id);
        if complete {
            cursor.reset();
        }
        let claimed: StreamClaimReply = redis
            .xclaim(
                &config.stream,
                &config.group,
                &config.consumer,
                minimum_idle,
                &[&candidate.id],
            )
            .await?;
        return Ok(ColdRecoveryPage {
            complete,
            delivery: claimed.ids.into_iter().next().map(|delivery| {
                decode_delivery(
                    &delivery,
                    Some(candidate.times_delivered),
                    config.maximum_delivery_attempts,
                )
            }),
            targets,
        });
    }

    let complete = page_length < config.pending_scan_count;
    if complete {
        cursor.reset();
    }
    Ok(ColdRecoveryPage {
        complete,
        delivery: None,
        targets,
    })
}

/// Rechecks one known PEL entry at its idle threshold without scanning the entire PEL.
pub(crate) async fn recover_targeted_delivery(
    redis: &mut ConnectionManager,
    config: &OcrQueueConfig,
    message_id: &str,
) -> Result<TargetedRecovery, OcrQueueError> {
    let pending: StreamPendingCountReply = redis
        .xpending_count(&config.stream, &config.group, message_id, message_id, 1)
        .await?;
    let Some(candidate) = pending.ids.into_iter().next() else {
        return Ok(TargetedRecovery::Missing);
    };
    if candidate.id != message_id {
        return Ok(TargetedRecovery::Missing);
    }
    let minimum_idle = duration_milliseconds(config.claim_idle)?;
    if candidate.last_delivered_ms < minimum_idle {
        return Ok(TargetedRecovery::NotYetEligible(remaining_idle(
            minimum_idle,
            candidate.last_delivered_ms,
        )?));
    }
    let claimed: StreamClaimReply = redis
        .xclaim(
            &config.stream,
            &config.group,
            &config.consumer,
            minimum_idle,
            &[message_id],
        )
        .await?;
    Ok(claimed
        .ids
        .into_iter()
        .next()
        .map_or(TargetedRecovery::Missing, |delivery| {
            TargetedRecovery::Delivery(decode_delivery(
                &delivery,
                Some(candidate.times_delivered),
                config.maximum_delivery_attempts,
            ))
        }))
}

fn remaining_idle(
    minimum_idle: usize,
    last_delivered_ms: usize,
) -> Result<Duration, OcrQueueError> {
    let milliseconds = minimum_idle
        .checked_sub(last_delivered_ms)
        .ok_or(OcrQueueError::DurationBound)?;
    let milliseconds =
        u64::try_from(milliseconds).map_err(|_error| OcrQueueError::DurationBound)?;
    Ok(Duration::from_millis(milliseconds))
}

fn decode_delivery(
    delivery: &StreamId,
    prior_delivery_count: Option<usize>,
    maximum_delivery_attempts: usize,
) -> OcrQueueDelivery {
    let message_id = delivery.id.clone();
    let parsed = parse_validated_delivery(delivery);
    let body = if prior_delivery_count.is_some_and(|count| count >= maximum_delivery_attempts) {
        OcrQueueDeliveryBody::MaximumAttempts {
            recoverable_job_id: recoverable_job_id(delivery),
            delivery_count: prior_delivery_count.unwrap_or(maximum_delivery_attempts),
            contract_error: parsed.err(),
        }
    } else {
        match parsed {
            Ok(payload) => OcrQueueDeliveryBody::Job(Box::new(payload)),
            Err(error) => OcrQueueDeliveryBody::Malformed {
                recoverable_job_id: recoverable_job_id(delivery),
                error,
            },
        }
    };
    OcrQueueDelivery { message_id, body }
}

pub(crate) async fn acknowledge(
    redis: &mut ConnectionManager,
    config: &OcrQueueConfig,
    message_id: &str,
) -> Result<(), OcrQueueError> {
    let acknowledged: usize = redis
        .xack(&config.stream, &config.group, &[message_id])
        .await?;
    if acknowledged > 1 {
        return Err(OcrQueueError::DeadLetterTransaction);
    }
    Ok(())
}

pub(crate) async fn dead_letter_and_acknowledge(
    redis: &mut ConnectionManager,
    config: &OcrQueueConfig,
    delivery: &OcrQueueDelivery,
) -> Result<(), OcrQueueError> {
    let fields = dead_letter_fields(delivery);
    let mut transaction = redis::pipe();
    transaction.atomic();
    transaction
        .cmd("XADD")
        .arg(&config.dead_letter_stream)
        .arg("*");
    for (name, value) in fields {
        transaction.arg(name).arg(value);
    }
    transaction
        .ignore()
        .cmd("XACK")
        .arg(&config.stream)
        .arg(&config.group)
        .arg(&delivery.message_id);
    let (acknowledged,): (usize,) = transaction.query_async(redis).await?;
    if acknowledged != 1 {
        return Err(OcrQueueError::DeadLetterTransaction);
    }
    Ok(())
}

fn dead_letter_fields(delivery: &OcrQueueDelivery) -> BTreeMap<&'static str, String> {
    let mut fields = BTreeMap::from([
        ("deadLetterReason", String::from("QUEUE_FAILURE")),
        (
            "deadLetterMessage",
            String::from("OCR queue delivery exceeded its bounded attempts."),
        ),
        ("deadLetterSourceId", delivery.message_id.clone()),
    ]);
    match &delivery.body {
        OcrQueueDeliveryBody::MaximumAttempts {
            recoverable_job_id,
            delivery_count,
            contract_error,
        } => {
            fields.insert("deadLetterDeliveries", delivery_count.to_string());
            if let Some(job_id) = recoverable_job_id {
                fields.insert("jobId", job_id.clone());
            }
            if let Some(error) = contract_error {
                fields.insert(
                    "deadLetterContractError",
                    contract_error_kind(*error).into(),
                );
            }
        }
        OcrQueueDeliveryBody::Job(_) | OcrQueueDeliveryBody::Malformed { .. } => {
            fields.insert("deadLetterDeliveries", String::from("1"));
        }
    }
    fields
}

const fn contract_error_kind(error: OcrQueueContractError) -> &'static str {
    match error {
        OcrQueueContractError::ClosedFieldSet => "closed_field_set",
        OcrQueueContractError::MissingField(_) => "missing_field",
        OcrQueueContractError::NonStringField(_) => "non_string_field",
        OcrQueueContractError::InvalidField(_) => "invalid_field",
        OcrQueueContractError::InvalidHints => "invalid_hints",
    }
}

fn duration_milliseconds(duration: Duration) -> Result<usize, OcrQueueError> {
    usize::try_from(duration.as_millis()).map_err(|_conversion_error| OcrQueueError::DurationBound)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use redis::Value;

    use super::*;

    #[test]
    fn queue_configuration_is_fully_bounded() {
        assert!(config(1, 10).is_ok());
        assert!(config(0, 10).is_err());
        assert!(config(1, 0).is_err());
        assert!(
            OcrQueueConfig::new(
                String::from("unsafe stream"),
                String::from("group"),
                String::from("dead"),
                String::from("consumer"),
                Duration::from_secs(1),
                Duration::from_secs(1),
                1,
                10,
            )
            .is_err()
        );
    }

    #[test]
    fn stale_attempt_limit_precedes_payload_decode_and_bounds_dlq_fields() {
        let delivery = StreamId {
            id: String::from("1-0"),
            map: HashMap::from([
                (
                    String::from("jobId"),
                    Value::BulkString(b"job-safe-1".to_vec()),
                ),
                (
                    String::from("credential"),
                    Value::BulkString(b"must-not-be-copied".to_vec()),
                ),
            ]),
        };
        let decoded = decode_delivery(&delivery, Some(2), 2);
        let fields = dead_letter_fields(&decoded);
        assert_eq!(fields.get("jobId").map(String::as_str), Some("job-safe-1"));
        assert_eq!(
            fields.get("deadLetterContractError").map(String::as_str),
            Some("closed_field_set")
        );
        assert!(!fields.values().any(|value| value.contains("must-not")));
    }

    #[test]
    fn malformed_new_delivery_is_not_dead_lettered_before_db_handling() {
        let delivery = StreamId {
            id: String::from("1-0"),
            map: HashMap::from([(
                String::from("jobId"),
                Value::BulkString(b"job-safe-1".to_vec()),
            )]),
        };
        assert!(matches!(
            decode_delivery(&delivery, None, 1).body,
            OcrQueueDeliveryBody::Malformed {
                recoverable_job_id: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn pending_recovery_cursor_advances_exclusively_and_resets_after_a_completed_sweep() {
        let mut cursor = PendingRecoveryCursor::start();
        assert_eq!(cursor.current(), PENDING_CURSOR_START);

        cursor.advance_after("42-0");
        assert_eq!(cursor.current(), "(42-0");

        cursor.reset();
        assert_eq!(cursor.current(), PENDING_CURSOR_START);
    }

    #[test]
    fn remaining_idle_keeps_the_exact_server_reported_difference() {
        assert!(matches!(
            remaining_idle(120_000, 119_999),
            Ok(duration) if duration == Duration::from_millis(1)
        ));
        assert!(remaining_idle(120_000, 120_001).is_err());
    }

    fn config(
        maximum_delivery_attempts: usize,
        pending_scan_count: usize,
    ) -> Result<OcrQueueConfig, OcrQueueError> {
        OcrQueueConfig::new(
            String::from("momo:ocr:v2:jobs"),
            String::from("momo-ocr-rust-v2"),
            String::from("momo:ocr:v2:jobs:dead"),
            String::from("ocr-worker-1"),
            Duration::from_mins(5),
            Duration::from_secs(30),
            maximum_delivery_attempts,
            pending_scan_count,
        )
    }
}
