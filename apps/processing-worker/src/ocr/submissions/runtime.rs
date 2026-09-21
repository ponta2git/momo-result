//! Fair, bounded recovery of open submissions. Settled submissions are never replayed.

use super::{
    PAGE_SIZE, SAFETY_INTERVAL,
    control::{self, Settlement},
    listener::Listener,
};
use crate::{notifications::NotificationSink, postgres};
use std::time::Duration;
use thiserror::Error;
use tokio::{sync::watch, time};
use tokio_postgres::Client;

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
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            safety_interval: SAFETY_INTERVAL,
            #[cfg(test)]
            observed: None,
        }
    }
}

#[derive(Default)]
struct ScanCursor {
    after: String,
    upper: Option<String>,
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
    time::timeout(config.finalization_timeout, database.query("SELECT s.status, s.match_draft_id, s.admission_deadline, s.finished_at, m.screen_type, m.status, m.failure_code, m.job_id FROM ocr_submissions s LEFT JOIN ocr_submission_members m ON m.submission_id = s.id LIMIT 0", &[])).await
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
    let mut cursor = ScanCursor::default();
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
                &mut cursor
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
    cursor: &mut ScanCursor,
) -> Result<(), RuntimeError> {
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        wake.borrow_and_update();
        sweep(&mut database, timeout, &sink, &shutdown, cursor).await?;
        let delay = next_delay(&database, timeout)
            .await?
            .min(schedule.safety_interval);
        #[cfg(test)]
        if let Some(observed) = &schedule.observed {
            observed.send_modify(|count| *count += 1);
        }
        tokio::select! {
            changed = shutdown.changed() => { if changed.is_err() || *shutdown.borrow() { return Ok(()); } }
            changed = wake.changed() => { if changed.is_err() { return Err(RuntimeError::Dependency("wake_closed")); } }
            () = time::sleep(delay) => ()
        }
    }
}

async fn sweep(
    database: &mut Client,
    timeout: Duration,
    sink: &NotificationSink,
    shutdown: &watch::Receiver<bool>,
    cursor: &mut ScanCursor,
) -> Result<(), RuntimeError> {
    // The upper bound and last attempted ID survive connection replacement. A row whose command
    // times out is retried next pass, while later submissions can finish during the resumed pass.
    if cursor.upper.is_none() {
        cursor.upper = time::timeout(
            timeout,
            database.query_one(
                "SELECT max(id) FROM ocr_submissions WHERE status = 'open'",
                &[],
            ),
        )
        .await
        .map_err(|_elapsed| RuntimeError::Dependency("scan_timeout"))?
        .map_err(|_error| RuntimeError::Dependency("scan"))?
        .get(0);
    }
    let Some(upper) = &cursor.upper else {
        return Ok(());
    };
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        let rows = time::timeout(timeout, database.query("SELECT id FROM ocr_submissions WHERE status = 'open' AND id > $1 AND id <= $2 ORDER BY id LIMIT $3", &[&cursor.after, &upper, &PAGE_SIZE])).await
            .map_err(|_elapsed| RuntimeError::Dependency("scan_timeout"))?.map_err(|_error| RuntimeError::Dependency("scan"))?;
        if rows.is_empty() {
            *cursor = ScanCursor::default();
            return Ok(());
        }
        for row in rows {
            if *shutdown.borrow() {
                return Ok(());
            }
            cursor.after = row.get(0);
            match control::settle(database, &cursor.after, timeout, sink).await {
                Ok(Settlement::Settled(Some(notification))) => notification.dispatch(),
                Ok(
                    Settlement::Open
                    | Settlement::Busy
                    | Settlement::Closed
                    | Settlement::Aborted
                    | Settlement::Settled(None),
                ) => (),
                Err(control::SubmissionError::InvalidState) => {
                    tracing::warn!(event = "ocr_submission_invalid_state", submission_id = %cursor.after);
                }
                Err(control::SubmissionError::Database(error))
                    if error
                        .code()
                        .is_some_and(|state| state.code().starts_with("23")) =>
                {
                    tracing::warn!(event = "ocr_submission_invalid_state", submission_id = %cursor.after, sqlstate = error.code().map(tokio_postgres::error::SqlState::code));
                }
                Err(error) => return Err(error.into()),
            }
        }
        tokio::task::yield_now().await;
    }
}

async fn next_delay(database: &Client, timeout: Duration) -> Result<Duration, RuntimeError> {
    let row = time::timeout(timeout, database.query_one("SELECT EXTRACT(EPOCH FROM (min(s.admission_deadline) - clock_timestamp()))::double precision \
        FROM ocr_submissions s WHERE s.status = 'open' AND s.admission_deadline > clock_timestamp() \
        AND EXISTS (SELECT 1 FROM ocr_submission_members m WHERE m.submission_id = s.id AND m.status = 'pending')", &[])).await
        .map_err(|_elapsed| RuntimeError::Dependency("deadline_read_timeout"))?.map_err(|_error| RuntimeError::Dependency("deadline_read"))?;
    let seconds: Option<f64> = row.get(0);
    Ok(seconds
        .and_then(|value| Duration::try_from_secs_f64(value).ok())
        .map_or(SAFETY_INTERVAL, |value| {
            value.max(Duration::from_millis(1)).min(SAFETY_INTERVAL)
        }))
}

#[cfg(test)]
mod integration_tests;
