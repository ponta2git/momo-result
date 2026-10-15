//! Finite submission reconciliation, independent of the heavy image/analysis slot.

use super::{
    PAGE_SIZE, SAFETY_INTERVAL,
    control::{self, Settlement},
};
use crate::{
    busy_retry::{BusyRetry, BusyRetryBudget},
    notifications::NotificationSink,
    postgres,
};
use std::{collections::VecDeque, time::Duration};
use thiserror::Error;
use tokio::{sync::watch, time};
use tokio_postgres::{Client, types::Type};

#[cfg(test)]
pub(crate) struct Config {
    pub(crate) database_url: String,
    pub(crate) listener_database_url: String,
    pub(crate) finalization_timeout: Duration,
}

#[derive(Debug, Error)]
pub(crate) enum RuntimeError {
    #[error("OCR submission dependency failed ({0})")]
    Dependency(&'static str),
    #[error("OCR submission control failed")]
    Control(#[from] control::SubmissionError),
    #[error("OCR submission protocol failed ({0})")]
    Protocol(&'static str),
}

#[derive(Clone)]
struct Schedule {
    safety_interval: Duration,
    #[cfg(test)]
    observed: Option<watch::Sender<u64>>,
    #[cfg(test)]
    rechecked: Option<watch::Sender<u64>>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            safety_interval: SAFETY_INTERVAL,
            #[cfg(test)]
            observed: None,
            #[cfg(test)]
            rechecked: None,
        }
    }
}

#[derive(Default)]
struct ScanCursor {
    after: String,
    upper: Option<String>,
    pending: VecDeque<String>,
    last_page: bool,
}

struct Recovery {
    cursor: ScanCursor,
    busy_budget: BusyRetryBudget,
    rechecks: Vec<BusyRecheck>,
    busy: Vec<BusySubmission>,
}
impl Default for Recovery {
    fn default() -> Self {
        Self {
            cursor: ScanCursor::default(),
            busy_budget: BusyRetryBudget::new(SAFETY_INTERVAL),
            rechecks: Vec::new(),
            busy: Vec::new(),
        }
    }
}
const MAX_BUSY_SUBMISSIONS: usize = 3;
// A scheduling yield, not an operation deadline. Every step may finish at least one receipt.
const CONTINUATION_DELAY: Duration = Duration::from_millis(10);
const STEP_SOFT_BUDGET: Duration = Duration::from_millis(250);

struct BusySubmission {
    id: String,
    observed_at: time::Instant,
}
struct BusyRecheck {
    id: String,
    retry: BusyRetry,
    next_at: Option<time::Instant>,
}

/// Owns only submission resources: an image attempt can borrow no part of this state.
/// The worker moves this value into at most one finite task, then takes it back unchanged.
pub(crate) struct Reconciler {
    database_url: String,
    database: Option<postgres::ConnectedClient>,
    timeout: Duration,
    sink: NotificationSink,
    schedule: Schedule,
    recovery: Recovery,
    scan_at: time::Instant,
    requested: bool,
    reconnect_at: Option<time::Instant>,
    reconnect_delay: Duration,
}

impl Reconciler {
    /// The shared listener must already be subscribed and verified before discovery begins.
    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production OCR bootstrap is Linux-only; tests exercise discovery on other hosts"
        )
    )]
    pub(crate) async fn initialize(
        database_url: String,
        timeout: Duration,
        sink: NotificationSink,
    ) -> Result<Self, RuntimeError> {
        let database = connect_database(&database_url, timeout).await?;
        let mut state = Self::with_database(
            database_url,
            database,
            timeout,
            sink,
            Schedule::default(),
            Recovery::default(),
        );
        // Only one page is discovered; startup never waits for submission settlement.
        let connected = state
            .database
            .as_ref()
            .ok_or(RuntimeError::Protocol("database_missing"))?;
        discover(connected, timeout, &mut state.recovery.cursor).await?;
        Ok(state)
    }

    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production OCR bootstrap is Linux-only; tests share the finite step state"
        )
    )]
    fn with_database(
        database_url: String,
        database: postgres::ConnectedClient,
        timeout: Duration,
        sink: NotificationSink,
        schedule: Schedule,
        recovery: Recovery,
    ) -> Self {
        Self {
            database_url,
            database: Some(database),
            timeout,
            sink,
            schedule,
            recovery,
            scan_at: time::Instant::now(),
            requested: false,
            reconnect_at: None,
            reconnect_delay: Duration::from_millis(100),
        }
    }

    pub(crate) fn request_scan(&mut self) {
        // Never reset the current cursor, busy episode, or connection backoff on a hint.
        self.requested = true;
        if self.recovery.cursor.upper.is_none() {
            self.scan_at = time::Instant::now();
        }
    }

    pub(crate) fn next_at(&self) -> time::Instant {
        if let Some(at) = self.reconnect_at {
            return at;
        }
        self.next_retry()
            .map_or(self.scan_at, |(_, at)| at.min(self.scan_at))
    }

    fn next_retry(&self) -> Option<(usize, time::Instant)> {
        if self.recovery.cursor.upper.is_some()
            || !self.recovery.busy_budget.available(time::Instant::now())
        {
            return None;
        }
        self.recovery
            .rechecks
            .iter()
            .enumerate()
            .filter_map(|(index, retry)| retry.next_at.map(|at| (index, at)))
            .min_by_key(|(_, at)| *at)
    }

    /// Completes its current database command before observing stop; callers must not cancel
    /// this future on ordinary wakes. The worker's common shutdown deadline remains the limit.
    pub(crate) async fn step(
        &mut self,
        shutdown: &watch::Receiver<bool>,
    ) -> Result<(), RuntimeError> {
        if stopping(shutdown) {
            return Ok(());
        }
        if self
            .reconnect_at
            .is_some_and(|at| at > time::Instant::now())
        {
            return Ok(());
        }
        if self.database.is_none() {
            match connect_database(&self.database_url, self.timeout).await {
                Ok(database) => {
                    self.database = Some(database);
                    self.reconnect_at = None;
                    self.scan_at = time::Instant::now();
                }
                Err(error) => {
                    self.defer_reconnect(&error);
                    return Ok(());
                }
            }
        }
        match self.advance(shutdown).await {
            Ok(()) => {
                self.reconnect_delay = Duration::from_millis(100);
                Ok(())
            }
            Err(error @ RuntimeError::Protocol(_)) => Err(error),
            Err(error) => {
                self.defer_reconnect(&error);
                Ok(())
            }
        }
    }

    fn defer_reconnect(&mut self, error: &RuntimeError) {
        tracing::warn!(event = "ocr_submission_reconnecting", error = %error);
        // Closing the owned driver also closes a timed-out request with an unknown commit.
        self.database = None;
        self.reconnect_at = Some(time::Instant::now() + self.reconnect_delay);
        self.reconnect_delay = self
            .reconnect_delay
            .saturating_mul(2)
            .min(Duration::from_secs(5));
    }

    async fn advance(&mut self, shutdown: &watch::Receiver<bool>) -> Result<(), RuntimeError> {
        if stopping(shutdown) {
            return Ok(());
        }
        let next_retry = self.next_retry();
        let database = self
            .database
            .as_mut()
            .ok_or(RuntimeError::Protocol("database_missing"))?;
        let now = time::Instant::now();
        if now < self.scan_at {
            if let Some((index, _)) = next_retry.filter(|(_, at)| *at <= now) {
                let retry = self
                    .recovery
                    .rechecks
                    .get_mut(index)
                    .ok_or(RuntimeError::Protocol("busy_retry_missing"))?;
                if !retry.retry.try_start(now, &mut self.recovery.busy_budget) {
                    retry.next_at = None;
                    return Ok(());
                }
                // Optional retries use the normal operation bound. A nearly-due scan must not
                // turn that bound into a tiny hard timeout which repeatedly discards progress.
                let busy =
                    settle_and_dispatch(database, &retry.id, self.timeout, &self.sink).await?;
                if busy {
                    retry.next_at = retry.retry.next_at(time::Instant::now());
                } else {
                    self.recovery.rechecks.remove(index);
                }
                #[cfg(test)]
                if let Some(observed) = &self.schedule.rechecked {
                    observed.send_modify(|count| *count += 1);
                }
            }
            return Ok(());
        }
        if self.recovery.cursor.upper.is_none() {
            self.requested = false;
            self.recovery.busy.clear();
        }
        let complete = sweep_page(
            database,
            self.timeout,
            &self.sink,
            shutdown,
            &mut self.recovery.cursor,
            &mut self.recovery.busy,
        )
        .await?;
        if !complete {
            self.scan_at = time::Instant::now() + CONTINUATION_DELAY;
            return Ok(());
        }
        if stopping(shutdown) {
            return Ok(());
        }
        let delay = next_delay(database, self.timeout)
            .await?
            .min(self.schedule.safety_interval);
        self.scan_at = time::Instant::now() + delay;
        retain_busy(
            &mut self.recovery.rechecks,
            std::mem::take(&mut self.recovery.busy),
            self.scan_at,
        );
        if self.requested {
            self.scan_at = time::Instant::now() + CONTINUATION_DELAY;
        }
        #[cfg(test)]
        if let Some(observed) = &self.schedule.observed {
            observed.send_modify(|count| *count += 1);
        }
        Ok(())
    }
}

fn stopping(shutdown: &watch::Receiver<bool>) -> bool {
    *shutdown.borrow() || shutdown.has_changed().is_err()
}

async fn connect_database(
    url: &str,
    timeout: Duration,
) -> Result<postgres::ConnectedClient, RuntimeError> {
    let database = postgres::connect(url)
        .await
        .map_err(|error| RuntimeError::Dependency(error.kind()))?;
    time::timeout(timeout, database.query_typed("SELECT s.status, s.match_draft_id, s.admission_deadline, s.finished_at, m.screen_type, m.status, m.failure_code, m.job_id FROM ocr_submissions s LEFT JOIN ocr_submission_members m ON m.submission_id = s.id LIMIT 0", &[])).await
        .map_err(|_error| RuntimeError::Dependency("schema_probe_timeout"))?.map_err(|_error| RuntimeError::Dependency("schema_contract"))?;
    Ok(database)
}

async fn discover(
    database: &Client,
    timeout: Duration,
    cursor: &mut ScanCursor,
) -> Result<(), RuntimeError> {
    if cursor.upper.is_none() {
        cursor.upper = time::timeout(
            timeout,
            database.query_typed_one(
                "SELECT max(id) FROM ocr_submissions WHERE status = 'open'",
                &[],
            ),
        )
        .await
        .map_err(|_error| RuntimeError::Dependency("scan_timeout"))?
        .map_err(|_error| RuntimeError::Dependency("scan"))?
        .try_get(0)
        .map_err(|_error| RuntimeError::Protocol("scan_decode"))?;
    }
    let Some(upper) = &cursor.upper else {
        cursor.last_page = true;
        return Ok(());
    };
    let rows = time::timeout(timeout, database.query_typed("SELECT id FROM ocr_submissions WHERE status = 'open' AND id > $1 AND id <= $2 ORDER BY id LIMIT $3", &[(&cursor.after, Type::TEXT), (&upper, Type::TEXT), (&PAGE_SIZE, Type::INT8)])).await
        .map_err(|_error| RuntimeError::Dependency("scan_timeout"))?.map_err(|_error| RuntimeError::Dependency("scan"))?;
    cursor.last_page = rows.len() < usize::try_from(PAGE_SIZE).unwrap_or(32);
    cursor.pending = rows
        .into_iter()
        .map(|row| {
            row.try_get(0)
                .map_err(|_error| RuntimeError::Protocol("scan_decode"))
        })
        .collect::<Result<_, _>>()?;
    Ok(())
}

async fn sweep_page(
    database: &mut Client,
    timeout: Duration,
    sink: &NotificationSink,
    shutdown: &watch::Receiver<bool>,
    cursor: &mut ScanCursor,
    busy: &mut Vec<BusySubmission>,
) -> Result<bool, RuntimeError> {
    if cursor.pending.is_empty() {
        discover(database, timeout, cursor).await?;
    }
    // Start the soft scheduling budget after discovery and always attempt the first receipt.
    let until = time::Instant::now() + STEP_SOFT_BUDGET;
    while !stopping(shutdown) {
        let Some(id) = cursor.pending.pop_front() else {
            break;
        };
        cursor.after.clone_from(&id);
        if settle_and_dispatch(database, &id, timeout, sink).await?
            && busy.len() < MAX_BUSY_SUBMISSIONS
        {
            busy.push(BusySubmission {
                id,
                observed_at: time::Instant::now(),
            });
        }
        if time::Instant::now() >= until {
            break;
        }
    }
    if cursor.pending.is_empty() && cursor.last_page {
        *cursor = ScanCursor::default();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
async fn sweep(
    database: &mut Client,
    timeout: Duration,
    sink: &NotificationSink,
    shutdown: &watch::Receiver<bool>,
    cursor: &mut ScanCursor,
) -> Result<Vec<BusySubmission>, RuntimeError> {
    let mut busy = Vec::new();
    while !sweep_page(database, timeout, sink, shutdown, cursor, &mut busy).await? {
        if stopping(shutdown) {
            break;
        }
    }
    Ok(busy)
}

#[cfg(test)]
mod test_support;
#[cfg(test)]
use super::listener::Listener;
#[cfg(test)]
use test_support::coordinate;
#[cfg(test)]
pub(crate) use test_support::run_observed;

fn retain_busy(
    rechecks: &mut Vec<BusyRecheck>,
    busy: Vec<BusySubmission>,
    recovery_at: time::Instant,
) {
    rechecks.retain(|retry| busy.iter().any(|submission| submission.id == retry.id));
    for submission in busy {
        if rechecks.iter().any(|retry| retry.id == submission.id) {
            continue;
        }
        let retry = BusyRetry::new(submission.observed_at, recovery_at);
        let next_at = retry.next_at(submission.observed_at);
        rechecks.push(BusyRecheck {
            id: submission.id,
            retry,
            next_at,
        });
    }
}

/// Dispatches only the notification returned after commit and isolates invalid source rows.
/// Returns true only for row-lock contention, which permits a bounded early recheck.
async fn settle_and_dispatch(
    database: &mut Client,
    id: &str,
    timeout: Duration,
    sink: &NotificationSink,
) -> Result<bool, RuntimeError> {
    match control::settle(database, id, timeout, sink).await {
        Ok(Settlement::Busy) => Ok(true),
        Ok(Settlement::Settled(Some(notification))) => {
            notification.dispatch();
            Ok(false)
        }
        Ok(
            Settlement::Open | Settlement::Closed | Settlement::Aborted | Settlement::Settled(None),
        ) => Ok(false),
        Err(control::SubmissionError::InvalidState) => {
            tracing::warn!(event = "ocr_submission_invalid_state", submission_id = %id);
            Ok(false)
        }
        Err(control::SubmissionError::Database(error))
            if error
                .code()
                .is_some_and(|state| state.code().starts_with("23")) =>
        {
            tracing::warn!(event = "ocr_submission_invalid_state", submission_id = %id, sqlstate = error.code().map(tokio_postgres::error::SqlState::code));
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

async fn next_delay(database: &Client, timeout: Duration) -> Result<Duration, RuntimeError> {
    let row = time::timeout(timeout, database.query_typed_one("SELECT EXTRACT(EPOCH FROM (min(s.admission_deadline) - clock_timestamp()))::double precision \
        FROM ocr_submissions s WHERE s.status = 'open' AND s.admission_deadline > clock_timestamp() \
        AND EXISTS (SELECT 1 FROM ocr_submission_members m WHERE m.submission_id = s.id AND m.status = 'pending')", &[])).await
        .map_err(|_elapsed| RuntimeError::Dependency("deadline_read_timeout"))?.map_err(|_error| RuntimeError::Dependency("deadline_read"))?;
    let seconds: Option<f64> = row
        .try_get(0)
        .map_err(|_error| RuntimeError::Protocol("deadline_decode"))?;
    Ok(seconds
        .and_then(|value| Duration::try_from_secs_f64(value).ok())
        .map_or(SAFETY_INTERVAL, |value| {
            value.max(Duration::from_millis(1)).min(SAFETY_INTERVAL)
        }))
}

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_wakes_keep_the_original_busy_episode() {
        let start = time::Instant::now();
        let mut rechecks = Vec::new();
        for seconds in [0, 2, 5, 9] {
            let observed_at = start + Duration::from_secs(seconds);
            retain_busy(
                &mut rechecks,
                vec![BusySubmission {
                    id: "busy".to_owned(),
                    observed_at,
                }],
                observed_at + SAFETY_INTERVAL,
            );
            assert_eq!(
                rechecks.first().and_then(|retry| retry.next_at),
                Some(start + Duration::from_secs(1)),
                "normal wakes neither delay the timer nor restart its backoff",
            );
        }
        let mut budget = BusyRetryBudget::new(SAFETY_INTERVAL);
        assert!(
            rechecks.first_mut().is_some_and(|retry| !retry
                .retry
                .try_start(start + Duration::from_secs(10), &mut budget)),
            "wakes cannot extend the original ten-second retry window",
        );
        retain_busy(&mut rechecks, Vec::new(), start + SAFETY_INTERVAL);
        assert!(
            rechecks.is_empty(),
            "non-Busy outcomes leave targeted recovery"
        );
    }
}
