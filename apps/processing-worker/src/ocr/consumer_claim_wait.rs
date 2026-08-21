//! Claim-wait policy for one OCR queue delivery.
//!
//! This stays separate from child-process supervision so deferred control-plane ownership can be
//! tested without entangling it with source-image or OCR runtime dependencies.

use tokio::{sync::watch, time};

use crate::outbox::{ControlOutcome, PostCommitSink};

use super::{
    ClaimedOcrJob, OcrClaimResult, OcrConsumerConfig, OcrConsumerError, OcrQueuePayload, claim_job,
};

pub(super) enum ClaimDecision {
    Claimed(ClaimedOcrJob),
    RetryClaim,
    RetryAtIdleThreshold,
    Acknowledge,
    LeavePendingCold,
    StopWaiting,
}

pub(super) async fn wait_for_claim(
    client: &mut tokio_postgres::Client,
    payload: &OcrQueuePayload,
    config: &OcrConsumerConfig,
    post_commit_sink: &PostCommitSink,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<ClaimDecision, OcrConsumerError> {
    let deadline = time::sleep(config.claim_wait_timeout);
    tokio::pin!(deadline);
    loop {
        match submit_claim_outcome(
            post_commit_sink,
            claim_job(client, payload, &config.control).await?,
        )? {
            ClaimDecision::Claimed(claim) => return Ok(ClaimDecision::Claimed(claim)),
            ClaimDecision::Acknowledge => return Ok(ClaimDecision::Acknowledge),
            ClaimDecision::LeavePendingCold => return Ok(ClaimDecision::LeavePendingCold),
            ClaimDecision::StopWaiting => return Ok(ClaimDecision::StopWaiting),
            ClaimDecision::RetryAtIdleThreshold => {
                return Ok(ClaimDecision::RetryAtIdleThreshold);
            }
            ClaimDecision::RetryClaim => {}
        }
        tokio::select! {
            () = &mut deadline => return Ok(ClaimDecision::RetryAtIdleThreshold),
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(ClaimDecision::StopWaiting);
                }
            }
            () = time::sleep(config.heartbeat_interval) => {}
        }
    }
}

pub(super) fn submit_claim_outcome(
    sink: &PostCommitSink,
    outcome: ControlOutcome<OcrClaimResult>,
) -> Result<ClaimDecision, OcrConsumerError> {
    sink.submit(outcome.effects)?;
    Ok(classify_claim_result(outcome.value))
}

pub(super) fn classify_claim_result(result: OcrClaimResult) -> ClaimDecision {
    match result {
        OcrClaimResult::Claimed(claim) => ClaimDecision::Claimed(claim),
        OcrClaimResult::MissingOrTerminal
        | OcrClaimResult::AlreadyRunning
        | OcrClaimResult::QueueContractMismatch => ClaimDecision::Acknowledge,
        OcrClaimResult::UnsupportedQueueSchema | OcrClaimResult::NotYetAvailable => {
            ClaimDecision::LeavePendingCold
        }
        OcrClaimResult::Busy | OcrClaimResult::PreemptionRequested => ClaimDecision::RetryClaim,
    }
}
