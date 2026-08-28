//! Redis delivery loop for the OCR consumer.
//!
//! New deliveries stay on the blocking `XREADGROUP ... >` path. PEL work is scheduled separately
//! so an empty stream cannot make recovery Redis I/O run at the blocking-read cadence.

use std::time::{Duration, Instant};

use redis::aio::ConnectionManager;
use tokio::sync::watch;
use tracing::warn;

use crate::{
    outbox::PostCommitSink,
    pel_recovery::{PelRecoverySchedule, RecoveryAction},
};

use super::super::{object_store::R2ObjectStore, queue};
use super::{
    DeliveryDisposition, OcrChildLauncher, OcrConsumerConfig, OcrConsumerError,
    PendingRecoveryPolicy, process_delivery, shutdown_requested,
};

#[expect(
    clippy::too_many_arguments,
    reason = "one queue loop owns Redis delivery alongside the consumer's durable dependencies"
)]
pub(super) async fn consume_deliveries<L: OcrChildLauncher>(
    control_client: &mut tokio_postgres::Client,
    heartbeat_client: &mut tokio_postgres::Client,
    redis: &mut ConnectionManager,
    objects: &R2ObjectStore,
    launcher: &L,
    config: &OcrConsumerConfig,
    post_commit_sink: &PostCommitSink,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<(), OcrConsumerError> {
    let mut recovery_cursor = queue::PendingRecoveryCursor::start();
    let mut recovery_schedule =
        PelRecoverySchedule::new(Instant::now(), config.pel_recovery_interval);
    while !shutdown_requested(shutdown) {
        let delivery =
            next_delivery(redis, config, &mut recovery_cursor, &mut recovery_schedule).await?;
        if shutdown_requested(shutdown) {
            break;
        }
        let Some(delivery) = delivery else {
            continue;
        };
        let delivery_received_at = Instant::now();
        recovery_schedule.forget_target(&delivery.message_id);
        let disposition = Box::pin(process_delivery(
            control_client,
            heartbeat_client,
            redis,
            objects,
            launcher,
            config,
            post_commit_sink,
            &delivery,
            shutdown,
        ))
        .await?;
        match disposition {
            DeliveryDisposition::Acknowledge => {
                queue::acknowledge(redis, &config.queue, &delivery.message_id).await?;
            }
            DeliveryDisposition::AlreadyAcknowledged
            | DeliveryDisposition::LeavePending(PendingRecoveryPolicy::ColdOnly) => {}
            DeliveryDisposition::LeavePending(PendingRecoveryPolicy::AtIdleThreshold) => {
                let due_at = delivery_received_at
                    .checked_add(config.queue.claim_idle())
                    .ok_or(OcrConsumerError::DurationBound)?;
                if !schedule_target_at(&mut recovery_schedule, delivery.message_id, due_at) {
                    warn!(
                        event = "ocr_pel_target_schedule_full",
                        recovery = "cold",
                        "OCR pending delivery will wait for bounded cold recovery"
                    );
                }
            }
            DeliveryDisposition::StopLoop => break,
        }
    }
    Ok(())
}

async fn next_delivery(
    redis: &mut ConnectionManager,
    config: &OcrConsumerConfig,
    recovery_cursor: &mut queue::PendingRecoveryCursor,
    recovery_schedule: &mut PelRecoverySchedule,
) -> Result<Option<queue::OcrQueueDelivery>, OcrConsumerError> {
    match recovery_schedule.due_action(Instant::now()) {
        Some(RecoveryAction::ColdPage) => {
            let page = queue::recover_cold_page(redis, &config.queue, recovery_cursor).await?;
            if !recovery_schedule.record_cold_page(Instant::now(), page.complete) {
                return Err(OcrConsumerError::DurationBound);
            }
            for target in page.targets {
                if !schedule_target_after(
                    recovery_schedule,
                    target.message_id,
                    target.remaining_idle,
                )? {
                    warn!(
                        event = "ocr_pel_target_schedule_full",
                        recovery = "cold",
                        "OCR pending delivery will wait for bounded cold recovery"
                    );
                }
            }
            Ok(page.delivery)
        }
        Some(RecoveryAction::Targeted(message_id)) => {
            let recovery =
                queue::recover_targeted_delivery(redis, &config.queue, &message_id).await?;
            recovery_schedule.record_target_attempt(&message_id);
            match recovery {
                queue::TargetedRecovery::Delivery(delivery) => Ok(Some(delivery)),
                queue::TargetedRecovery::NotYetEligible(remaining_idle) => {
                    if !schedule_target_after(recovery_schedule, message_id, remaining_idle)? {
                        warn!(
                            event = "ocr_pel_target_schedule_full",
                            recovery = "targeted",
                            "OCR pending delivery will wait for bounded cold recovery"
                        );
                    }
                    Ok(None)
                }
                queue::TargetedRecovery::Missing => Ok(None),
            }
        }
        None => {
            let delivery = queue::read_new_delivery(redis, &config.queue).await?;
            recovery_schedule.record_new_delivery_read();
            Ok(delivery)
        }
    }
}

fn schedule_target_after(
    schedule: &mut PelRecoverySchedule,
    message_id: String,
    delay: Duration,
) -> Result<bool, OcrConsumerError> {
    let due_at = Instant::now()
        .checked_add(delay)
        .ok_or(OcrConsumerError::DurationBound)?;
    Ok(schedule_target_at(schedule, message_id, due_at))
}

fn schedule_target_at(
    schedule: &mut PelRecoverySchedule,
    message_id: String,
    due_at: Instant,
) -> bool {
    schedule.schedule_target(message_id, due_at)
}
