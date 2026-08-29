//! Process-local notification for durable outbox work.
//!
//! The database outbox remains the delivery source of truth. Values in this module are deliberately
//! payload-free hints that let a process inspect durable work promptly after a successful commit.

pub(crate) mod coordinator;

use thiserror::Error;
use tokio::sync::mpsc;

const WAKE_CHANNEL_CAPACITY: usize = 1;
const SERIES_ANALYSIS_WAKE_BIT: u8 = 1;

/// Identifies durable outbox state that the current process can write and drain.
///
/// A kind routes a payload-free local signal; it is not a queue name or a durable delivery record.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutboxKind {
    SeriesAnalysis,
}

impl OutboxKind {
    #[must_use]
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::SeriesAnalysis => "series_analysis",
        }
    }

    const fn wake_bit(self) -> u8 {
        match self {
            Self::SeriesAnalysis => SERIES_ANALYSIS_WAKE_BIT,
        }
    }
}

/// A compact union of outbox kinds made durable by one committed control operation.
///
/// The set contains no job, outbox, or payload identity. Combining effects is therefore idempotent
/// and cannot replace inspection of the database outbox.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct OutboxWakeSet(u8);

impl OutboxWakeSet {
    #[must_use]
    pub(crate) const fn empty() -> Self {
        Self(0)
    }

    #[must_use]
    pub(crate) const fn one(kind: OutboxKind) -> Self {
        Self(kind.wake_bit())
    }

    #[must_use]
    pub(crate) const fn contains(self, kind: OutboxKind) -> bool {
        self.0 & kind.wake_bit() != 0
    }
}

/// Non-durable work hints produced only after the transaction that created the outbox work commits.
///
/// A rollback, rejected mutation, or unknown commit result must return an empty value. Losing this
/// value is safe because startup and global recovery inspect the durable database outbox.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct PostCommitEffects {
    pub(crate) outbox_wakes: OutboxWakeSet,
}

impl PostCommitEffects {
    #[must_use]
    pub(crate) const fn empty() -> Self {
        Self {
            outbox_wakes: OutboxWakeSet::empty(),
        }
    }

    #[must_use]
    pub(crate) const fn wake(kind: OutboxKind) -> Self {
        Self {
            outbox_wakes: OutboxWakeSet::one(kind),
        }
    }
}

/// Couples a durable control result with the local work hints that become valid after its commit.
///
/// Callers must submit `effects` before advancing the source queue delivery disposition. The value
/// does not imply that Redis publication has completed.
#[derive(Debug, Eq, PartialEq)]
#[must_use = "post-commit effects must be submitted before advancing queue disposition"]
pub(crate) struct ControlOutcome<T> {
    pub(crate) value: T,
    pub(crate) effects: PostCommitEffects,
}

impl<T> ControlOutcome<T> {
    pub(crate) const fn new(value: T, effects: PostCommitEffects) -> Self {
        Self { value, effects }
    }

    pub(crate) const fn without_effects(value: T) -> Self {
        Self::new(value, PostCommitEffects::empty())
    }

    pub(crate) fn map<U>(self, map: impl FnOnce(T) -> U) -> ControlOutcome<U> {
        ControlOutcome::new(map(self.value), self.effects)
    }
}

/// The coordinator side of one registered outbox-kind signal.
///
/// The channel is intentionally bounded to one item: one pending signal is enough to make the
/// coordinator inspect all durable work for the kind.
pub(crate) struct OutboxWakeReceiver {
    kind: OutboxKind,
    receiver: mpsc::Receiver<()>,
}

/// A cloneable, payload-free post-commit signal endpoint for one registered outbox kind.
///
/// A full channel is successful coalescing. A closed channel is a structural runtime failure: the
/// committed database state remains valid, but the parent runtime must restart its coordination
/// boundary instead of pretending that local delivery was scheduled.
#[derive(Clone, Debug)]
pub(crate) struct PostCommitSink {
    kind: OutboxKind,
    sender: mpsc::Sender<()>,
}

impl PostCommitSink {
    #[must_use]
    pub(crate) fn channel(kind: OutboxKind) -> (Self, OutboxWakeReceiver) {
        let (sender, receiver) = mpsc::channel(WAKE_CHANNEL_CAPACITY);
        (Self { kind, sender }, OutboxWakeReceiver { kind, receiver })
    }

    /// Submits committed effects without waiting for capacity.
    ///
    /// This method never transports business identity. Repeated submissions while a signal is
    /// pending collapse into the existing signal, while a disconnected coordinator is reported.
    ///
    /// # Errors
    ///
    /// Returns [`PostCommitSinkClosed`] when the registered coordinator no longer owns its receiver.
    pub(crate) fn submit(&self, effects: PostCommitEffects) -> Result<(), PostCommitSinkClosed> {
        if !effects.outbox_wakes.contains(self.kind) {
            return Ok(());
        }
        match self.sender.try_send(()) {
            Ok(()) | Err(mpsc::error::TrySendError::Full(())) => Ok(()),
            Err(mpsc::error::TrySendError::Closed(())) => {
                Err(PostCommitSinkClosed { kind: self.kind })
            }
        }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
#[error("post-commit outbox sink is closed for {kind:?}")]
pub(crate) struct PostCommitSinkClosed {
    kind: OutboxKind,
}

#[cfg(test)]
mod tests {
    use std::{error::Error, time::Duration};

    use tokio::sync::mpsc::error::TryRecvError;

    use super::*;

    #[test]
    fn mapped_control_outcome_preserves_the_post_commit_wake() {
        let outcome =
            ControlOutcome::new(20_u32, PostCommitEffects::wake(OutboxKind::SeriesAnalysis))
                .map(|value| value.to_string());

        assert_eq!(outcome.value, "20");
        assert!(
            outcome
                .effects
                .outbox_wakes
                .contains(OutboxKind::SeriesAnalysis)
        );
    }

    #[test]
    fn sink_coalesces_repeated_wakes_without_losing_the_registered_kind() {
        let (sink, mut wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        let effect = PostCommitEffects::wake(OutboxKind::SeriesAnalysis);

        assert_eq!(sink.submit(effect), Ok(()));
        assert_eq!(sink.submit(effect), Ok(()));
        assert_eq!(wake.kind, OutboxKind::SeriesAnalysis);
        assert_eq!(wake.receiver.try_recv(), Ok(()));
        assert_eq!(wake.receiver.try_recv(), Err(TryRecvError::Empty));
    }

    #[test]
    fn sink_reports_disconnect_only_when_an_effect_needs_delivery() {
        let (sink, wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        drop(wake);

        assert_eq!(sink.submit(PostCommitEffects::empty()), Ok(()));
        assert_eq!(
            sink.submit(PostCommitEffects::wake(OutboxKind::SeriesAnalysis)),
            Err(PostCommitSinkClosed {
                kind: OutboxKind::SeriesAnalysis
            })
        );
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_OUTBOX_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the isolated PostgreSQL listener scenario keeps its cross-process boundary visible"
    )]
    async fn subscribed_postgres_listener_delivers_the_next_commit_hint()
    -> Result<(), Box<dyn Error + Send + Sync>> {
        let database_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_DATABASE_URL")?;
        let (sink, mut wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        let mut listener =
            crate::postgres::subscribe_to_series_analysis_outbox(&database_url, sink).await?;
        let publisher = crate::postgres::connect(&database_url).await?;
        listener.verify_notification_round_trip(&publisher).await?;
        let verified = tokio::time::timeout(Duration::from_secs(2), wake.receiver.recv()).await?;
        assert_eq!(
            verified,
            Some(()),
            "the startup route probe must reach the process-local sink"
        );

        let (shutdown_sender, shutdown) = tokio::sync::watch::channel(false);
        let listener_task = tokio::spawn(listener.run(shutdown));

        publisher
            .execute(
                "SELECT pg_notify($1, '')",
                &[&crate::postgres::SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL],
            )
            .await?;
        let received = tokio::time::timeout(Duration::from_secs(2), wake.receiver.recv()).await?;
        assert_eq!(
            received,
            Some(()),
            "the first commit after subscription must promptly reach the local sink"
        );

        assert_eq!(shutdown_sender.send(true), Ok(()));
        assert!(matches!(listener_task.await, Ok(Ok(()))));
        Ok(())
    }
}
