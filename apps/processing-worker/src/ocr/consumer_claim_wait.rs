//! Claim-wait policy for one OCR queue delivery.
//!
//! This stays separate from child-process supervision so deferred control-plane ownership can be
//! tested without entangling it with source-image or OCR runtime dependencies.

use tokio::{sync::watch, time};

use crate::outbox::{ControlOutcome, PostCommitSink};

use super::{
    ClaimedOcrJob, OcrClaimResult, OcrConsumerConfig, OcrConsumerError, ValidatedOcrDelivery,
    claim_job, shutdown_requested,
};

pub(super) enum ClaimDecision {
    Claimed(ClaimedOcrJob),
    RetryAtIdleThreshold,
    Acknowledge,
    LeavePendingCold,
    StopWaiting,
}

pub(super) enum ClaimAttempt {
    Complete(ClaimDecision),
    Retry,
}

pub(super) async fn wait_for_claim(
    client: &mut tokio_postgres::Client,
    delivery: &ValidatedOcrDelivery,
    config: &OcrConsumerConfig,
    post_commit_sink: &PostCommitSink,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<ClaimDecision, OcrConsumerError> {
    let deadline_at = time::Instant::now()
        .checked_add(config.control.lease_duration())
        .ok_or(OcrConsumerError::DurationBound)?;
    let deadline = time::sleep_until(deadline_at);
    tokio::pin!(deadline);
    loop {
        if shutdown_requested(shutdown) {
            return Ok(ClaimDecision::StopWaiting);
        }
        let claim = claim_job(client, delivery, &config.control);
        tokio::pin!(claim);
        let claim_outcome = loop {
            tokio::select! {
                biased;
                result = shutdown.changed() => {
                    if result.is_err() || *shutdown.borrow() {
                        return Ok(ClaimDecision::StopWaiting);
                    }
                }
                () = &mut deadline => return Ok(ClaimDecision::RetryAtIdleThreshold),
                outcome = &mut claim => break outcome?,
            }
        };
        match submit_claim_outcome(post_commit_sink, claim_outcome)? {
            ClaimAttempt::Complete(decision) => return Ok(decision),
            ClaimAttempt::Retry => {}
        }
        tokio::select! {
            biased;
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Ok(ClaimDecision::StopWaiting);
                }
            }
            () = &mut deadline => return Ok(ClaimDecision::RetryAtIdleThreshold),
            () = time::sleep(config.heartbeat_interval) => {}
        }
    }
}

pub(super) fn submit_claim_outcome(
    sink: &PostCommitSink,
    outcome: ControlOutcome<OcrClaimResult>,
) -> Result<ClaimAttempt, OcrConsumerError> {
    sink.submit(outcome.effects)?;
    Ok(classify_claim_result(outcome.value))
}

pub(super) fn classify_claim_result(result: OcrClaimResult) -> ClaimAttempt {
    match result {
        OcrClaimResult::Claimed(claim) => ClaimAttempt::Complete(ClaimDecision::Claimed(claim)),
        OcrClaimResult::MissingOrTerminal
        | OcrClaimResult::AlreadyRunning
        | OcrClaimResult::QueueContractMismatch => {
            ClaimAttempt::Complete(ClaimDecision::Acknowledge)
        }
        OcrClaimResult::UnsupportedQueueSchema | OcrClaimResult::NotYetAvailable => {
            ClaimAttempt::Complete(ClaimDecision::LeavePendingCold)
        }
        OcrClaimResult::Busy | OcrClaimResult::PreemptionRequested => ClaimAttempt::Retry,
    }
}
