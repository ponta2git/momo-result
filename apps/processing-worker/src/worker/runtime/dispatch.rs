//! Bounded candidate selection; active attempts retain their own heartbeat and child task.
use super::{PendingExecution, WorkState, WorkerError, bounded, ocr, selection, series_analysis};
use std::time::Duration;
use tokio::{sync::watch, time};

struct ScanBudget {
    until: time::Instant,
    contended: bool,
}
impl ScanBudget {
    fn exhausted(&self) -> bool {
        time::Instant::now() >= self.until
    }
}
pub(super) fn stopping(shutdown: &watch::Receiver<bool>) -> bool {
    *shutdown.borrow() || shutdown.has_changed().is_err()
}

pub(super) async fn claim_next(
    scheduler: &mut WorkState,
    shutdown: &watch::Receiver<bool>,
) -> Result<bool, WorkerError> {
    if scheduler
        .retry_after
        .is_some_and(|deadline| deadline > time::Instant::now())
    {
        return Ok(false);
    }
    scheduler.retry_after = None;
    if scheduler.resources.is_reserved() {
        return Ok(false);
    }
    let mut budget = ScanBudget {
        until: time::Instant::now() + Duration::from_millis(250),
        contended: false,
    };
    if scheduler.ocr.is_some() && claim_ocr(scheduler, shutdown, &mut budget).await? {
        return Ok(true);
    }
    if stopping(shutdown) || scheduler.resources.is_reserved() || scheduler.retry_after.is_some() {
        if budget.contended && scheduler.retry_after.is_none() {
            defer_claims(scheduler);
        }
        return Ok(false);
    }
    let more = Box::pin(claim_analysis(scheduler, shutdown, &mut budget)).await?;
    if budget.contended && !more {
        defer_claims(scheduler);
    }
    Ok(more)
}

fn defer_claims(scheduler: &mut WorkState) {
    scheduler.retry_after = Some(time::Instant::now() + Duration::from_secs(1));
}

async fn claim_ocr(
    scheduler: &mut WorkState,
    shutdown: &watch::Receiver<bool>,
    budget: &mut ScanBudget,
) -> Result<bool, WorkerError> {
    if scheduler.resources.is_reserved() {
        return Ok(false);
    }
    let config = scheduler
        .ocr_config
        .clone()
        .ok_or(WorkerError::UnsupportedPlatform)?;
    let timeout = scheduler.settings.operation_timeout;
    let mut attempted = false;
    for _ in 0..4 {
        let jobs = bounded(
            timeout,
            selection::candidates(&scheduler.database, true, scheduler.ocr_cursor.as_ref()),
        )
        .await?;
        let complete = jobs.len() < 64;
        for cursor in jobs {
            if stopping(shutdown) {
                return Ok(false);
            }
            if attempted && budget.exhausted() {
                return Ok(true);
            }
            // A slow candidate query must not consume the chance to make progress.
            attempted = true;
            let id = cursor.id.clone();
            scheduler.ocr_cursor = Some(cursor);
            scheduler.resources.reserve()?;
            let outcome = match bounded(
                timeout,
                ocr::control::claim_job(&mut scheduler.database, &id, &config),
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(error) if error.is_contention() => {
                    scheduler.resources.release();
                    budget.contended = true;
                    continue;
                }
                Err(error) => return Err(error),
            };
            scheduler.sink.submit(outcome.effects)?;
            match outcome.value {
                ocr::control::OcrClaimResult::Claimed(claim) => {
                    start_ocr(scheduler, claim)?;
                    return Ok(false);
                }
                ocr::control::OcrClaimResult::MissingOrTerminal
                | ocr::control::OcrClaimResult::AlreadyRunning
                | ocr::control::OcrClaimResult::NotYetAvailable
                | ocr::control::OcrClaimResult::InvalidInput => scheduler.resources.release(),
            }
        }
        if complete {
            scheduler.ocr_cursor = None;
            return Ok(false);
        }
    }
    Ok(true)
}

async fn claim_analysis(
    scheduler: &mut WorkState,
    shutdown: &watch::Receiver<bool>,
    budget: &mut ScanBudget,
) -> Result<bool, WorkerError> {
    if scheduler.resources.is_reserved() {
        return Ok(false);
    }
    let Some(config) = &scheduler.config else {
        return Ok(false);
    };
    let timeout = scheduler.settings.operation_timeout;
    let mut attempted = false;
    for _ in 0..4 {
        let jobs = bounded(
            timeout,
            selection::candidates(
                &scheduler.database,
                false,
                scheduler.analysis_cursor.as_ref(),
            ),
        )
        .await?;
        let complete = jobs.len() < 64;
        for cursor in jobs {
            if stopping(shutdown) {
                return Ok(false);
            }
            if attempted && budget.exhausted() {
                return Ok(true);
            }
            // OCR discovery may already have exhausted the shared soft budget.
            attempted = true;
            let id = cursor.id.clone();
            scheduler.analysis_cursor = Some(cursor);
            scheduler.resources.reserve()?;
            let outcome = match bounded(
                timeout,
                series_analysis::control::claim_job(&mut scheduler.database, &id, config),
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(error) if error.is_contention() => {
                    scheduler.resources.release();
                    budget.contended = true;
                    continue;
                }
                Err(error) => return Err(error),
            };
            scheduler.sink.submit(outcome.effects)?;
            match outcome.value {
                series_analysis::control::ClaimResult::Claimed(claim) => {
                    start_analysis(scheduler, claim)?;
                    return Ok(false);
                }
                series_analysis::control::ClaimResult::Busy => {
                    scheduler.resources.release();
                    defer_claims(scheduler);
                    scheduler.analysis_cursor = None;
                    return Ok(false);
                }
                series_analysis::control::ClaimResult::MissingOrTerminal
                | series_analysis::control::ClaimResult::RecoveredCurrentJob
                | series_analysis::control::ClaimResult::UnsupportedVersion(_)
                | series_analysis::control::ClaimResult::NotYetAvailable { .. } => {
                    scheduler.resources.release();
                }
            }
        }
        if complete {
            scheduler.analysis_cursor = None;
            return Ok(false);
        }
    }
    Ok(true)
}

fn start_ocr(
    scheduler: &mut WorkState,
    claim: ocr::control::ClaimedOcrJob,
) -> Result<(), WorkerError> {
    let Some(runner) = scheduler.ocr.take() else {
        return Err(WorkerError::UnsupportedPlatform);
    };
    scheduler.pending = Some(PendingExecution::Ocr(runner, claim));
    Ok(())
}

fn start_analysis(
    scheduler: &mut WorkState,
    claim: series_analysis::control::ClaimedJob,
) -> Result<(), WorkerError> {
    let Some(runner) = scheduler
        .analysis
        .as_mut()
        .and_then(series_analysis::Module::take_runner)
    else {
        return Err(WorkerError::UnsupportedPlatform);
    };
    scheduler.pending = Some(PendingExecution::Analysis(runner, claim));
    Ok(())
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
