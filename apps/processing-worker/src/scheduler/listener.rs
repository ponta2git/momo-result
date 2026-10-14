//! Session-bound, payload-free wake adapter for the durable processing jobs.

use std::time::Duration;

use futures_util::future::poll_fn;
use thiserror::Error;
use tokio::{sync::watch, time};
use tokio_postgres::{AsyncMessage, Client};

use super::{PostCommitEffects, PostCommitSink, PostCommitSinkClosed};
use crate::postgres::{self, PostgresError};

const ROUTE_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const SUBSCRIPTION_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const CHANNEL: &str = "processing_jobs";

#[derive(Debug, Error)]
pub(crate) enum ListenerError {
    #[error("processing scheduler notification PostgreSQL dependency failed")]
    Postgres(#[from] PostgresError),
    #[error("processing scheduler notification connection closed unexpectedly")]
    ConnectionClosed,
    #[error("processing scheduler notification route probe timed out")]
    RouteProbeTimeout,
    #[error("processing scheduler notification subscription timed out")]
    SubscriptionTimeout,
    #[error("processing scheduler notification violated its payload-free protocol")]
    InvalidNotification,
    #[error("processing scheduler notification sink closed unexpectedly")]
    SinkClosed(#[from] PostCommitSinkClosed),
    #[error("processing scheduler notification shutdown channel closed unexpectedly")]
    ShutdownChannelClosed,
}

/// A dedicated, already-subscribed connection that owns the cross-process scheduler wake route.
pub(crate) struct Listener {
    // Retaining the client keeps the request side of the dedicated connection open while the
    // connection object is polled exclusively for asynchronous notifications.
    _client: Client,
    connection: postgres::Driver,
    sink: PostCommitSink,
}

impl ListenerError {
    #[must_use]
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Postgres(error) => error.kind(),
            Self::ConnectionClosed => "postgres_connection_closed",
            Self::RouteProbeTimeout => "notification_route_probe_timeout",
            Self::SubscriptionTimeout => "notification_subscription_timeout",
            Self::InvalidNotification => "invalid_notification",
            Self::SinkClosed(_) => "scheduler_wake_sink_closed",
            Self::ShutdownChannelClosed => "shutdown_channel_closed",
        }
    }
}

/// Opens and subscribes the dedicated payload-free `PostgreSQL` notification connection.
///
/// The listener owns a dedicated connection because the ordinary query connection intentionally
/// drives and discards asynchronous notices. The scheduler reconnects this listener after a
/// connection failure while continuing deadline scans of durable work. A lost notification does
/// not remove or acknowledge a job.
///
/// # Errors
///
/// Returns a safe structural error when setup, the connection, notification protocol, or sink
/// stops satisfying the coordination contract.
pub(crate) async fn subscribe(
    database_url: &str,
    sink: PostCommitSink,
) -> Result<Listener, ListenerError> {
    let setup = async {
        let (client, connection) = postgres::open(database_url).await?;
        subscribe_connection(client, connection, sink).await
    };
    // Socket connection deadlines do not cover the subsequent LISTEN response. Keep setup
    // bounded as one operation; on expiry this future owns and closes both client and driver.
    time::timeout(SUBSCRIPTION_TIMEOUT, setup)
        .await
        .map_err(|_elapsed| ListenerError::SubscriptionTimeout)?
}

async fn subscribe_connection(
    client: Client,
    mut connection: postgres::Driver,
    sink: PostCommitSink,
) -> Result<Listener, ListenerError> {
    // PostgreSQL identifiers cannot be bind parameters. The interpolated value is a private
    // compile-time constant, never configuration or request input.
    let listen_statement = format!("LISTEN {CHANNEL}");
    {
        let subscription = client.batch_execute(&listen_statement);
        tokio::pin!(subscription);
        loop {
            tokio::select! {
                biased;
                result = &mut subscription => {
                    result.map_err(PostgresError::from)?;
                    break;
                }
                message = poll_fn(|context| connection.poll_message(context)) => {
                    handle_async_message(message, &sink)?;
                }
            }
        }
    }
    Ok(Listener {
        _client: client,
        connection,
        sink,
    })
}

impl Listener {
    /// Proves that a commit on the ordinary control connection reaches this session-bound
    /// listener before the worker advertises readiness.
    ///
    /// # Errors
    ///
    /// Returns a structural error when publication, delivery, protocol validation, or the bounded
    /// probe deadline fails. A transaction-pooled listener therefore fails closed even when its
    /// initial `LISTEN` statement appeared to succeed.
    pub(crate) async fn verify_notification_round_trip(
        &mut self,
        publisher: &Client,
    ) -> Result<(), ListenerError> {
        let probe = async {
            publisher
                .execute("SELECT pg_notify($1, '')", &[&CHANNEL])
                .await
                .map_err(PostgresError::from)?;
            loop {
                let message = poll_fn(|context| self.connection.poll_message(context)).await;
                let received = matches!(
                    message.as_ref(),
                    Some(Ok(AsyncMessage::Notification(notification)))
                        if notification.channel()
                            == CHANNEL
                            && notification.payload().is_empty()
                );
                handle_async_message(message, &self.sink)?;
                if received {
                    return Ok(());
                }
            }
        };
        match time::timeout(ROUTE_PROBE_TIMEOUT, probe).await {
            Ok(result) => result,
            Err(_elapsed) => Err(ListenerError::RouteProbeTimeout),
        }
    }

    /// Drives the already-established subscription until coordinated shutdown.
    ///
    /// # Errors
    ///
    /// Returns a structural error when the connection, payload-free protocol, local sink, or
    /// shutdown lifecycle is lost.
    pub(crate) async fn run(
        mut self,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), ListenerError> {
        loop {
            if *shutdown.borrow() {
                return Ok(());
            }
            tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    require_open_shutdown_channel(changed)?;
                    if *shutdown.borrow() {
                        return Ok(());
                    }
                }
                message = poll_fn(|context| self.connection.poll_message(context)) => {
                    handle_async_message(message, &self.sink)?;
                }
            }
        }
    }
}

fn handle_async_message(
    message: Option<Result<AsyncMessage, tokio_postgres::Error>>,
    sink: &PostCommitSink,
) -> Result<(), ListenerError> {
    match message {
        Some(Ok(message)) => match message {
            AsyncMessage::Notification(notification) => {
                submit_job_notification(notification.channel(), notification.payload(), sink)
            }
            AsyncMessage::Notice(_) | _ => Ok(()),
        },
        Some(Err(error)) => Err(ListenerError::Postgres(PostgresError::Postgres(error))),
        None => Err(ListenerError::ConnectionClosed),
    }
}

fn submit_job_notification(
    channel: &str,
    payload: &str,
    sink: &PostCommitSink,
) -> Result<(), ListenerError> {
    if channel != CHANNEL || !payload.is_empty() {
        return Err(ListenerError::InvalidNotification);
    }
    let received_at = std::time::Instant::now();
    sink.submit(PostCommitEffects::WakeJobs)?;
    tracing::info!(
        event = "processing_jobs_wake_received",
        admission_microseconds =
            u64::try_from(received_at.elapsed().as_micros()).unwrap_or(u64::MAX),
        "analysis commit hint admitted to the local coordinator"
    );
    Ok(())
}

fn require_open_shutdown_channel(
    changed: Result<(), watch::error::RecvError>,
) -> Result<(), ListenerError> {
    changed.map_err(|_closed| ListenerError::ShutdownChannelClosed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "wire assertions identify the stalled subscription while setup errors propagate"
    )]
    async fn stalled_listen_response_expires_and_closes_its_connection()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use tokio::io::AsyncReadExt as _;

        let server = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let database_url = format!(
            "host=127.0.0.1 port={} user=test dbname=test sslmode=disable",
            server.local_addr()?.port()
        );
        let (sink, _wake) = PostCommitSink::channel();
        let peer = async {
            let mut socket = postgres::test_support::accept_startup(&server).await?;
            // Accept the simple LISTEN query without ever acknowledging it.
            assert_eq!(socket.read_u8().await?, b'Q');
            let query_length = socket.read_u32().await?;
            assert!((5..1024).contains(&query_length));
            let mut query = vec![0; usize::try_from(query_length - 4)?];
            socket.read_exact(&mut query).await?;
            assert_eq!(query, format!("LISTEN {CHANNEL}\0").into_bytes());
            let mut trailing = Vec::new();
            socket.read_to_end(&mut trailing).await?;
            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
        };
        let subscription = async {
            // Establish the real PostgreSQL wire before starting the short test deadline. TLS
            // context initialization and concurrent fixture setup cannot consume the allowance
            // intended to exercise the unanswered LISTEN command.
            let (client, connection) = postgres::open(&database_url).await?;
            time::timeout(
                Duration::from_millis(250),
                subscribe_connection(client, connection, sink),
            )
            .await
            .map_err(|_elapsed| ListenerError::SubscriptionTimeout)?
        };
        let (result, peer) = time::timeout(Duration::from_secs(15), async {
            tokio::join!(subscription, peer)
        })
        .await?;
        peer?;
        assert!(matches!(result, Err(ListenerError::SubscriptionTimeout)));
        Ok(())
    }

    #[test]
    fn job_notifications_are_fixed_and_payload_free() {
        let (sink, wake) = PostCommitSink::channel();

        assert_eq!(CHANNEL, "processing_jobs");
        assert!(submit_job_notification(CHANNEL, "", &sink,).is_ok());
        assert!(
            submit_job_notification(CHANNEL, "", &sink,).is_ok(),
            "a repeated commit hint must coalesce in the capacity-one sink"
        );
        assert!(matches!(
            submit_job_notification("another_channel", "", &sink),
            Err(ListenerError::InvalidNotification)
        ));
        assert!(matches!(
            submit_job_notification(CHANNEL, "job-identity-is-forbidden", &sink,),
            Err(ListenerError::InvalidNotification)
        ));
        assert!(matches!(
            handle_async_message(None, &sink),
            Err(ListenerError::ConnectionClosed)
        ));

        drop(wake);
        assert!(matches!(
            submit_job_notification(CHANNEL, "", &sink,),
            Err(ListenerError::SinkClosed(_))
        ));
    }
}
