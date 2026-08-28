//! Event-driven scheduling shared by process-local outbox drivers.

use std::{error::Error, future::Future, time::Duration};

use thiserror::Error;
use tokio::{
    sync::{mpsc, watch},
    time::Instant,
};
use tracing::{info, warn};

use super::OutboxWakeReceiver;

const MAX_CONSECUTIVE_BATCHES: usize = 100;
const RETRY_DELAYS: [Duration; 7] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(16),
    Duration::from_secs(32),
    Duration::from_mins(1),
];

/// Classifies whether a driver failure belongs to dependency recovery or the runtime boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DriverFailureKind {
    Recoverable,
    Structural,
}

/// The bounded result of one driver batch.
///
/// Progress asks the coordinator to continue draining. Idle carries the earliest known retry,
/// claim-expiry, or semantic-redelivery deadline and guarantees that no current durable work was
/// found by the batch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DrainBatch {
    state: DrainBatchState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DrainBatchState {
    Progress,
    Idle { next_wake_at: Option<Instant> },
}

impl DrainBatch {
    #[must_use]
    pub(crate) const fn progress() -> Self {
        Self {
            state: DrainBatchState::Progress,
        }
    }

    #[must_use]
    pub(crate) const fn idle(next_wake_at: Option<Instant>) -> Self {
        Self {
            state: DrainBatchState::Idle { next_wake_at },
        }
    }
}

/// Domain adapter driven until its durable outbox has no immediately actionable work.
///
/// Implementations own SQL, payload serialization, and publish state transitions. The coordinator
/// owns only demand, deadlines, bounded fairness, and dependency-error backoff.
pub(crate) trait OutboxDriver: Send {
    type Error: Error + Send + Sync + 'static;

    fn drain_batch(&mut self) -> impl Future<Output = Result<DrainBatch, Self::Error>> + Send;

    fn failure_kind(error: &Self::Error) -> DriverFailureKind;

    fn safe_error_kind(error: &Self::Error) -> &'static str;
}

/// Runs one outbox kind from startup demand to event-driven idle.
///
/// There is no periodic cold sweep. After a successful idle result, the driver is not called again
/// until a local wake or the driver's earliest one-shot deadline. Recoverable failures retain
/// demand and retry on the fixed 1/2/4/8/16/32/60-second schedule.
///
/// # Errors
///
/// Returns an error for a disconnected coordination channel, deadline overflow, or a structural
/// driver failure. Recoverable driver failures are retried internally.
pub(crate) async fn run<D>(
    driver: D,
    wake: OutboxWakeReceiver,
    shutdown: watch::Receiver<bool>,
) -> Result<(), CoordinatorError<D::Error>>
where
    D: OutboxDriver,
{
    run_with_clock(driver, wake, shutdown, TokioClock).await
}

#[derive(Debug, Error)]
pub(crate) enum CoordinatorError<E>
where
    E: Error + 'static,
{
    #[error("outbox wake channel closed unexpectedly")]
    WakeChannelClosed,
    #[error("outbox shutdown channel closed unexpectedly")]
    ShutdownChannelClosed,
    #[error("outbox retry deadline exceeds the Tokio clock bound")]
    DeadlineOverflow,
    #[error("outbox driver encountered a structural failure")]
    Driver(#[source] E),
}

#[derive(Clone, Copy)]
struct TokioClock;

trait CoordinatorClock: Clone + Send + Sync + 'static {
    fn now(&self) -> Instant;

    fn sleep_until(&self, deadline: Instant) -> impl Future<Output = ()> + Send;
}

impl CoordinatorClock for TokioClock {
    fn now(&self) -> Instant {
        Instant::now()
    }

    fn sleep_until(&self, deadline: Instant) -> impl Future<Output = ()> + Send {
        tokio::time::sleep_until(deadline)
    }
}

async fn run_with_clock<D, C>(
    mut driver: D,
    mut wake: OutboxWakeReceiver,
    mut shutdown: watch::Receiver<bool>,
    clock: C,
) -> Result<(), CoordinatorError<D::Error>>
where
    D: OutboxDriver,
    C: CoordinatorClock,
{
    let kind = wake.kind;
    let mut demand = true;
    let mut next_wake_at = None;
    let mut retry_at = None;
    let mut consecutive_failures = 0_usize;

    loop {
        if *shutdown.borrow() {
            return Ok(());
        }

        if let Some(deadline) = retry_at {
            match wait_for_event(&mut wake, &mut shutdown, Some(deadline), &clock).await? {
                WaitEvent::Wake => continue,
                WaitEvent::Deadline => retry_at = None,
                WaitEvent::Shutdown => return Ok(()),
            }
        }

        if !demand {
            match wait_for_event(&mut wake, &mut shutdown, next_wake_at, &clock).await? {
                WaitEvent::Wake | WaitEvent::Deadline => {}
                WaitEvent::Shutdown => return Ok(()),
            }
        }

        consume_coalesced_wake(&mut wake)?;
        match drain_until_pause(&mut driver, &shutdown).await {
            DrainCycle::Idle { next } => {
                consecutive_failures = 0;
                demand = false;
                next_wake_at = next;
                info!(
                    event = "outbox_coordinator_idle",
                    outbox_kind = kind.wire(),
                    has_deadline = next_wake_at.is_some(),
                    "outbox coordinator drained durable work"
                );
            }
            DrainCycle::BudgetExhausted => {
                demand = true;
                tokio::task::yield_now().await;
            }
            DrainCycle::Shutdown => return Ok(()),
            DrainCycle::Failure(error) => match D::failure_kind(&error) {
                DriverFailureKind::Recoverable => {
                    consecutive_failures = consecutive_failures.saturating_add(1);
                    let delay = retry_delay(consecutive_failures);
                    retry_at = Some(
                        clock
                            .now()
                            .checked_add(delay)
                            .ok_or(CoordinatorError::DeadlineOverflow)?,
                    );
                    demand = true;
                    next_wake_at = None;
                    warn!(
                        event = "outbox_coordinator_backoff",
                        outbox_kind = kind.wire(),
                        error_kind = D::safe_error_kind(&error),
                        failure_count = consecutive_failures,
                        retry_after_seconds = delay.as_secs(),
                        "outbox coordinator deferred a recoverable driver failure"
                    );
                }
                DriverFailureKind::Structural => return Err(CoordinatorError::Driver(error)),
            },
        }
    }
}

enum DrainCycle<E> {
    Idle { next: Option<Instant> },
    BudgetExhausted,
    Shutdown,
    Failure(E),
}

async fn drain_until_pause<D>(
    driver: &mut D,
    shutdown: &watch::Receiver<bool>,
) -> DrainCycle<D::Error>
where
    D: OutboxDriver,
{
    for _batch in 0..MAX_CONSECUTIVE_BATCHES {
        if *shutdown.borrow() {
            return DrainCycle::Shutdown;
        }
        let batch = match driver.drain_batch().await {
            Ok(batch) => batch,
            Err(error) => return DrainCycle::Failure(error),
        };
        if *shutdown.borrow() {
            return DrainCycle::Shutdown;
        }
        match batch.state {
            DrainBatchState::Progress => {}
            DrainBatchState::Idle { next_wake_at } => {
                return DrainCycle::Idle { next: next_wake_at };
            }
        }
    }
    DrainCycle::BudgetExhausted
}

fn consume_coalesced_wake<E>(wake: &mut OutboxWakeReceiver) -> Result<(), CoordinatorError<E>>
where
    E: Error + 'static,
{
    match wake.receiver.try_recv() {
        Ok(()) | Err(mpsc::error::TryRecvError::Empty) => Ok(()),
        Err(mpsc::error::TryRecvError::Disconnected) => Err(CoordinatorError::WakeChannelClosed),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WaitEvent {
    Wake,
    Deadline,
    Shutdown,
}

async fn wait_for_event<E, C>(
    wake: &mut OutboxWakeReceiver,
    shutdown: &mut watch::Receiver<bool>,
    deadline: Option<Instant>,
    clock: &C,
) -> Result<WaitEvent, CoordinatorError<E>>
where
    E: Error + 'static,
    C: CoordinatorClock,
{
    loop {
        if *shutdown.borrow() {
            return Ok(WaitEvent::Shutdown);
        }
        let event = match deadline {
            Some(deadline) => {
                tokio::select! {
                    biased;
                    changed = shutdown.changed() => changed_event(changed, shutdown)?,
                    signal = wake.receiver.recv() => wake_event(signal)?,
                    () = clock.sleep_until(deadline) => WaitEvent::Deadline,
                }
            }
            None => {
                tokio::select! {
                    biased;
                    changed = shutdown.changed() => changed_event(changed, shutdown)?,
                    signal = wake.receiver.recv() => wake_event(signal)?,
                }
            }
        };
        if event != WaitEvent::Shutdown || *shutdown.borrow() {
            return Ok(event);
        }
    }
}

fn changed_event<E>(
    changed: Result<(), watch::error::RecvError>,
    shutdown: &watch::Receiver<bool>,
) -> Result<WaitEvent, CoordinatorError<E>>
where
    E: Error + 'static,
{
    changed.map_err(|_closed| CoordinatorError::ShutdownChannelClosed)?;
    if *shutdown.borrow() {
        Ok(WaitEvent::Shutdown)
    } else {
        Ok(WaitEvent::Deadline)
    }
}

fn wake_event<E>(signal: Option<()>) -> Result<WaitEvent, CoordinatorError<E>>
where
    E: Error + 'static,
{
    signal
        .map(|()| WaitEvent::Wake)
        .ok_or(CoordinatorError::WakeChannelClosed)
}

fn retry_delay(consecutive_failures: usize) -> Duration {
    RETRY_DELAYS
        .get(consecutive_failures.saturating_sub(1))
        .copied()
        .unwrap_or(Duration::from_mins(1))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
    };

    use thiserror::Error;
    use tokio::sync::{Notify, mpsc};

    use super::*;
    use crate::outbox::{OutboxKind, PostCommitEffects, PostCommitSink};

    #[derive(Clone)]
    struct ManualClock {
        now: Arc<Mutex<Instant>>,
        advanced: Arc<Notify>,
        sleep_events: mpsc::UnboundedSender<Instant>,
    }

    impl ManualClock {
        fn at(now: Instant) -> (Self, mpsc::UnboundedReceiver<Instant>) {
            let (sleep_events, observed_sleeps) = mpsc::unbounded_channel();
            (
                Self {
                    now: Arc::new(Mutex::new(now)),
                    advanced: Arc::new(Notify::new()),
                    sleep_events,
                },
                observed_sleeps,
            )
        }

        fn advance(&self, duration: Duration) {
            let mut now = self
                .now
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(advanced) = now.checked_add(duration) {
                *now = advanced;
            }
            drop(now);
            self.advanced.notify_waiters();
        }
    }

    impl CoordinatorClock for ManualClock {
        fn now(&self) -> Instant {
            *self
                .now
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
        }

        fn sleep_until(&self, deadline: Instant) -> impl Future<Output = ()> + Send {
            let clock = self.clone();
            async move {
                loop {
                    let advanced = clock.advanced.notified();
                    if clock.now() >= deadline {
                        return;
                    }
                    assert!(
                        clock.sleep_events.send(deadline).is_ok(),
                        "sleep observer must remain connected"
                    );
                    advanced.await;
                }
            }
        }
    }

    #[derive(Debug, Error)]
    #[error("scripted driver failure")]
    struct ScriptedError {
        kind: DriverFailureKind,
    }

    struct ScriptedDriver {
        drain_events: mpsc::UnboundedSender<()>,
        batches: VecDeque<Result<DrainBatch, ScriptedError>>,
    }

    impl ScriptedDriver {
        fn new(
            batches: impl IntoIterator<Item = Result<DrainBatch, ScriptedError>>,
        ) -> (Self, mpsc::UnboundedReceiver<()>) {
            let (drain_events, observed_drains) = mpsc::unbounded_channel();
            (
                Self {
                    drain_events,
                    batches: batches.into_iter().collect(),
                },
                observed_drains,
            )
        }
    }

    impl OutboxDriver for ScriptedDriver {
        type Error = ScriptedError;

        fn drain_batch(&mut self) -> impl Future<Output = Result<DrainBatch, Self::Error>> + Send {
            let batch = self
                .batches
                .pop_front()
                .unwrap_or(Ok(DrainBatch::idle(None)));
            let drain_events = self.drain_events.clone();
            async move {
                assert!(
                    drain_events.send(()).is_ok(),
                    "drain observer must remain connected"
                );
                batch
            }
        }

        fn failure_kind(error: &Self::Error) -> DriverFailureKind {
            error.kind
        }

        fn safe_error_kind(_error: &Self::Error) -> &'static str {
            "scripted"
        }
    }

    async fn observe_drain(events: &mut mpsc::UnboundedReceiver<()>) {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv()).await;
        assert!(
            event.is_ok(),
            "timed out waiting for the coordinator to request a drain"
        );
        assert_eq!(
            event.ok().flatten(),
            Some(()),
            "coordinator did not request the expected drain"
        );
    }

    async fn observe_sleep(events: &mut mpsc::UnboundedReceiver<Instant>) -> Option<Instant> {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv()).await;
        assert!(
            event.is_ok(),
            "timed out waiting for the coordinator to enter deadline sleep"
        );
        event.ok().flatten()
    }

    #[tokio::test]
    async fn startup_drains_once_then_waits_for_a_signal_without_periodic_calls() {
        let start = Instant::now();
        let (clock, mut sleeps) = ManualClock::at(start);
        let deadline = start.checked_add(Duration::from_mins(1)).unwrap_or(start);
        let (driver, mut drains) = ScriptedDriver::new([
            Ok(DrainBatch::idle(Some(deadline))),
            Ok(DrainBatch::idle(None)),
        ]);
        let (sink, wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        let (shutdown_sender, shutdown) = watch::channel(false);
        let task = tokio::spawn(run_with_clock(driver, wake, shutdown, clock.clone()));

        observe_drain(&mut drains).await;
        assert_eq!(observe_sleep(&mut sleeps).await, Some(deadline));
        clock.advance(Duration::from_secs(59));
        assert_eq!(observe_sleep(&mut sleeps).await, Some(deadline));
        assert_eq!(
            drains.try_recv(),
            Err(mpsc::error::TryRecvError::Empty),
            "idle coordinator must not poll before its explicit deadline"
        );

        let effect = PostCommitEffects::wake(OutboxKind::SeriesAnalysis);
        assert_eq!(sink.submit(effect), Ok(()));
        observe_drain(&mut drains).await;

        assert_eq!(shutdown_sender.send(true), Ok(()));
        assert!(matches!(task.await, Ok(Ok(()))));
    }

    #[tokio::test]
    async fn earliest_one_shot_deadline_wakes_an_idle_driver() {
        let start = Instant::now();
        let (clock, mut sleeps) = ManualClock::at(start);
        let deadline = start.checked_add(Duration::from_secs(10)).unwrap_or(start);
        let (driver, mut drains) = ScriptedDriver::new([
            Ok(DrainBatch::idle(Some(deadline))),
            Ok(DrainBatch::idle(None)),
        ]);
        let (_sink, wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        let (shutdown_sender, shutdown) = watch::channel(false);
        let task = tokio::spawn(run_with_clock(driver, wake, shutdown, clock.clone()));

        observe_drain(&mut drains).await;
        assert_eq!(observe_sleep(&mut sleeps).await, Some(deadline));
        clock.advance(Duration::from_secs(9));
        assert_eq!(observe_sleep(&mut sleeps).await, Some(deadline));
        assert_eq!(
            drains.try_recv(),
            Err(mpsc::error::TryRecvError::Empty),
            "driver must remain idle before the deadline"
        );

        clock.advance(Duration::from_secs(1));
        observe_drain(&mut drains).await;
        assert_eq!(shutdown_sender.send(true), Ok(()));
        assert!(matches!(task.await, Ok(Ok(()))));
    }

    #[tokio::test]
    async fn recoverable_failure_holds_wake_until_backoff_deadline() {
        let start = Instant::now();
        let (clock, mut sleeps) = ManualClock::at(start);
        let retry_at = start.checked_add(Duration::from_secs(1)).unwrap_or(start);
        let (driver, mut drains) = ScriptedDriver::new([
            Err(ScriptedError {
                kind: DriverFailureKind::Recoverable,
            }),
            Ok(DrainBatch::idle(None)),
        ]);
        let (sink, wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        let (shutdown_sender, shutdown) = watch::channel(false);
        let task = tokio::spawn(run_with_clock(driver, wake, shutdown, clock.clone()));

        observe_drain(&mut drains).await;
        assert_eq!(observe_sleep(&mut sleeps).await, Some(retry_at));
        assert_eq!(
            sink.submit(PostCommitEffects::wake(OutboxKind::SeriesAnalysis)),
            Ok(())
        );
        assert_eq!(observe_sleep(&mut sleeps).await, Some(retry_at));
        assert_eq!(
            drains.try_recv(),
            Err(mpsc::error::TryRecvError::Empty),
            "wake must not bypass backoff"
        );

        clock.advance(Duration::from_millis(999));
        assert_eq!(observe_sleep(&mut sleeps).await, Some(retry_at));
        assert_eq!(
            drains.try_recv(),
            Err(mpsc::error::TryRecvError::Empty),
            "driver must remain idle before backoff expires"
        );

        clock.advance(Duration::from_millis(1));
        observe_drain(&mut drains).await;
        assert_eq!(shutdown_sender.send(true), Ok(()));
        assert!(matches!(task.await, Ok(Ok(()))));
    }

    #[test]
    fn retry_schedule_is_capped_after_sixty_seconds() {
        let actual = (1..=9).map(retry_delay).collect::<Vec<_>>();

        assert_eq!(
            actual,
            [1_u64, 2, 4, 8, 16, 32, 60, 60, 60]
                .into_iter()
                .map(Duration::from_secs)
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn structural_driver_failure_stops_the_coordinator() {
        let (driver, _drains) = ScriptedDriver::new([Err(ScriptedError {
            kind: DriverFailureKind::Structural,
        })]);
        let (_sink, wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
        let (_shutdown_sender, shutdown) = watch::channel(false);

        assert!(matches!(
            run(driver, wake, shutdown).await,
            Err(CoordinatorError::Driver(ScriptedError {
                kind: DriverFailureKind::Structural
            }))
        ));
    }
}
