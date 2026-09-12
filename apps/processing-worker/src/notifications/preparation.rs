//! Optional work after all business writes, with enough time to recover and commit.

use std::{future::Future, time::Duration};

use tokio::time::{Instant, timeout_at};
use tokio_postgres::Transaction;

use super::{PreparedNotification, SkipReason, log_skip};

pub(super) async fn recoverable(
    transaction: &Transaction<'_>,
    kind: &'static str,
    job_id: &str,
    finalization_deadline: Instant,
    snapshot: impl Future<
        Output = Result<Result<PreparedNotification, SkipReason>, tokio_postgres::Error>,
    >,
) -> Result<Option<PreparedNotification>, tokio_postgres::Error> {
    let now = Instant::now();
    // Dropping a query future does not cancel the server command. Reserve a second timeout
    // interval for that command, plus recovery and COMMIT, within the original parent deadline.
    // Scale the recovery margin with the remaining time so short OCR deadlines still admit
    // useful work, while longer finalization windows reserve several database round trips.
    let remaining = finalization_deadline.saturating_duration_since(now);
    let recovery = (remaining / 4).clamp(Duration::from_millis(100), Duration::from_secs(1));
    let budget = remaining
        .checked_sub(recovery)
        .map(|remaining| (remaining / 2).min(Duration::from_secs(2)))
        .filter(|budget| *budget >= Duration::from_millis(1));
    let Some(budget) = budget else {
        log_skip(kind, job_id, SkipReason::FinalizationBudget);
        return Ok(None);
    };
    transaction
        .batch_execute("SAVEPOINT result_notification_preparation")
        .await?;
    let attempt = timeout_at(now + budget, async {
        set_timeouts(transaction, budget).await?;
        // A separate statement ensures READ COMMITTED takes its snapshot after waiting.
        transaction
            .query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
            .await?;
        let result = snapshot.await?;
        set_timeouts(
            transaction,
            finalization_deadline.saturating_duration_since(Instant::now()),
        )
        .await?;
        Ok::<_, tokio_postgres::Error>(result)
    })
    .await;
    let result = if let Ok(Ok(result)) = attempt {
        transaction
            .batch_execute("RELEASE SAVEPOINT result_notification_preparation")
            .await?;
        result
    } else {
        transaction.batch_execute(
            "ROLLBACK TO SAVEPOINT result_notification_preparation; RELEASE SAVEPOINT result_notification_preparation"
        ).await?;
        Err(SkipReason::PreparationFailed)
    };
    match result {
        Ok(prepared) => Ok(Some(prepared)),
        Err(reason) => {
            log_skip(kind, job_id, reason);
            Ok(None)
        }
    }
}

async fn set_timeouts(
    transaction: &Transaction<'_>,
    timeout: Duration,
) -> Result<(), tokio_postgres::Error> {
    let value = format!("{}ms", timeout.as_millis().max(1));
    transaction.query_one(
        "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)",
        &[&value],
    ).await?;
    Ok(())
}
