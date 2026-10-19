//! Worker-owned supervision of the notification transport, separate from business execution.

use tokio::{
    task::JoinHandle,
    time::{self, Instant},
};

use super::{NotificationConfig, NotificationConfigError, NotificationSink};

pub(crate) struct NotificationDriver(momo_notifications::NotificationDriver);

impl NotificationDriver {
    pub(crate) fn new(
        config: NotificationConfig,
    ) -> Result<(NotificationSink, Self), NotificationConfigError> {
        momo_notifications::NotificationDriver::new(config)
            .map(|(sink, driver)| (sink, Self(driver)))
    }

    #[cfg(test)]
    pub(crate) const fn disabled() -> Self {
        Self(momo_notifications::NotificationDriver::disabled())
    }

    pub(crate) async fn run(self) {
        self.0.run().await;
    }

    pub(crate) fn spawn(self) -> NotificationHandle {
        NotificationHandle::spawn(self.run())
    }
}

/// The worker owns this handle until the transport has stopped. Sender failures close admission
/// and are logged here; they never become a business-runtime error or start a resend loop.
pub(crate) struct NotificationHandle {
    task: Option<JoinHandle<()>>,
    abort_requested: bool,
}

impl NotificationHandle {
    fn spawn(sender: impl Future<Output = ()> + Send + 'static) -> Self {
        Self {
            task: Some(tokio::spawn(sender)),
            abort_requested: false,
        }
    }

    /// Waits for one completion without moving the owned handle out before the await.
    /// Cancellation is safe; after completion this branch stays pending in a select loop.
    pub(crate) async fn completed(&mut self) {
        let Some(task) = &mut self.task else {
            return std::future::pending().await;
        };
        let result = task.await;
        self.task = None;
        if let Err(error) = result {
            if error.is_cancelled() && self.abort_requested {
                tracing::info!(event = "result_notification_sender_aborted");
            } else {
                let error_kind = if error.is_panic() {
                    "panic"
                } else {
                    "unexpected_cancellation"
                };
                tracing::error!(
                    event = "result_notification_sender_stopped",
                    error_kind,
                    "notification delivery is disabled for this worker"
                );
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn is_finished(&self) -> bool {
        self.task.as_ref().is_none_or(JoinHandle::is_finished)
    }

    fn abort(&mut self) {
        self.abort_requested = true;
        if let Some(task) = &self.task {
            task.abort();
        }
    }

    /// Producers must have dropped their sinks and reservations before this is called.
    /// The worker reserves the interval between these deadlines for observing forced shutdown.
    /// Neither a delivery timeout nor an abort changes the business shutdown result.
    pub(crate) async fn drain_until(&mut self, graceful_until: Instant, deadline: Instant) {
        if self.task.is_none() {
            return;
        }
        if time::timeout_at(graceful_until.min(deadline), self.completed())
            .await
            .is_err()
        {
            tracing::warn!(event = "result_notification_drain_expired");
            self.abort();
            // Both phases use the original worker budget. If cancellation cannot be observed
            // by its hard deadline, retain the aborted handle for runtime teardown.
            if time::timeout_at(deadline, self.completed()).await.is_err() {
                tracing::warn!(event = "result_notification_abort_expired");
            }
        }
    }
}

impl Drop for NotificationHandle {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests;
