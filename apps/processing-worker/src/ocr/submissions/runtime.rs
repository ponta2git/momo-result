//! Fair, bounded recovery of open submissions. Settled submissions are never replayed.

use super::{
    PAGE_SIZE, SAFETY_INTERVAL,
    control::{self, Settlement},
    listener::Listener,
};
use crate::{
    busy_retry::{BusyRetry, BusyRetryBudget},
    notifications::NotificationSink,
    postgres,
};
use std::time::Duration;
use thiserror::Error;
use tokio::{sync::watch, time};
use tokio_postgres::{Client, types::Type};

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
}

struct Recovery {
    cursor: ScanCursor,
    busy_budget: BusyRetryBudget,
}

impl Default for Recovery {
    fn default() -> Self {
        Self {
            cursor: ScanCursor::default(),
            busy_budget: BusyRetryBudget::new(SAFETY_INTERVAL),
        }
    }
}

const MAX_BUSY_SUBMISSIONS: usize = 3;

struct BusySubmission {
    id: String,
    observed_at: time::Instant,
}

struct BusyRecheck {
    id: String,
    retry: BusyRetry,
    next_at: Option<time::Instant>,
}

struct Session {
    listener: Listener,
    database: Client,
    wake: watch::Receiver<()>,
}

pub(crate) async fn run(
    config: Config,
    sink: NotificationSink,
    shutdown: watch::Receiver<bool>,
) -> Result<(), RuntimeError> {
    run_with_schedule(config, sink, shutdown, Schedule::default()).await
}

#[cfg(test)]
pub(crate) async fn run_observed(
    config: Config,
    sink: NotificationSink,
    shutdown: watch::Receiver<bool>,
    observed: watch::Sender<u64>,
) -> Result<(), RuntimeError> {
    run_with_schedule(
        config,
        sink,
        shutdown,
        Schedule {
            safety_interval: SAFETY_INTERVAL,
            observed: Some(observed),
            rechecked: None,
        },
    )
    .await
}

async fn connect(config: &Config) -> Result<Session, RuntimeError> {
    let (wake, receiver) = watch::channel(());
    let mut listener = Listener::subscribe(&config.listener_database_url, wake).await?;
    let database = postgres::connect(&config.database_url)
        .await
        .map_err(|error| RuntimeError::Dependency(error.kind()))?;
    listener.verify(&database).await?;
    time::timeout(config.finalization_timeout, database.query_typed("SELECT s.status, s.match_draft_id, s.admission_deadline, s.finished_at, m.screen_type, m.status, m.failure_code, m.job_id FROM ocr_submissions s LEFT JOIN ocr_submission_members m ON m.submission_id = s.id LIMIT 0", &[])).await
        .map_err(|_elapsed| RuntimeError::Dependency("schema_probe_timeout"))?.map_err(|_error| RuntimeError::Dependency("schema_contract"))?;
    Ok(Session {
        listener,
        database,
        wake: receiver,
    })
}

async fn run_with_schedule(
    config: Config,
    sink: NotificationSink,
    mut shutdown: watch::Receiver<bool>,
    schedule: Schedule,
) -> Result<(), RuntimeError> {
    if *shutdown.borrow() || shutdown.has_changed().is_err() {
        return Ok(());
    }
    // The first verified route is a readiness requirement. A broken initial route fails closed;
    // after readiness, transient connection loss recovers inside this peer without stopping OCR.
    let mut session = tokio::select! {
        result = connect(&config) => result?,
        _changed = shutdown.changed() => return Ok(()),
    };
    let mut recovery = Recovery::default();
    loop {
        let Session {
            listener,
            database,
            wake,
        } = session;
        let result = tokio::try_join!(
            listener.run(shutdown.clone()),
            coordinate(
                database,
                wake,
                shutdown.clone(),
                config.finalization_timeout,
                sink.clone(),
                schedule.clone(),
                &mut recovery
            )
        );
        if *shutdown.borrow() || shutdown.has_changed().is_err() {
            return Ok(());
        }
        if let Err(error) = result {
            tracing::warn!(event = "ocr_submission_reconnecting", error = %error);
        }
        let mut backoff = Duration::from_millis(100);
        loop {
            tokio::select! {
                () = time::sleep(backoff) => (),
                _changed = shutdown.changed() => return Ok(()),
            }
            let reconnected = tokio::select! {
                connection_result = connect(&config) => connection_result,
                _changed = shutdown.changed() => return Ok(()),
            };
            match reconnected {
                Ok(next) => {
                    session = next;
                    break;
                }
                Err(error) => {
                    tracing::warn!(event = "ocr_submission_reconnect_deferred", error = %error);
                }
            }
            backoff = backoff.saturating_mul(2).min(Duration::from_secs(5));
        }
    }
}

async fn coordinate(
    mut database: Client,
    mut wake: watch::Receiver<()>,
    mut shutdown: watch::Receiver<bool>,
    timeout: Duration,
    sink: NotificationSink,
    schedule: Schedule,
    recovery: &mut Recovery,
) -> Result<(), RuntimeError> {
    let mut rechecks = Vec::new();
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        wake.borrow_and_update();
        let busy = sweep(
            &mut database,
            timeout,
            &sink,
            &shutdown,
            &mut recovery.cursor,
        )
        .await?;
        let delay = next_delay(&database, timeout)
            .await?
            .min(schedule.safety_interval);
        let recovery_at = time::Instant::now() + delay;
        retain_busy(&mut rechecks, busy, recovery_at);
        #[cfg(test)]
        if let Some(observed) = &schedule.observed {
            observed.send_modify(|count| *count += 1);
        }
        loop {
            let next = if recovery.busy_budget.available(time::Instant::now()) {
                rechecks
                    .iter()
                    .enumerate()
                    .filter_map(|(index, retry)| retry.next_at.map(|at| (index, at)))
                    .min_by_key(|(_, at)| *at)
            } else {
                None
            };
            tokio::select! {
                biased;
                changed = shutdown.changed() => { if changed.is_err() || *shutdown.borrow() { return Ok(()); } }
                () = time::sleep_until(recovery_at) => {
                    rechecks.clear();
                    break;
                }
                changed = wake.changed() => {
                    if changed.is_err() { return Err(RuntimeError::Dependency("wake_closed")); }
                    break;
                }
                () = time::sleep_until(next.map_or(recovery_at, |(_, at)| at)), if next.is_some() => {
                    let Some((index, _)) = next else { continue; };
                    let Some(retry) = rechecks.get_mut(index) else { continue; };
                    let now = time::Instant::now();
                    if now >= recovery_at {
                        rechecks.clear();
                        break;
                    }
                    if !retry.retry.try_start(now, &mut recovery.busy_budget) {
                        retry.next_at = None;
                        continue;
                    }
                    // An optional attempt never extends the already-scheduled safety/admission scan.
                    let attempt_timeout = timeout.min(recovery_at.saturating_duration_since(now));
                    let remains_busy = settle_and_dispatch(&mut database, &retry.id, attempt_timeout, &sink).await?;
                    if remains_busy {
                        retry.next_at = retry.retry.next_at(time::Instant::now());
                    }
                    #[cfg(test)]
                    if let Some(rechecked) = &schedule.rechecked {
                        rechecked.send_modify(|count| *count += 1);
                    }
                    if !remains_busy {
                        rechecks.remove(index);
                    }
                }
            }
        }
    }
}

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

async fn sweep(
    database: &mut Client,
    timeout: Duration,
    sink: &NotificationSink,
    shutdown: &watch::Receiver<bool>,
    cursor: &mut ScanCursor,
) -> Result<Vec<BusySubmission>, RuntimeError> {
    let mut busy = Vec::new();
    // The upper bound and last attempted ID survive connection replacement. A row whose command
    // times out is retried next pass, while later submissions can finish during the resumed pass.
    if cursor.upper.is_none() {
        cursor.upper = time::timeout(
            timeout,
            database.query_typed_one(
                "SELECT max(id) FROM ocr_submissions WHERE status = 'open'",
                &[],
            ),
        )
        .await
        .map_err(|_elapsed| RuntimeError::Dependency("scan_timeout"))?
        .map_err(|_error| RuntimeError::Dependency("scan"))?
        .try_get(0)
        .map_err(|_error| RuntimeError::Dependency("scan_decode"))?;
    }
    let Some(upper) = &cursor.upper else {
        return Ok(busy);
    };
    loop {
        if *shutdown.borrow() {
            return Ok(busy);
        }
        let rows = time::timeout(timeout, database.query_typed("SELECT id FROM ocr_submissions WHERE status = 'open' AND id > $1 AND id <= $2 ORDER BY id LIMIT $3", &[(&cursor.after, Type::TEXT), (&upper, Type::TEXT), (&PAGE_SIZE, Type::INT8)])).await
            .map_err(|_elapsed| RuntimeError::Dependency("scan_timeout"))?.map_err(|_error| RuntimeError::Dependency("scan"))?;
        if rows.is_empty() {
            *cursor = ScanCursor::default();
            return Ok(busy);
        }
        for row in rows {
            if *shutdown.borrow() {
                return Ok(busy);
            }
            cursor.after = row
                .try_get(0)
                .map_err(|_error| RuntimeError::Dependency("scan_decode"))?;
            if settle_and_dispatch(database, &cursor.after, timeout, sink).await?
                && busy.len() < MAX_BUSY_SUBMISSIONS
            {
                busy.push(BusySubmission {
                    id: cursor.after.clone(),
                    observed_at: time::Instant::now(),
                });
            }
        }
        tokio::task::yield_now().await;
    }
}

async fn next_delay(database: &Client, timeout: Duration) -> Result<Duration, RuntimeError> {
    let row = time::timeout(timeout, database.query_typed_one("SELECT EXTRACT(EPOCH FROM (min(s.admission_deadline) - clock_timestamp()))::double precision \
        FROM ocr_submissions s WHERE s.status = 'open' AND s.admission_deadline > clock_timestamp() \
        AND EXISTS (SELECT 1 FROM ocr_submission_members m WHERE m.submission_id = s.id AND m.status = 'pending')", &[])).await
        .map_err(|_elapsed| RuntimeError::Dependency("deadline_read_timeout"))?.map_err(|_error| RuntimeError::Dependency("deadline_read"))?;
    let seconds: Option<f64> = row
        .try_get(0)
        .map_err(|_error| RuntimeError::Dependency("deadline_decode"))?;
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
