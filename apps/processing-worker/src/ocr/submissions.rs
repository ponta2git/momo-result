//! Submission completion is independent of image execution and of notification delivery.

use std::time::Duration;
use tokio_postgres::{Client, types::Type};

pub(crate) mod control;
#[cfg(test)]
mod listener;
pub(crate) mod runtime;

pub(crate) const CHANNEL: &str = "ocr_submissions";
pub(super) const PAGE_SIZE: i64 = 32;
pub(super) const SAFETY_INTERVAL: Duration = Duration::from_secs(30);

/// A hint can be lost without changing the committed business result. The coordinator's cold
/// scan also runs while idle, so the first missing hint cannot strand an accepted submission.
pub(crate) async fn wake(client: &Client) {
    let attempt = tokio::time::timeout(
        Duration::from_secs(1),
        client.execute_typed("SELECT pg_notify($1, '')", &[(&CHANNEL, Type::TEXT)]),
    )
    .await;
    if !matches!(attempt, Ok(Ok(_))) {
        tracing::warn!(event = "ocr_submission_wake_skipped");
    }
}
