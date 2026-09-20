//! Process-local notification for durable outbox work.
//!
//! The database outbox remains the delivery source of truth. Values in this module are deliberately
//! payload-free hints that let a process inspect durable work promptly after a successful commit.

pub(crate) mod coordinator;
pub(crate) mod listener;

use thiserror::Error;
use tokio::sync::mpsc;

/// A local hint authorized by a successful business transaction. The durable outbox remains
/// authoritative; a rejected operation, rollback or unknown commit cannot request a wake.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum PostCommitEffects {
    #[default]
    None,
    WakeAnalysis,
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
        Self::new(value, PostCommitEffects::None)
    }

    pub(crate) fn map<U>(self, map: impl FnOnce(T) -> U) -> ControlOutcome<U> {
        ControlOutcome::new(map(self.value), self.effects)
    }
}

pub(crate) type OutboxWakeReceiver = mpsc::Receiver<()>;

/// A payload-free signal for the analysis outbox. One pending wake covers all durable work;
/// a closed receiver is a structural failure, while a full channel means successful coalescing.
#[derive(Clone, Debug)]
pub(crate) struct PostCommitSink(mpsc::Sender<()>);

impl PostCommitSink {
    #[must_use]
    pub(crate) fn channel() -> (Self, OutboxWakeReceiver) {
        let (sender, receiver) = mpsc::channel(1);
        (Self(sender), receiver)
    }

    pub(crate) fn submit(&self, effects: PostCommitEffects) -> Result<(), PostCommitSinkClosed> {
        match effects {
            PostCommitEffects::None => Ok(()),
            PostCommitEffects::WakeAnalysis => match self.0.try_send(()) {
                Ok(()) | Err(mpsc::error::TrySendError::Full(())) => Ok(()),
                Err(mpsc::error::TrySendError::Closed(())) => Err(PostCommitSinkClosed),
            },
        }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
#[error("analysis outbox wake sink is closed")]
pub(crate) struct PostCommitSinkClosed;

#[cfg(test)]
mod tests {
    use std::{error::Error, time::Duration};

    use tokio::sync::mpsc::error::TryRecvError;

    use super::*;

    #[test]
    fn mapped_control_outcome_preserves_the_post_commit_wake() {
        let outcome = ControlOutcome::new(20_u32, PostCommitEffects::WakeAnalysis)
            .map(|value| value.to_string());

        assert_eq!(outcome.value, "20");
        assert_eq!(outcome.effects, PostCommitEffects::WakeAnalysis);
    }

    #[test]
    fn sink_coalesces_repeated_wakes_without_losing_the_registered_kind() {
        let (sink, mut wake) = PostCommitSink::channel();
        let effect = PostCommitEffects::WakeAnalysis;

        assert_eq!(sink.submit(effect), Ok(()));
        assert_eq!(sink.submit(effect), Ok(()));
        assert_eq!(wake.try_recv(), Ok(()));
        assert_eq!(wake.try_recv(), Err(TryRecvError::Empty));
    }

    #[test]
    fn sink_reports_disconnect_only_when_an_effect_needs_delivery() {
        let (sink, wake) = PostCommitSink::channel();
        drop(wake);

        assert_eq!(sink.submit(PostCommitEffects::None), Ok(()));
        assert_eq!(
            sink.submit(PostCommitEffects::WakeAnalysis),
            Err(PostCommitSinkClosed)
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
        let (sink, mut wake) = PostCommitSink::channel();
        let mut listener = listener::subscribe(&database_url, sink).await?;
        let publisher = crate::postgres::connect(&database_url).await?;
        listener.verify_notification_round_trip(&publisher).await?;
        let verified = tokio::time::timeout(Duration::from_secs(2), wake.recv()).await?;
        assert_eq!(
            verified,
            Some(()),
            "the startup route probe must reach the process-local sink"
        );

        let (shutdown_sender, shutdown) = tokio::sync::watch::channel(false);
        let listener_task = tokio::spawn(listener.run(shutdown));

        publisher
            .execute("SELECT pg_notify($1, '')", &[&listener::CHANNEL])
            .await?;
        let received = tokio::time::timeout(Duration::from_secs(2), wake.recv()).await?;
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
