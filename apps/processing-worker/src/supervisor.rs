use std::future::Future;

use thiserror::Error;
use tokio::sync::watch;

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
}

#[derive(Clone)]
struct AnalysisOutboxRuntimeConfig {
    database_url: String,
    redis_url: String,
    stream: String,
}

impl From<&AnalysisConsumerConfig> for AnalysisOutboxRuntimeConfig {
    fn from(config: &AnalysisConsumerConfig) -> Self {
        Self {
            database_url: config.database_url.clone(),
            redis_url: config.redis_url.clone(),
            stream: config.redis_stream.clone(),
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
            series_analysis.database_url.clone(),
            series_analysis.redis_url.clone(),
        )?;
        if matches!(ocr, OcrConsumerRuntimeConfig::Enabled(_))
            != (ocr_mode == OcrConsumerMode::Enabled)
        {
            return Err(SupervisorError::ConfigurationChangedDuringLoad);
        }
        Ok(Self {
            enabled_consumers: Some(EnabledConsumers {
                series_analysis,
                ocr,
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
/// Returns the first peer failure after signalling and awaiting every sibling peer.
pub(crate) async fn run(
    plan: WorkerRuntimePlan,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    let Some(enabled_consumers) = plan.enabled_consumers else {
        return wait_until_shutdown(shutdown).await;
    };
    match enabled_consumers.ocr {
        OcrConsumerRuntimeConfig::Disabled => {
            Box::pin(run_analysis_only(
                enabled_consumers.series_analysis,
                shutdown,
            ))
            .await
        }
        OcrConsumerRuntimeConfig::Enabled(ocr) => {
            Box::pin(run_combined(
                enabled_consumers.series_analysis,
                *ocr,
                shutdown,
            ))
            .await
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

    Box::pin(supervise_two_tasks(
        "analysis",
        series_analysis_consumer,
        "analysis_outbox",
        outbox_coordinator,
        shutdown_sender,
        external_shutdown,
    ))
    .await
}

#[cfg(target_os = "linux")]
async fn run_combined(
    series_analysis_config: AnalysisConsumerConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    external_shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    use crate::ocr::IsolatedOcrChildLauncher;

    let outbox_config = AnalysisOutboxRuntimeConfig::from(&series_analysis_config);
    let launcher = IsolatedOcrChildLauncher::new(
        series_analysis_config.child_cgroup.clone(),
        None,
        series_analysis_config.child_stop_grace,
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

    Box::pin(supervise_three_tasks(
        "analysis",
        series_analysis_consumer,
        "ocr",
        ocr_consumer,
        "analysis_outbox",
        outbox_coordinator,
        shutdown_sender,
        external_shutdown,
    ))
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
    coordinator::run(driver, wake, shutdown)
        .await
        .map_err(SupervisorError::AnalysisOutboxCoordinator)
}

async fn supervise_two_tasks<First, Second>(
    first_name: &'static str,
    first: First,
    second_name: &'static str,
    second: Second,
    shutdown_sender: watch::Sender<bool>,
    mut external_shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError>
where
    First: Future<Output = Result<(), SupervisorError>>,
    Second: Future<Output = Result<(), SupervisorError>>,
{
    enum FirstExit {
        First(Result<(), SupervisorError>),
        Second(Result<(), SupervisorError>),
        Shutdown,
    }

    tokio::pin!(first);
    tokio::pin!(second);
    let first_exit = if *external_shutdown.borrow() {
        FirstExit::Shutdown
    } else {
        loop {
            tokio::select! {
                result = &mut first => break FirstExit::First(result),
                result = &mut second => break FirstExit::Second(result),
                changed = external_shutdown.changed() => {
                    if changed.is_err() || *external_shutdown.borrow() {
                        break FirstExit::Shutdown;
                    }
                }
            }
        }
    };
    signal_shutdown(&shutdown_sender);

    match first_exit {
        FirstExit::First(result) => {
            let sibling = second.await;
            log_secondary_failure(second_name, &sibling);
            finish_unrequested_exit(first_name, result)
        }
        FirstExit::Second(result) => {
            let sibling = first.await;
            log_secondary_failure(first_name, &sibling);
            finish_unrequested_exit(second_name, result)
        }
        FirstExit::Shutdown => {
            let (first_result, second_result) = tokio::join!(first, second);
            first_result?;
            second_result
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the three explicit peer names and futures keep lifecycle diagnostics unambiguous"
)]
#[cfg_attr(
    all(not(target_os = "linux"), not(test)),
    expect(dead_code, reason = "three-peer supervision runs only on Linux")
)]
async fn supervise_three_tasks<First, Second, Third>(
    first_name: &'static str,
    first: First,
    second_name: &'static str,
    second: Second,
    third_name: &'static str,
    third: Third,
    shutdown_sender: watch::Sender<bool>,
    mut external_shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError>
where
    First: Future<Output = Result<(), SupervisorError>>,
    Second: Future<Output = Result<(), SupervisorError>>,
    Third: Future<Output = Result<(), SupervisorError>>,
{
    enum FirstExit {
        First(Result<(), SupervisorError>),
        Second(Result<(), SupervisorError>),
        Third(Result<(), SupervisorError>),
        Shutdown,
    }

    tokio::pin!(first);
    tokio::pin!(second);
    tokio::pin!(third);
    let first_exit = if *external_shutdown.borrow() {
        FirstExit::Shutdown
    } else {
        loop {
            tokio::select! {
                result = &mut first => break FirstExit::First(result),
                result = &mut second => break FirstExit::Second(result),
                result = &mut third => break FirstExit::Third(result),
                changed = external_shutdown.changed() => {
                    if changed.is_err() || *external_shutdown.borrow() {
                        break FirstExit::Shutdown;
                    }
                }
            }
        }
    };
    signal_shutdown(&shutdown_sender);

    match first_exit {
        FirstExit::First(result) => {
            let (second_result, third_result) = tokio::join!(second, third);
            log_secondary_failure(second_name, &second_result);
            log_secondary_failure(third_name, &third_result);
            finish_unrequested_exit(first_name, result)
        }
        FirstExit::Second(result) => {
            let (first_result, third_result) = tokio::join!(first, third);
            log_secondary_failure(first_name, &first_result);
            log_secondary_failure(third_name, &third_result);
            finish_unrequested_exit(second_name, result)
        }
        FirstExit::Third(result) => {
            let (first_result, second_result) = tokio::join!(first, second);
            log_secondary_failure(first_name, &first_result);
            log_secondary_failure(second_name, &second_result);
            finish_unrequested_exit(third_name, result)
        }
        FirstExit::Shutdown => {
            let (first_result, second_result, third_result) = tokio::join!(first, second, third);
            first_result?;
            second_result?;
            third_result
        }
    }
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
        tracing::error!(
            event = "worker_supervisor_secondary_failure",
            peer,
            error = %error,
            "runtime peer also failed while the supervisor was draining"
        );
    }
}

#[cfg(not(target_os = "linux"))]
fn run_combined(
    series_analysis_config: AnalysisConsumerConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    shutdown: watch::Receiver<bool>,
) -> std::future::Ready<Result<(), SupervisorError>> {
    drop((series_analysis_config, ocr_config, shutdown));
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
    #[error("worker environment changed while its runtime plan was loading")]
    ConfigurationChangedDuringLoad,
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

#[cfg(test)]
mod tests {
    use std::future;

    use tokio::sync::{oneshot, watch};

    use super::*;

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

    #[tokio::test]
    async fn two_peer_supervision_stops_the_coordinator_after_consumer_exit() {
        let (_external_sender, external_shutdown) = watch::channel(false);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let (observed_sender, observed_receiver) = oneshot::channel();

        let result = supervise_two_tasks(
            "analysis",
            future::ready(Ok(())),
            "analysis_outbox",
            stop_on_shutdown(shutdown_receiver, observed_sender),
            shutdown_sender,
            external_shutdown,
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

        let result = supervise_three_tasks(
            "analysis",
            stop_on_shutdown(shutdown_receiver.clone(), analysis_observed_sender),
            "ocr",
            stop_on_shutdown(shutdown_receiver, ocr_observed_sender),
            "analysis_outbox",
            future::ready(Err(coordinator_failure)),
            shutdown_sender,
            external_shutdown,
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
}
