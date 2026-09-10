//! A bounded, process-local handoff of committed snapshots. There is deliberately no replay store.

use std::{fmt, io, sync::Arc};

use futures_util::{StreamExt, stream::FuturesUnordered};
use serde::Serialize;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

mod config;
mod http;
pub(crate) mod ocr;

use config::{CONCURRENT_REQUESTS, MAXIMUM_BYTES, MAXIMUM_PENDING, MAXIMUM_WIRE_BYTES};
pub(crate) use config::{NotificationConfig, NotificationConfigError};

#[derive(Clone, Default)]
pub(crate) struct NotificationSink(Option<Arc<Admission>>);

struct Admission {
    sender: mpsc::Sender<QueuedNotification>,
    count: Arc<Semaphore>,
    bytes: Arc<Semaphore>,
}

impl fmt::Debug for NotificationSink {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NotificationSink([REDACTED])")
    }
}

pub(crate) struct NotificationDriver {
    transport: Option<(
        config::HttpConfig,
        reqwest::Client,
        mpsc::Receiver<QueuedNotification>,
    )>,
}

impl NotificationDriver {
    pub(crate) fn new(
        config: NotificationConfig,
    ) -> Result<(NotificationSink, Self), NotificationConfigError> {
        let NotificationConfig::Http(config) = config else {
            return Ok((NotificationSink::default(), Self::disabled()));
        };
        let client = config::client()?;
        let (sender, receiver) = mpsc::channel(MAXIMUM_PENDING);
        let sink = NotificationSink(Some(Arc::new(Admission {
            sender,
            count: Arc::new(Semaphore::new(MAXIMUM_PENDING)),
            bytes: Arc::new(Semaphore::new(MAXIMUM_BYTES)),
        })));
        Ok((
            sink,
            Self {
                transport: Some((config, client, receiver)),
            },
        ))
    }

    pub(crate) const fn disabled() -> Self {
        Self { transport: None }
    }

    /// Ends after all producers release their senders and all admitted requests finish. The
    /// supervisor polls this alongside business peers, under their shared shutdown deadline.
    pub(crate) async fn run(self) {
        let Some((config, client, mut receiver)) = self.transport else {
            return;
        };
        tracing::info!(event = "result_notification_sender_ready");
        let mut active = FuturesUnordered::new();
        let mut closed = false;
        while !closed || !active.is_empty() {
            tokio::select! {
                entry = receiver.recv(), if !closed && active.len() < CONCURRENT_REQUESTS => {
                    if let Some(entry) = entry {
                        active.push(http::send(&client, &config, entry));
                    } else {
                        closed = true;
                    }
                }
                () = async { active.next().await; }, if !active.is_empty() => {}
            }
        }
        tracing::info!(event = "result_notification_sender_drained");
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SkipReason {
    TransportDisabled,
    SenderClosed,
    Capacity,
    PayloadBound,
    InvalidSnapshot,
    SettingOff,
    PreparationFailed,
}

impl NotificationSink {
    /// Reserve both count and bytes before loading/building a snapshot. Permits cover preparing,
    /// waiting and active sends, and are released only when that complete lifecycle ends.
    pub(crate) fn reserve(
        &self,
        maximum_bytes: usize,
    ) -> Result<NotificationReservation, SkipReason> {
        let Some(admission) = &self.0 else {
            return Err(SkipReason::TransportDisabled);
        };
        if admission.sender.is_closed() {
            return Err(SkipReason::SenderClosed);
        }
        if maximum_bytes == 0 || maximum_bytes > MAXIMUM_WIRE_BYTES {
            return Err(SkipReason::PayloadBound);
        }
        let count = Arc::clone(&admission.count)
            .try_acquire_owned()
            .map_err(|_error| SkipReason::Capacity)?;
        let bytes = Arc::clone(&admission.bytes)
            .try_acquire_many_owned(
                u32::try_from(maximum_bytes).map_err(|_error| SkipReason::PayloadBound)?,
            )
            .map_err(|_error| SkipReason::Capacity)?;
        Ok(NotificationReservation {
            sender: admission.sender.clone(),
            count,
            bytes,
            maximum_bytes,
        })
    }
}

pub(crate) struct NotificationReservation {
    sender: mpsc::Sender<QueuedNotification>,
    count: OwnedSemaphorePermit,
    bytes: OwnedSemaphorePermit,
    maximum_bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationEnvelope<'a, T> {
    pub(crate) notification_id: String,
    pub(crate) kind: &'static str,
    pub(crate) schema_version: u8,
    pub(crate) source_job_id: &'a str,
    pub(crate) occurred_at: String,
    pub(crate) settings_generation: String,
    pub(crate) data: T,
}

impl NotificationReservation {
    pub(crate) fn prepare<T: Serialize>(
        self,
        envelope: &NotificationEnvelope<'_, T>,
    ) -> Result<PreparedNotification, SkipReason> {
        if !matches!(envelope.kind, "ocr_completed" | "analysis_completed")
            || envelope.schema_version != 1
            || !valid_source_id(envelope.source_job_id)
            || envelope.notification_id
                != format!("result:{}:{}", envelope.kind, envelope.source_job_id)
        {
            return Err(SkipReason::InvalidSnapshot);
        }
        let mut writer = BoundedJson {
            bytes: Vec::with_capacity(self.maximum_bytes),
            maximum: self.maximum_bytes,
        };
        serde_json::to_writer(&mut writer, envelope).map_err(|_error| SkipReason::PayloadBound)?;
        Ok(PreparedNotification {
            sender: self.sender,
            entry: QueuedNotification {
                id: envelope.notification_id.clone(),
                source_job_id: envelope.source_job_id.to_owned(),
                kind: envelope.kind,
                body: Some(writer.bytes),
                _count: self.count,
                _bytes: self.bytes,
                attempted: false,
                finished: false,
            },
        })
    }
}

/// Only the successful COMMIT path may release a prepared snapshot to the sender.
pub(crate) struct PreparedNotification {
    sender: mpsc::Sender<QueuedNotification>,
    entry: QueuedNotification,
}

impl PreparedNotification {
    #[cfg(test)]
    pub(crate) fn payload(&self) -> serde_json::Result<serde_json::Value> {
        serde_json::from_slice(self.entry.body.as_deref().unwrap_or_default())
    }

    pub(crate) fn dispatch(self) {
        if let Err(error) = self.sender.try_send(self.entry) {
            let mut entry = error.into_inner();
            log_skip(entry.kind, &entry.source_job_id, SkipReason::SenderClosed);
            entry.finished = true;
        }
    }
}

struct QueuedNotification {
    id: String,
    source_job_id: String,
    kind: &'static str,
    body: Option<Vec<u8>>,
    _count: OwnedSemaphorePermit,
    _bytes: OwnedSemaphorePermit,
    attempted: bool,
    finished: bool,
}

impl Drop for QueuedNotification {
    fn drop(&mut self) {
        if !self.finished {
            tracing::warn!(
                event = "result_notification_dropped",
                notification_id = %self.id,
                source_job_id = %self.source_job_id,
                kind = self.kind,
                receipt = if self.attempted { "unknown" } else { "not_started" },
            );
        }
    }
}

pub(crate) fn log_skip(kind: &'static str, job_id: &str, reason: SkipReason) {
    tracing::info!(event = "result_notification_skipped", kind, source_job_id = job_id, reason = ?reason);
}

fn valid_source_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

struct BoundedJson {
    bytes: Vec<u8>,
    maximum: usize,
}

impl io::Write for BoundedJson {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.maximum.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("notification payload bound"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests;
