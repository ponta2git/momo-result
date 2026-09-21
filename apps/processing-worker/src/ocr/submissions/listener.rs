//! Dedicated session for payload-free submission hints; subscribed before any initial scan.

use super::{CHANNEL, runtime::RuntimeError};
use crate::postgres;
use futures_util::future::poll_fn;
use tokio::{sync::watch, time};
use tokio_postgres::{AsyncMessage, Client};

pub(super) struct Listener {
    _client: Client,
    connection: postgres::Driver,
    wake: watch::Sender<()>,
}

impl Listener {
    pub(super) async fn subscribe(
        url: &str,
        wake: watch::Sender<()>,
    ) -> Result<Self, RuntimeError> {
        let (client, mut connection) = postgres::open(url)
            .await
            .map_err(|error| RuntimeError::Dependency(error.kind()))?;
        time::timeout(std::time::Duration::from_secs(10), async {
            let subscription = client.batch_execute("LISTEN ocr_submissions");
            tokio::pin!(subscription);
            loop {
                tokio::select! {
                    result = &mut subscription => { return result.map_err(|_error| RuntimeError::Dependency("listen")); }
                    message = poll_fn(|context| connection.poll_message(context)) => { notify(message, &wake)?; }
                }
            }
        })
        .await
        .map_err(|_elapsed| RuntimeError::Dependency("listen_timeout"))??;
        Ok(Self {
            _client: client,
            connection,
            wake,
        })
    }

    pub(super) async fn verify(&mut self, publisher: &Client) -> Result<(), RuntimeError> {
        let probe = async {
            publisher
                .execute("SELECT pg_notify($1, '')", &[&CHANNEL])
                .await
                .map_err(|_error| RuntimeError::Dependency("probe_publish"))?;
            loop {
                if notify(
                    poll_fn(|context| self.connection.poll_message(context)).await,
                    &self.wake,
                )? {
                    return Ok(());
                }
            }
        };
        time::timeout(std::time::Duration::from_secs(10), probe)
            .await
            .map_err(|_elapsed| RuntimeError::Dependency("probe_timeout"))?
    }

    pub(super) async fn run(
        mut self,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), RuntimeError> {
        loop {
            if *shutdown.borrow() {
                return Ok(());
            }
            tokio::select! {
                changed = shutdown.changed() => { if changed.is_err() || *shutdown.borrow() { return Ok(()); } }
                message = poll_fn(|context| self.connection.poll_message(context)) => { notify(message, &self.wake)?; }
            }
        }
    }
}

fn notify(
    message: Option<Result<AsyncMessage, tokio_postgres::Error>>,
    wake: &watch::Sender<()>,
) -> Result<bool, RuntimeError> {
    match message {
        Some(Ok(AsyncMessage::Notification(notification))) => {
            if notification.channel() != CHANNEL || !notification.payload().is_empty() {
                return Err(RuntimeError::Dependency("invalid_notification"));
            }
            wake.send_replace(());
            Ok(true)
        }
        Some(Ok(_)) => Ok(false),
        Some(Err(_)) | None => Err(RuntimeError::Dependency("listener_closed")),
    }
}
