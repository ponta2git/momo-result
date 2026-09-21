//! Submission completion is independent of image execution and of notification delivery.

use std::time::Duration;
use tokio_postgres::Client;

pub(crate) mod control;
mod listener;
pub(crate) mod runtime;

pub(super) const CHANNEL: &str = "ocr_submissions";
pub(super) const PAGE_SIZE: i64 = 32;
pub(super) const SAFETY_INTERVAL: Duration = Duration::from_secs(30);

/// A hint can be lost without changing the committed business result. The coordinator's cold
/// scan also runs while idle, so the first missing hint cannot strand an accepted submission.
pub(crate) async fn wake(client: &Client) {
    let attempt = tokio::time::timeout(
        Duration::from_secs(1),
        client.execute("SELECT pg_notify($1, '')", &[&CHANNEL]),
    )
    .await;
    if !matches!(attempt, Ok(Ok(_))) {
        tracing::warn!(event = "ocr_submission_wake_skipped");
    }
}
