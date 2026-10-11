//! A bounded, process-local handoff of committed snapshots. There is deliberately no replay store.
//!
//! Producers own notification content, database connections, transaction recovery and commit. Reserve
//! capacity before constructing content, prepare under the producer's deadline, and dispatch only
//! after a confirmed commit. The caller also owns the driver's lifetime and shutdown deadline.

use std::{fmt, io, sync::Arc};

use futures_util::{StreamExt, stream::FuturesUnordered};
use serde::Serialize;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};
use tokio_postgres::{Transaction, types::Type};

mod config;
mod envelope;
mod http;

use config::{CONCURRENT_REQUESTS, MAXIMUM_BYTES, MAXIMUM_PENDING, MAXIMUM_WIRE_BYTES};
pub use config::{NotificationConfig, NotificationConfigError};
pub use envelope::{NotificationEnvelope, NotificationKind};

/// A cloneable admission handle; its default value disables notifications.
#[derive(Clone, Default)]
pub struct NotificationSink(Option<Arc<Admission>>);

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

/// Runs the bounded HTTP sender until all producers and admitted requests finish.
pub struct NotificationDriver {
    transport: Option<(
        config::HttpConfig,
        reqwest::Client,
        mpsc::Receiver<QueuedNotification>,
    )>,
}

impl NotificationDriver {
    /// Build an admission handle and its separately supervised sender.
    ///
    /// # Errors
    /// Returns an error when the HTTP client cannot be initialized.
    pub fn new(
        config: NotificationConfig,
    ) -> Result<(NotificationSink, Self), NotificationConfigError> {
        let Some(config) = config.into_http() else {
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

    /// Create a sender that finishes immediately.
    #[must_use]
    pub const fn disabled() -> Self {
        Self { transport: None }
    }

    /// Ends after all producers release their senders and all admitted requests finish. The
    /// supervisor polls this alongside business peers, under their shared shutdown deadline.
    pub async fn run(self) {
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

/// Admission or encoding rejection; database failures remain a separate error path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NotificationRejection {
    /// The transport is disabled.
    TransportDisabled,
    /// The sender has stopped accepting notifications.
    SenderClosed,
    /// All count or byte permits are in use.
    Capacity,
    /// The reservation, serialized body or complete JSONB representation exceeds its bound.
    PayloadBound,
    /// The envelope cannot supply a valid source identity or JSONB size check.
    InvalidEnvelope,
}

impl NotificationSink {
    /// Reserve both count and bytes before loading/building a snapshot. Permits cover preparing,
    /// waiting and active sends, and are released only when that complete lifecycle ends.
    ///
    /// # Errors
    /// Rejects disabled or closed senders, invalid byte bounds, and exhausted capacity.
    pub fn reserve(
        &self,
        maximum_bytes: usize,
    ) -> Result<NotificationReservation, NotificationRejection> {
        let Some(admission) = &self.0 else {
            return Err(NotificationRejection::TransportDisabled);
        };
        if admission.sender.is_closed() {
            return Err(NotificationRejection::SenderClosed);
        }
        if maximum_bytes == 0 || maximum_bytes > MAXIMUM_WIRE_BYTES {
            return Err(NotificationRejection::PayloadBound);
        }
        let count = Arc::clone(&admission.count)
            .try_acquire_owned()
            .map_err(|_error| NotificationRejection::Capacity)?;
        let bytes = Arc::clone(&admission.bytes)
            .try_acquire_many_owned(
                u32::try_from(maximum_bytes)
                    .map_err(|_error| NotificationRejection::PayloadBound)?,
            )
            .map_err(|_error| NotificationRejection::Capacity)?;
        Ok(NotificationReservation {
            sender: admission.sender.clone(),
            count,
            bytes,
            maximum_bytes,
        })
    }
}

/// Count and byte permits held while a producer prepares its notification.
pub struct NotificationReservation {
    sender: mpsc::Sender<QueuedNotification>,
    count: OwnedSemaphorePermit,
    bytes: OwnedSemaphorePermit,
    maximum_bytes: usize,
}

impl NotificationReservation {
    /// Check the complete wire snapshot using the same JSONB text representation as Summit.
    /// Call inside the producer's recoverable preparation deadline; no prepared send escapes
    /// on a byte overflow, database failure or timeout. This does not commit the transaction.
    ///
    /// # Errors
    /// The outer error preserves PostgreSQL failures for the caller's transaction recovery.
    /// The inner error rejects invalid envelopes or snapshots exceeding the byte bounds.
    pub async fn prepare_in<T: Serialize + Sync>(
        self,
        transaction: &Transaction<'_>,
        envelope: &NotificationEnvelope<'_, T>,
    ) -> Result<Result<PreparedNotification, NotificationRejection>, tokio_postgres::Error> {
        let body = match self.encode(envelope) {
            Ok(body) => body,
            Err(reason) => return Ok(Err(reason)),
        };
        let (Ok(text), Ok(maximum)) = (
            std::str::from_utf8(&body),
            i32::try_from(envelope.maximum_jsonb_bytes()),
        ) else {
            return Ok(Err(NotificationRejection::InvalidEnvelope));
        };
        // JSONB adds separators and expands numeric exponents. Wire bytes alone cannot prove
        // the consumer's bound; PostgreSQL owns this representation instead of a second codec.
        let row = Box::pin(transaction.query_typed_one(
            "SELECT octet_length($1::jsonb::text) <= $2 AS within_bound",
            &[(&text, Type::TEXT), (&maximum, Type::INT4)],
        ))
        .await?;
        if !row.try_get::<_, bool>("within_bound")? {
            return Ok(Err(NotificationRejection::PayloadBound));
        }
        Ok(Ok(self.finish(envelope, body)))
    }

    fn encode<T: Serialize>(
        &self,
        envelope: &NotificationEnvelope<'_, T>,
    ) -> Result<Vec<u8>, NotificationRejection> {
        if !valid_source_id(envelope.source_job_id()) {
            return Err(NotificationRejection::InvalidEnvelope);
        }
        let mut writer = BoundedJson {
            bytes: Vec::new(),
            maximum: self.maximum_bytes,
        };
        serde_json::to_writer(&mut writer, envelope)
            .map_err(|_error| NotificationRejection::PayloadBound)?;
        Ok(writer.bytes)
    }

    fn finish<T>(
        self,
        envelope: &NotificationEnvelope<'_, T>,
        body: Vec<u8>,
    ) -> PreparedNotification {
        PreparedNotification {
            sender: self.sender,
            entry: QueuedNotification {
                id: envelope.notification_id().to_owned(),
                source_job_id: envelope.source_job_id().to_owned(),
                kind: envelope.kind(),
                body: Some(body),
                _count: self.count,
                _bytes: self.bytes,
                attempted: false,
                finished: false,
            },
        }
    }

    /// Encode a fixture using the production wire checks, without a PostgreSQL JSONB check.
    ///
    /// # Errors
    /// Rejects an invalid source identity or a body exceeding the reserved bytes.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn prepare_for_test<T: Serialize>(
        self,
        envelope: &NotificationEnvelope<'_, T>,
    ) -> Result<PreparedNotification, NotificationRejection> {
        let body = self.encode(envelope)?;
        Ok(self.finish(envelope, body))
    }
}

/// A frozen snapshot holding admission permits until dispatch or drop.
///
/// This value is not proof of a commit: only the producer's successful COMMIT path may dispatch it.
pub struct PreparedNotification {
    sender: mpsc::Sender<QueuedNotification>,
    entry: QueuedNotification,
}

impl PreparedNotification {
    /// Decode a prepared fixture for assertions.
    ///
    /// # Errors
    /// Returns an error if the prepared body is not JSON.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn payload(&self) -> serde_json::Result<serde_json::Value> {
        serde_json::from_slice(self.entry.body.as_deref().unwrap_or_default())
    }

    /// Hand off without waiting for HTTP. Call only after the business commit has succeeded.
    pub fn dispatch(self) {
        if let Err(error) = self.sender.try_send(self.entry) {
            let mut entry = error.into_inner();
            tracing::info!(event = "result_notification_skipped", kind = entry.kind,
                source_job_id = %entry.source_job_id, reason = ?NotificationRejection::SenderClosed);
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
        let required = self.bytes.len() + bytes.len();
        if required > self.bytes.capacity() {
            // Typical snapshots are much smaller than their admission allowance. Grow only as
            // serialization needs memory, and cap geometric growth at the reserved byte bound.
            // Vec's implicit growth could otherwise allocate beyond a non-power-of-two limit.
            let capacity = self
                .bytes
                .capacity()
                .saturating_mul(2)
                .max(256)
                .max(required)
                .min(self.maximum);
            self.bytes
                .try_reserve_exact(capacity - self.bytes.len())
                .map_err(|_error| io::Error::other("notification allocation failed"))?;
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
