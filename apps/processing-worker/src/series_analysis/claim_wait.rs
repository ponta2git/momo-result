//! Optional early claims for an already received analysis delivery whose shared slot was busy.
//!
//! This does not reclaim Redis ownership or replace PEL recovery. All deliveries in this consumer
//! share a small budget; when it is spent, the original recovery deadline still applies.

use tokio::{sync::watch, time};

use crate::{
    busy_retry::{BusyRetry, BusyRetryBudget},
    outbox::PostCommitSink,
};

use super::{
    ConsumerError,
    config::AnalysisConsumerConfig,
    control::{ClaimResult, claim_job, retry_busy_job},
    metrics::{measure, signed_milliseconds},
    submit_control_outcome,
};

/// Returns `None` only when shutdown stops waiting before another claim starts.
pub(super) async fn claim_delivery(
    client: &mut tokio_postgres::Client,
    job_id: &str,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    early_claim_until: std::time::Instant,
    budget: &mut BusyRetryBudget,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<Option<ClaimResult>, ConsumerError> {
    let initial = submit_control_outcome(
        post_commit_sink,
        measure("job_claim", claim_job(client, job_id, config)).await?,
    )?;
    if !matches!(initial, ClaimResult::Busy) {
        return Ok(Some(initial));
    }

    // The caller preserves the earliest original PEL-recovery or maintenance deadline.
    let normal_recovery_at = time::Instant::from_std(early_claim_until);
    let mut retry = BusyRetry::new(time::Instant::now(), normal_recovery_at);
    let mut summary = WaitSummary::new(job_id);
    loop {
        if shutdown_requested(shutdown) {
            summary.outcome = "shutdown";
            return Ok(None);
        }
        let now = time::Instant::now();
        let next_at = budget.available(now).then(|| retry.next_at(now)).flatten();
        let Some(next_at) = next_at else {
            summary.outcome = "deferred";
            return Ok(Some(ClaimResult::Busy));
        };
        loop {
            tokio::select! {
                biased;
                result = shutdown.changed() => {
                    if result.is_err() || *shutdown.borrow() {
                        summary.outcome = "shutdown";
                        return Ok(None);
                    }
                }
                () = time::sleep_until(next_at) => break,
            }
        }
        if !retry.try_start(time::Instant::now(), budget) {
            summary.outcome = "deferred";
            return Ok(Some(ClaimResult::Busy));
        }
        summary.attempts = retry.attempts();
        // A started claim must resolve, even if shutdown or the retry-start deadline arrives.
        // Dropping it at COMMIT could lose the acquired owner or its post-commit outbox effect.
        // Errors retain the delivery through the existing consumer-failure recovery path.
        let outcome = retry_busy_job(client, job_id, config)
            .await
            .inspect_err(|_| summary.outcome = "control_error")?;
        let claim = submit_control_outcome(post_commit_sink, outcome)
            .inspect_err(|_| summary.outcome = "post_commit_error")?;
        summary.outcome = match &claim {
            ClaimResult::Busy => continue,
            ClaimResult::Claimed(_) => "claimed",
            ClaimResult::MissingOrTerminal | ClaimResult::RecoveredCurrentJob => "resolved",
            ClaimResult::NotYetAvailable { .. } => "not_yet_available",
            ClaimResult::UnsupportedVersion(_) => "unsupported_version",
        };
        // If shutdown arrived during a successful claim, the normal attempt path must durably
        // requeue that owned job; returning a pending disposition here would strand its lease.
        return Ok(Some(claim));
    }
}

fn shutdown_requested(shutdown: &watch::Receiver<bool>) -> bool {
    *shutdown.borrow() || shutdown.has_changed().is_err()
}

struct WaitSummary<'a> {
    job_id: &'a str,
    started: time::Instant,
    attempts: u8,
    outcome: &'static str,
}

impl<'a> WaitSummary<'a> {
    fn new(job_id: &'a str) -> Self {
        Self {
            job_id,
            started: time::Instant::now(),
            attempts: 0,
            outcome: "interrupted",
        }
    }
}

impl Drop for WaitSummary<'_> {
    fn drop(&mut self) {
        if self.attempts == 0 {
            return;
        }
        tracing::info!(
            event = "analysis_busy_claim_wait_finished",
            job_id = self.job_id,
            extra_claims = self.attempts,
            duration_milliseconds = signed_milliseconds(self.started.elapsed()),
            outcome = self.outcome,
            "analysis shared-slot early recheck finished"
        );
    }
}
