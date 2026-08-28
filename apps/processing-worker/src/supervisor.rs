use std::{future::Future, pin::Pin, time::Duration};

use futures_util::{StreamExt, stream::FuturesUnordered};
use thiserror::Error;
use tokio::{sync::watch, time};

use crate::{
    ocr::{
        OcrConsumerMode, OcrConsumerRuntimeConfig, OcrRuntimeConfigError,
        consumer_mode_from_environment,
    },
    outbox::{
        OutboxKind, OutboxWakeReceiver, PostCommitSink,
        coordinator::{self, CoordinatorError},
    },
    postgres,
    series_analysis::{
        self, ConsumerError as SeriesAnalysisConsumerError,
        config::{
            AnalysisActivationConfig, AnalysisConfigError, AnalysisConsumerConfig,
            AnalysisPublicationMode,
        },
        outbox::{
            SeriesAnalysisOutboxConfig, SeriesAnalysisOutboxDriver, SeriesAnalysisOutboxError,
        },
    },
};

struct EnabledConsumers {
    series_analysis: AnalysisConsumerConfig,
    ocr: OcrConsumerRuntimeConfig,
    shutdown_drain_timeout: Duration,
}

#[derive(Clone)]
struct AnalysisOutboxRuntimeConfig {
    database_url: String,
    redis_url: String,
    stream: String,
    worker_id: String,
}

impl From<&AnalysisConsumerConfig> for AnalysisOutboxRuntimeConfig {
    fn from(config: &AnalysisConsumerConfig) -> Self {
        Self {
            database_url: config.database_url.clone(),
            redis_url: config.redis_url.clone(),
            stream: config.redis_stream.clone(),
            worker_id: config.worker_id.clone(),
        }
    }
}

pub(crate) struct WorkerRuntimePlan {
    enabled_consumers: Option<EnabledConsumers>,
}

impl WorkerRuntimePlan {
    /// Builds an explicit idle, series-analysis-only, or combined runtime plan.
    ///
    /// # Errors
    ///
    /// Returns an error when OCR is requested without the shared series-analysis runtime, or when
    /// either consumer's bounded configuration is incomplete.
    pub(crate) fn from_environment(
        analysis_activation: &AnalysisActivationConfig,
    ) -> Result<Self, SupervisorError> {
        let ocr_mode = consumer_mode_from_environment()?;
        if analysis_activation.publication_mode == AnalysisPublicationMode::Disabled {
            if ocr_mode == OcrConsumerMode::Enabled {
                return Err(SupervisorError::OcrRequiresSeriesAnalysisRuntime);
            }
            return Ok(Self {
                enabled_consumers: None,
            });
        }

        let series_analysis = AnalysisConsumerConfig::from_environment(analysis_activation)?;
        let ocr = OcrConsumerRuntimeConfig::from_environment(
            ocr_mode,
            series_analysis.database_url.clone(),
            series_analysis.redis_url.clone(),
            series_analysis.child_stop_grace,
        )?;
        // A peer can have one dependency/heartbeat operation in flight before it observes
        // shutdown, then must stop its child and durably finalize. Compose those already-validated
        // bounds once here so callers cannot configure an independent supervisor timeout.
        let analysis_shutdown_timeout = composed_shutdown_drain_timeout(
            series_analysis
                .redis_block
                .max(series_analysis.heartbeat_interval),
            series_analysis.child_stop_grace,
            series_analysis.execution_limits.finalization_timeout,
        )?;
        let shutdown_drain_timeout = match &ocr {
            OcrConsumerRuntimeConfig::Disabled => analysis_shutdown_timeout,
            OcrConsumerRuntimeConfig::Enabled(ocr) => {
                analysis_shutdown_timeout.max(composed_shutdown_drain_timeout(
                    ocr.shutdown_dependency_or_heartbeat_bound(),
                    series_analysis.child_stop_grace,
                    ocr.shutdown_finalization_bound(),
                )?)
            }
        };
        Ok(Self {
            enabled_consumers: Some(EnabledConsumers {
                series_analysis,
                ocr,
                shutdown_drain_timeout,
            }),
        })
    }

    #[must_use]
    pub(crate) const fn ocr_enabled(&self) -> bool {
        matches!(
            self.enabled_consumers,
            Some(EnabledConsumers {
                ocr: OcrConsumerRuntimeConfig::Enabled(_),
                ..
            })
        )
    }

    #[must_use]
    pub(crate) const fn series_analysis_enabled(&self) -> bool {
        self.enabled_consumers.is_some()
    }
}

/// Runs the configured consumers and their process-local outbox coordinator under one lifecycle
/// boundary.
///
/// The supervisor knows which long-lived peers exist, but not their queue payloads, claim SQL, or
/// durable state transitions. Analysis and OCR submit the same typed post-commit effects to one
/// process-local Analysis outbox sink.
///
/// # Errors
///
/// Returns the first peer failure after signalling every sibling and draining them within the
/// timeout derived from their already-validated dependency, child-stop, and finalization bounds.
pub(crate) async fn run(
    plan: WorkerRuntimePlan,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    let Some(enabled_consumers) = plan.enabled_consumers else {
        return wait_until_shutdown(shutdown).await;
    };
    let EnabledConsumers {
        series_analysis,
        ocr,
        shutdown_drain_timeout,
    } = enabled_consumers;
    match ocr {
        OcrConsumerRuntimeConfig::Disabled => {
            run_analysis_only(series_analysis, shutdown, shutdown_drain_timeout).await
        }
        OcrConsumerRuntimeConfig::Enabled(ocr) => {
            run_combined(series_analysis, *ocr, shutdown, shutdown_drain_timeout).await
        }
    }
}

async fn wait_until_shutdown(mut shutdown: watch::Receiver<bool>) -> Result<(), SupervisorError> {
    while !*shutdown.borrow() {
        if shutdown.changed().await.is_err() {
            break;
        }
    }
    Ok(())
}

async fn run_analysis_only(
    series_analysis_config: AnalysisConsumerConfig,
    external_shutdown: watch::Receiver<bool>,
    shutdown_drain_timeout: Duration,
) -> Result<(), SupervisorError> {
    let outbox_config = AnalysisOutboxRuntimeConfig::from(&series_analysis_config);
    let (post_commit_sink, outbox_wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let analysis_shutdown = shutdown_receiver.clone();
    let series_analysis_consumer = async move {
        series_analysis::run(series_analysis_config, post_commit_sink, analysis_shutdown)
            .await
            .map_err(SupervisorError::SeriesAnalysis)
    };
    let outbox_coordinator = run_analysis_outbox(outbox_config, outbox_wake, shutdown_receiver);

    supervise_peers(
        [
            runtime_peer("analysis", series_analysis_consumer),
            runtime_peer("analysis_outbox", outbox_coordinator),
        ],
        shutdown_sender,
        external_shutdown,
        shutdown_drain_timeout,
    )
    .await
}

#[cfg(target_os = "linux")]
async fn run_combined(
    series_analysis_config: AnalysisConsumerConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    external_shutdown: watch::Receiver<bool>,
    shutdown_drain_timeout: Duration,
) -> Result<(), SupervisorError> {
    use crate::ocr::IsolatedOcrChildLauncher;

    let outbox_config = AnalysisOutboxRuntimeConfig::from(&series_analysis_config);
    let launcher = IsolatedOcrChildLauncher::new(
        series_analysis_config.child_cgroup.clone(),
        None,
        series_analysis_config.child_stop_grace,
        ocr_config.child_liveness_timeout(),
    );
    let (post_commit_sink, outbox_wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let analysis_sink = post_commit_sink.clone();
    let analysis_shutdown = shutdown_receiver.clone();
    let ocr_shutdown = shutdown_receiver.clone();
    let series_analysis_consumer = async move {
        series_analysis::run(series_analysis_config, analysis_sink, analysis_shutdown)
            .await
            .map_err(SupervisorError::SeriesAnalysis)
    };
    let ocr_consumer = async move {
        crate::ocr::consumer::run(ocr_config, &launcher, post_commit_sink, ocr_shutdown)
            .await
            .map_err(SupervisorError::Ocr)
    };
    let outbox_coordinator = run_analysis_outbox(outbox_config, outbox_wake, shutdown_receiver);

    supervise_peers(
        [
            runtime_peer("analysis", series_analysis_consumer),
            runtime_peer("ocr", ocr_consumer),
            runtime_peer("analysis_outbox", outbox_coordinator),
        ],
        shutdown_sender,
        external_shutdown,
        shutdown_drain_timeout,
    )
    .await
}

async fn run_analysis_outbox(
    runtime_config: AnalysisOutboxRuntimeConfig,
    wake: OutboxWakeReceiver,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    let database = postgres::connect(&runtime_config.database_url)
        .await
        .map_err(|error| SupervisorError::AnalysisOutboxDependency {
            dependency: "postgresql",
            kind: error.kind(),
        })?;
    let redis_client =
        redis::Client::open(runtime_config.redis_url.as_str()).map_err(|_error| {
            SupervisorError::AnalysisOutboxDependency {
                dependency: "redis",
                kind: "configuration",
            }
        })?;
    let redis = redis_client
        .get_connection_manager()
        .await
        .map_err(|_error| SupervisorError::AnalysisOutboxDependency {
            dependency: "redis",
            kind: "connection",
        })?;
    let driver_config = SeriesAnalysisOutboxConfig::for_runtime(runtime_config.stream)
        .map_err(SupervisorError::AnalysisOutboxConfiguration)?;
    let driver = SeriesAnalysisOutboxDriver::new(database, redis, driver_config);
    tracing::info!(
        event = "analysis_outbox_ready",
        worker_id = %runtime_config.worker_id,
        "series-analysis outbox coordinator is ready"
    );
    coordinator::run(driver, wake, shutdown)
        .await
        .map_err(SupervisorError::AnalysisOutboxCoordinator)
}

type RuntimePeer =
    Pin<Box<dyn Future<Output = (&'static str, Result<(), SupervisorError>)> + Send>>;

fn runtime_peer(
    name: &'static str,
    future: impl Future<Output = Result<(), SupervisorError>> + Send + 'static,
) -> RuntimePeer {
    Box::pin(async move { (name, future.await) })
}

async fn supervise_peers<const PEERS: usize>(
    peers: [RuntimePeer; PEERS],
    shutdown_sender: watch::Sender<bool>,
    mut external_shutdown: watch::Receiver<bool>,
    shutdown_drain_timeout: Duration,
) -> Result<(), SupervisorError> {
    let mut running = peers.into_iter().collect::<FuturesUnordered<_>>();
    let first_exit = if *external_shutdown.borrow() || PEERS == 0 {
        None
    } else {
        loop {
            tokio::select! {
                result = running.next() => break result,
                changed = external_shutdown.changed() => {
                    if changed.is_err() || *external_shutdown.borrow() {
                        break None;
                    }
                }
            }
        }
    };
    signal_shutdown(&shutdown_sender);

    let drain = async {
        match first_exit {
            Some((peer, result)) => {
                drain_secondary_peers(&mut running).await;
                finish_unrequested_exit(peer, result)
            }
            None => drain_shutdown_peers(&mut running).await,
        }
    };
    let deadline = time::Instant::now()
        .checked_add(shutdown_drain_timeout)
        .ok_or(SupervisorError::ShutdownDrainBudgetBound)?;
    match time::timeout_at(deadline, drain).await {
        Ok(result) => result,
        Err(_elapsed) => {
            // Dropping every remaining peer future also drops any open database transaction and
            // managed child handle. Their rollback/Drop contracts fail closed instead of letting
            // an unresponsive peer keep the process alive beyond its validated cleanup budget.
            drop(running);
            Err(SupervisorError::ShutdownDrainTimeout)
        }
    }
}

async fn drain_secondary_peers(running: &mut FuturesUnordered<RuntimePeer>) {
    while let Some((peer, result)) = running.next().await {
        log_secondary_failure(peer, &result);
    }
}

async fn drain_shutdown_peers(
    running: &mut FuturesUnordered<RuntimePeer>,
) -> Result<(), SupervisorError> {
    let mut first_failure = None;
    while let Some((peer, result)) = running.next().await {
        if let Err(error) = result {
            if first_failure.is_none() {
                first_failure = Some(error);
            } else {
                log_secondary_error(peer, &error);
            }
        }
    }
    first_failure.map_or(Ok(()), Err)
}

fn signal_shutdown(shutdown_sender: &watch::Sender<bool>) {
    match shutdown_sender.send(true) {
        Ok(()) | Err(_) => {}
    }
}

fn finish_unrequested_exit(
    peer: &'static str,
    result: Result<(), SupervisorError>,
) -> Result<(), SupervisorError> {
    result?;
    Err(SupervisorError::UnexpectedExit { peer })
}

fn log_secondary_failure(peer: &'static str, result: &Result<(), SupervisorError>) {
    if let Err(error) = result {
        log_secondary_error(peer, error);
    }
}

fn log_secondary_error(peer: &'static str, error: &SupervisorError) {
    tracing::error!(
        event = "worker_supervisor_secondary_failure",
        peer,
        error = %error,
        "runtime peer also failed while the supervisor was draining"
    );
}

#[cfg(not(target_os = "linux"))]
fn run_combined(
    series_analysis_config: AnalysisConsumerConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    shutdown: watch::Receiver<bool>,
    shutdown_drain_timeout: Duration,
) -> std::future::Ready<Result<(), SupervisorError>> {
    drop((
        series_analysis_config,
        ocr_config,
        shutdown,
        shutdown_drain_timeout,
    ));
    std::future::ready(Err(SupervisorError::UnsupportedPlatform))
}

#[derive(Debug, Error)]
pub(crate) enum SupervisorError {
    #[error(transparent)]
    SeriesAnalysisConfiguration(#[from] AnalysisConfigError),
    #[error(transparent)]
    OcrConfiguration(#[from] OcrRuntimeConfigError),
    #[error("Rust OCR v2 requires the shared series-analysis runtime to be enabled")]
    OcrRequiresSeriesAnalysisRuntime,
    #[error("series-analysis consumer failed: {0}")]
    SeriesAnalysis(SeriesAnalysisConsumerError),
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "combined OCR supervision runs only on Linux")
    )]
    #[error("OCR consumer failed: {0}")]
    Ocr(crate::ocr::consumer::OcrConsumerError),
    #[error("series-analysis outbox {dependency} dependency failed ({kind})")]
    AnalysisOutboxDependency {
        dependency: &'static str,
        kind: &'static str,
    },
    #[error("series-analysis outbox configuration failed")]
    AnalysisOutboxConfiguration(#[source] SeriesAnalysisOutboxError),
    #[error("series-analysis outbox coordinator failed")]
    AnalysisOutboxCoordinator(#[source] CoordinatorError<SeriesAnalysisOutboxError>),
    #[error("{peer} runtime peer exited without a shutdown request")]
    UnexpectedExit { peer: &'static str },
    #[error("runtime shutdown drain budget exceeds a supported bound")]
    ShutdownDrainBudgetBound,
    #[error("runtime peers exceeded their bounded shutdown drain")]
    ShutdownDrainTimeout,
    #[cfg_attr(
        target_os = "linux",
        expect(
            dead_code,
            reason = "the fail-closed combined-runtime stub is only built on non-Linux"
        )
    )]
    #[error("combined worker runtime is supported only on Linux")]
    UnsupportedPlatform,
}

fn composed_shutdown_drain_timeout(
    dependency_or_heartbeat: Duration,
    child_stop: Duration,
    finalization: Duration,
) -> Result<Duration, SupervisorError> {
    dependency_or_heartbeat
        .checked_add(child_stop)
        .and_then(|duration| duration.checked_add(finalization))
        .ok_or(SupervisorError::ShutdownDrainBudgetBound)
}

#[cfg(test)]
mod tests {
    use std::future;

    use tokio::sync::{oneshot, watch};

    use super::*;

    const TEST_SHUTDOWN_DRAIN_TIMEOUT: Duration = Duration::from_secs(1);

    struct DropSignal(Option<oneshot::Sender<()>>);

    impl Drop for DropSignal {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                match sender.send(()) {
                    Ok(()) | Err(()) => {}
                }
            }
        }
    }

    async fn stop_on_shutdown(
        mut shutdown: watch::Receiver<bool>,
        observed: oneshot::Sender<()>,
    ) -> Result<(), SupervisorError> {
        while !*shutdown.borrow() {
            if shutdown.changed().await.is_err() {
                break;
            }
        }
        assert!(
            observed.send(()).is_ok(),
            "shutdown observation receiver must remain connected"
        );
        Ok(())
    }

    async fn fail_on_shutdown(mut shutdown: watch::Receiver<bool>) -> Result<(), SupervisorError> {
        while !*shutdown.borrow() {
            if shutdown.changed().await.is_err() {
                break;
            }
        }
        Err(SupervisorError::OcrRequiresSeriesAnalysisRuntime)
    }

    async fn never_stops(signal: DropSignal) -> Result<(), SupervisorError> {
        future::pending::<()>().await;
        drop(signal);
        Ok(())
    }

    #[test]
    fn shutdown_budget_composes_existing_bounds_once_and_rejects_overflow() {
        assert!(matches!(
            composed_shutdown_drain_timeout(
                Duration::from_secs(2),
                Duration::from_secs(3),
                Duration::from_secs(5),
            ),
            Ok(duration) if duration == Duration::from_secs(10)
        ));
        assert!(matches!(
            composed_shutdown_drain_timeout(Duration::MAX, Duration::from_nanos(1), Duration::ZERO,),
            Err(SupervisorError::ShutdownDrainBudgetBound)
        ));
    }

    #[tokio::test]
    async fn two_peer_supervision_stops_the_coordinator_after_consumer_exit() {
        let (_external_sender, external_shutdown) = watch::channel(false);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (observed_sender, observed_receiver) = oneshot::channel();

        let result = supervise_peers(
            [
                runtime_peer("analysis", future::ready(Ok(()))),
                runtime_peer(
                    "analysis_outbox",
                    stop_on_shutdown(shutdown_receiver, observed_sender),
                ),
            ],
            shutdown_sender,
            external_shutdown,
            TEST_SHUTDOWN_DRAIN_TIMEOUT,
        )
        .await;

        assert!(matches!(
            result,
            Err(SupervisorError::UnexpectedExit { peer: "analysis" })
        ));
        assert!(observed_receiver.await.is_ok());
    }

    #[tokio::test]
    async fn three_peer_supervision_stops_consumers_after_coordinator_failure() {
        let (_external_sender, external_shutdown) = watch::channel(false);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (analysis_observed_sender, analysis_observed_receiver) = oneshot::channel();
        let (ocr_observed_sender, ocr_observed_receiver) = oneshot::channel();
        let coordinator_failure = SupervisorError::AnalysisOutboxCoordinator(
            CoordinatorError::<SeriesAnalysisOutboxError>::WakeChannelClosed,
        );

        let result = supervise_peers(
            [
                runtime_peer(
                    "analysis",
                    stop_on_shutdown(shutdown_receiver.clone(), analysis_observed_sender),
                ),
                runtime_peer(
                    "ocr",
                    stop_on_shutdown(shutdown_receiver, ocr_observed_sender),
                ),
                runtime_peer("analysis_outbox", future::ready(Err(coordinator_failure))),
            ],
            shutdown_sender,
            external_shutdown,
            TEST_SHUTDOWN_DRAIN_TIMEOUT,
        )
        .await;

        assert!(matches!(
            result,
            Err(SupervisorError::AnalysisOutboxCoordinator(
                CoordinatorError::WakeChannelClosed
            ))
        ));
        assert!(analysis_observed_receiver.await.is_ok());
        assert!(ocr_observed_receiver.await.is_ok());
    }

    #[tokio::test]
    async fn external_shutdown_is_forwarded_and_every_peer_is_drained() {
        let (external_sender, external_shutdown) = watch::channel(false);
        assert!(external_sender.send(true).is_ok());
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (first_observed_sender, first_observed_receiver) = oneshot::channel();
        let (second_observed_sender, second_observed_receiver) = oneshot::channel();

        let result = supervise_peers(
            [
                runtime_peer(
                    "analysis",
                    stop_on_shutdown(shutdown_receiver.clone(), first_observed_sender),
                ),
                runtime_peer(
                    "analysis_outbox",
                    stop_on_shutdown(shutdown_receiver, second_observed_sender),
                ),
            ],
            shutdown_sender,
            external_shutdown,
            TEST_SHUTDOWN_DRAIN_TIMEOUT,
        )
        .await;

        assert!(result.is_ok());
        assert!(first_observed_receiver.await.is_ok());
        assert!(second_observed_receiver.await.is_ok());
    }

    #[tokio::test]
    async fn peer_failure_during_external_shutdown_is_not_hidden() {
        let (external_sender, external_shutdown) = watch::channel(false);
        assert!(external_sender.send(true).is_ok());
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (observed_sender, observed_receiver) = oneshot::channel();

        let result = supervise_peers(
            [
                runtime_peer(
                    "analysis",
                    stop_on_shutdown(shutdown_receiver.clone(), observed_sender),
                ),
                runtime_peer("analysis_outbox", fail_on_shutdown(shutdown_receiver)),
            ],
            shutdown_sender,
            external_shutdown,
            TEST_SHUTDOWN_DRAIN_TIMEOUT,
        )
        .await;

        assert!(matches!(
            result,
            Err(SupervisorError::OcrRequiresSeriesAnalysisRuntime)
        ));
        assert!(observed_receiver.await.is_ok());
    }

    #[tokio::test]
    async fn shutdown_timeout_drops_unresponsive_peer_futures() {
        let (external_sender, external_shutdown) = watch::channel(false);
        assert!(external_sender.send(true).is_ok());
        let (shutdown_sender, _shutdown_receiver) = watch::channel(false);
        let (drop_sender, drop_receiver) = oneshot::channel();

        let result = supervise_peers(
            [runtime_peer(
                "unresponsive",
                never_stops(DropSignal(Some(drop_sender))),
            )],
            shutdown_sender,
            external_shutdown,
            Duration::from_millis(10),
        )
        .await;

        assert!(matches!(result, Err(SupervisorError::ShutdownDrainTimeout)));
        assert!(drop_receiver.await.is_ok());
    }
}
