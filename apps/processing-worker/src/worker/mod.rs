//! Process-local notification for durable processing jobs.
//!
//! Database job rows remain the source of truth. Values in this module are deliberately
//! payload-free hints that let a process inspect durable work promptly after a successful commit.

mod plan;
mod runtime;
pub(crate) use plan::WorkerRuntimePlan;
mod selection;
#[cfg(test)]
pub(crate) use runtime::run_ocr_only;
pub(crate) use runtime::{WorkerError, run};
pub(crate) mod wake_http;

use thiserror::Error;
use tokio::sync::mpsc;

/// Shared supervisors align across restarts on UTC :00 and :30. Known job deadlines may wake earlier.
pub(crate) fn until_supervisor(now: std::time::SystemTime) -> std::time::Duration {
    use std::time::{Duration, UNIX_EPOCH};
    let interval = Duration::from_mins(30);
    let elapsed = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    interval.saturating_sub(Duration::new(
        elapsed.as_secs() % interval.as_secs(),
        elapsed.subsec_nanos(),
    ))
}

/// A local hint authorized by a successful business transaction. Durable job rows remain
/// authoritative; a rejected operation, rollback or unknown commit cannot request a wake.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum PostCommitEffects {
    #[default]
    None,
    WakeJobs,
}

/// Couples a durable control result with the local work hints that become valid after its commit.
///
/// Callers submit `effects` after a confirmed commit so the scheduler can inspect durable work.
/// Deadline scans also recover work when a notification is lost.
#[derive(Debug, Eq, PartialEq)]
#[must_use = "post-commit effects must be submitted to the scheduler"]
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

pub(crate) type WakeReceiver = mpsc::Receiver<()>;

/// A payload-free signal for the processing scheduler. One pending wake covers all durable work;
/// a closed receiver is a structural failure, while a full channel means successful coalescing.
#[derive(Clone, Debug)]
pub(crate) struct PostCommitSink(mpsc::Sender<()>);

impl PostCommitSink {
    #[must_use]
    pub(crate) fn channel() -> (Self, WakeReceiver) {
        let (sender, receiver) = mpsc::channel(1);
        (Self(sender), receiver)
    }

    pub(crate) fn submit(&self, effects: PostCommitEffects) -> Result<(), PostCommitSinkClosed> {
        match effects {
            PostCommitEffects::None => Ok(()),
            PostCommitEffects::WakeJobs => match self.0.try_send(()) {
                Ok(()) | Err(mpsc::error::TrySendError::Full(())) => Ok(()),
                Err(mpsc::error::TrySendError::Closed(())) => Err(PostCommitSinkClosed),
            },
        }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
#[error("processing scheduler wake sink is closed")]
pub(crate) struct PostCommitSinkClosed;

#[cfg(test)]
mod tests {

    use tokio::sync::mpsc::error::TryRecvError;

    use super::*;

    #[test]
    fn supervisor_deadline_follows_wall_clock_boundaries() {
        use std::time::{Duration, UNIX_EPOCH};
        for (elapsed, remaining) in [
            (Duration::ZERO, Duration::from_mins(30)),
            (Duration::from_mins(17), Duration::from_mins(13)),
            (Duration::from_millis(1_799_999), Duration::from_millis(1)),
            (Duration::from_mins(30), Duration::from_mins(30)),
            (Duration::from_mins(61), Duration::from_mins(29)),
        ] {
            assert_eq!(
                until_supervisor(UNIX_EPOCH + elapsed),
                remaining,
                "{elapsed:?}"
            );
        }
    }

    #[test]
    fn mapped_control_outcome_preserves_the_post_commit_wake() {
        let outcome =
            ControlOutcome::new(20_u32, PostCommitEffects::WakeJobs).map(|value| value.to_string());

        assert_eq!(outcome.value, "20");
        assert_eq!(outcome.effects, PostCommitEffects::WakeJobs);
    }

    #[test]
    fn sink_coalesces_repeated_wakes_without_losing_the_registered_kind() {
        let (sink, mut wake) = PostCommitSink::channel();
        let effect = PostCommitEffects::WakeJobs;

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
            sink.submit(PostCommitEffects::WakeJobs),
            Err(PostCommitSinkClosed)
        );
    }
}
