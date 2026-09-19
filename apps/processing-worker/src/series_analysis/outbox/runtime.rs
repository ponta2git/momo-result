//! Owns the outbox's connections and concurrent listener/coordinator lifetime.

use thiserror::Error;
use tokio::sync::watch;

use super::{SeriesAnalysisOutboxConfig, SeriesAnalysisOutboxDriver, SeriesAnalysisOutboxError};
use crate::{
    outbox::{
        OutboxWakeReceiver, PostCommitSink,
        coordinator::{self, CoordinatorError},
    },
    postgres,
    series_analysis::config::AnalysisConsumerConfig,
};

pub(crate) struct RuntimeConfig {
    database_url: String,
    listener_database_url: String,
    redis_url: String,
    stream: String,
    worker_id: String,
}

impl From<&AnalysisConsumerConfig> for RuntimeConfig {
    fn from(config: &AnalysisConsumerConfig) -> Self {
        Self {
            database_url: config.database_url.clone(),
            listener_database_url: config.outbox_listener_database_url.clone(),
            redis_url: config.redis_url.clone(),
            stream: config.redis_stream.clone(),
            worker_id: config.worker_id.clone(),
        }
    }
}

pub(crate) async fn run(
    runtime_config: RuntimeConfig,
    wake: OutboxWakeReceiver,
    notification_sink: PostCommitSink,
    shutdown: watch::Receiver<bool>,
) -> Result<(), RuntimeError> {
    // Subscribe before the startup drain. A commit after LISTEN succeeds is retained by the
    // dedicated connection until the listener and coordinator begin running together, so there
    // is no check-then-listen window in which fresh durable work can lose its prompt wake.
    let mut listener = crate::outbox::listener::subscribe(
        &runtime_config.listener_database_url,
        notification_sink,
    )
    .await
    .map_err(|source| RuntimeError::Notification {
        kind: source.kind(),
        source,
    })?;
    let database = postgres::connect(&runtime_config.database_url)
        .await
        .map_err(|error| RuntimeError::Dependency {
            dependency: "postgresql",
            kind: error.kind(),
        })?;
    listener
        .verify_notification_round_trip(&database)
        .await
        .map_err(|source| RuntimeError::Notification {
            kind: source.kind(),
            source,
        })?;
    tracing::info!(
        event = "analysis_outbox_notification_route_ready",
        worker_id = %runtime_config.worker_id,
        "series-analysis outbox notification route completed a cross-connection probe"
    );
    let redis_client =
        redis::Client::open(runtime_config.redis_url.as_str()).map_err(|_error| {
            RuntimeError::Dependency {
                dependency: "redis",
                kind: "configuration",
            }
        })?;
    let redis = crate::stream_connection::connect_publisher(&redis_client)
        .await
        .map_err(|_error| RuntimeError::Dependency {
            dependency: "redis",
            kind: "connection",
        })?;
    let driver_config = SeriesAnalysisOutboxConfig::for_runtime(runtime_config.stream)
        .map_err(RuntimeError::Configuration)?;
    let driver = SeriesAnalysisOutboxDriver::new(database, redis, driver_config);
    tracing::info!(
        event = "analysis_outbox_ready",
        worker_id = %runtime_config.worker_id,
        "series-analysis outbox coordinator is ready"
    );
    let listener_shutdown = shutdown.clone();
    let coordinator = async move {
        coordinator::run(driver, wake, shutdown)
            .await
            .map_err(RuntimeError::Coordinator)
    };
    let listener = async move {
        listener
            .run(listener_shutdown)
            .await
            .map_err(|source| RuntimeError::Notification {
                kind: source.kind(),
                source,
            })
    };
    tokio::try_join!(coordinator, listener)?;
    Ok(())
}

#[derive(Debug, Error)]
pub(crate) enum RuntimeError {
    #[error("series-analysis outbox {dependency} dependency failed ({kind})")]
    Dependency {
        dependency: &'static str,
        kind: &'static str,
    },
    #[error("series-analysis outbox configuration failed")]
    Configuration(#[source] SeriesAnalysisOutboxError),
    #[error("series-analysis outbox coordinator failed")]
    Coordinator(#[source] CoordinatorError<SeriesAnalysisOutboxError>),
    #[error("series-analysis outbox notification listener failed ({kind})")]
    Notification {
        kind: &'static str,
        #[source]
        source: crate::outbox::listener::ListenerError,
    },
}
