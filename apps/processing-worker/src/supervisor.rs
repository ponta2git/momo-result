use thiserror::Error;
use tokio::sync::watch;

use crate::{
    ocr::{
        OcrConsumerMode, OcrConsumerRuntimeConfig, OcrRuntimeConfigError,
        consumer_mode_from_environment,
    },
    series_analysis::{
        self, ConsumerError as SeriesAnalysisConsumerError,
        config::{
            AnalysisActivationConfig, AnalysisConfigError, AnalysisConsumerConfig,
            AnalysisPublicationMode,
        },
    },
};

struct EnabledConsumers {
    series_analysis: AnalysisConsumerConfig,
    ocr: OcrConsumerRuntimeConfig,
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

/// Runs the configured consumers under one shutdown and failure boundary.
///
/// When OCR is enabled, the series-analysis and OCR consumers share one fixed child cgroup. Their DB
/// execution-slot leases ensure that only one heavy child can cross the attach barrier at a time.
///
/// # Errors
///
/// Returns the first consumer failure after signalling and awaiting the sibling consumer.
pub(crate) async fn run(
    plan: WorkerRuntimePlan,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    let Some(enabled_consumers) = plan.enabled_consumers else {
        return wait_until_shutdown(shutdown).await;
    };
    match enabled_consumers.ocr {
        OcrConsumerRuntimeConfig::Disabled => {
            series_analysis::run(enabled_consumers.series_analysis, shutdown)
                .await
                .map_err(SupervisorError::SeriesAnalysis)
        }
        OcrConsumerRuntimeConfig::Enabled(ocr) => {
            run_combined(enabled_consumers.series_analysis, *ocr, shutdown).await
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

#[cfg(target_os = "linux")]
async fn run_combined(
    series_analysis_config: AnalysisConsumerConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    mut external_shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    use crate::ocr::IsolatedOcrChildLauncher;

    enum FirstExit {
        SeriesAnalysis(Result<(), SeriesAnalysisConsumerError>),
        Ocr(Result<(), crate::ocr::consumer::OcrConsumerError>),
        Shutdown,
    }

    let launcher = IsolatedOcrChildLauncher::new(
        series_analysis_config.child_cgroup.clone(),
        None,
        series_analysis_config.child_stop_grace,
    );
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let series_analysis_consumer =
        series_analysis::run(series_analysis_config, shutdown_receiver.clone());
    let ocr_consumer = crate::ocr::consumer::run(ocr_config, &launcher, shutdown_receiver);
    tokio::pin!(series_analysis_consumer);
    tokio::pin!(ocr_consumer);

    let first_exit = loop {
        tokio::select! {
            result = &mut series_analysis_consumer => break FirstExit::SeriesAnalysis(result),
            result = &mut ocr_consumer => break FirstExit::Ocr(result),
            changed = external_shutdown.changed() => {
                if changed.is_err() || *external_shutdown.borrow() {
                    break FirstExit::Shutdown;
                }
            }
        }
    };
    if let Err(_receivers_closed) = shutdown_sender.send(true) {}

    match first_exit {
        FirstExit::SeriesAnalysis(result) => {
            let sibling = ocr_consumer.await;
            log_secondary_ocr_failure(&sibling);
            result.map_err(SupervisorError::SeriesAnalysis)?;
            Err(SupervisorError::UnexpectedExit { worker: "analysis" })
        }
        FirstExit::Ocr(result) => {
            let sibling = series_analysis_consumer.await;
            log_secondary_series_analysis_failure(&sibling);
            result.map_err(SupervisorError::Ocr)?;
            Err(SupervisorError::UnexpectedExit { worker: "ocr" })
        }
        FirstExit::Shutdown => {
            let (series_analysis_result, ocr_result) =
                tokio::join!(series_analysis_consumer, ocr_consumer);
            series_analysis_result.map_err(SupervisorError::SeriesAnalysis)?;
            ocr_result.map_err(SupervisorError::Ocr)
        }
    }
}

#[cfg(target_os = "linux")]
fn log_secondary_ocr_failure(result: &Result<(), crate::ocr::consumer::OcrConsumerError>) {
    if let Err(error) = result {
        tracing::error!(
            event = "worker_orchestrator_secondary_failure",
            worker = "ocr",
            error = %error,
            "OCR consumer also failed while the supervisor was draining"
        );
    }
}

#[cfg(target_os = "linux")]
fn log_secondary_series_analysis_failure(result: &Result<(), SeriesAnalysisConsumerError>) {
    if let Err(error) = result {
        tracing::error!(
            event = "worker_orchestrator_secondary_failure",
            worker = "analysis",
            error = %error,
            "series-analysis consumer also failed while the supervisor was draining"
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
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "combined consumer supervision runs only on Linux")
    )]
    #[error("{worker} worker exited without a shutdown request")]
    UnexpectedExit { worker: &'static str },
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
