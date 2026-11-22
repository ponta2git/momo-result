use super::*;

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
