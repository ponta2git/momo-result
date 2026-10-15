use super::*;
use crate::ocr::submissions::listener::Listener;

struct Session {
    listener: Listener,
    database: postgres::ConnectedClient,
    wake: watch::Receiver<()>,
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
        if matches!(result, Err(RuntimeError::Protocol(_))) {
            return result.map(|_| ());
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

pub(super) async fn coordinate(
    database: postgres::ConnectedClient,
    mut wake: watch::Receiver<()>,
    mut shutdown: watch::Receiver<bool>,
    timeout: Duration,
    sink: NotificationSink,
    schedule: Schedule,
    recovery: &mut Recovery,
) -> Result<(), RuntimeError> {
    let mut reconciler = Reconciler::with_database(
        String::new(),
        database,
        timeout,
        sink,
        schedule,
        std::mem::take(recovery),
    );
    let result = async {
        loop {
            if stopping(&shutdown) {
                return Ok(());
            }
            tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() { return Ok(()); }
                }
                changed = wake.changed() => {
                    changed.map_err(|_closed| RuntimeError::Protocol("wake_closed"))?;
                    reconciler.request_scan();
                }
                () = time::sleep_until(reconciler.next_at()) => {
                    // This harness lets the outer route owner replace the connection.
                    // Production step() does that locally without interrupting T1.
                    reconciler.advance(&shutdown).await?;
                }
            }
        }
    }
    .await;
    *recovery = reconciler.recovery;
    result
}
