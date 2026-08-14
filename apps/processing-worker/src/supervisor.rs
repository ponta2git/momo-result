use thiserror::Error;
use tokio::sync::watch;

use crate::{
    config::{ConfigError, PublicationMode, WorkerConfig, WorkerRuntimeConfig},
    ocr::{
        OcrConsumerMode, OcrConsumerRuntimeConfig, OcrRuntimeConfigError,
        consumer_mode_from_environment,
    },
    series_analysis::{self, ConsumerError as SeriesAnalysisConsumerError},
};

struct ActiveRuntimePlan {
    series_analysis: WorkerRuntimeConfig,
    ocr: OcrConsumerRuntimeConfig,
}

pub struct WorkerRuntimePlan {
    active: Option<ActiveRuntimePlan>,
}

impl WorkerRuntimePlan {
    /// Builds an explicit idle, series-analysis-only, or combined runtime plan.
    ///
    /// # Errors
    ///
    /// Returns an error when OCR is requested without the shared series-analysis runtime, or when
    /// either consumer's bounded configuration is incomplete.
    pub fn from_environment(worker_config: &WorkerConfig) -> Result<Self, SupervisorError> {
        let ocr_mode = consumer_mode_from_environment()?;
        if worker_config.publication_mode == PublicationMode::Disabled {
            if ocr_mode == OcrConsumerMode::Enabled {
                return Err(SupervisorError::OcrRequiresSeriesAnalysisRuntime);
            }
            return Ok(Self { active: None });
        }

        let series_analysis = WorkerRuntimeConfig::from_environment(worker_config)?;
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
            active: Some(ActiveRuntimePlan {
                series_analysis,
                ocr,
            }),
        })
    }

    #[must_use]
    pub const fn ocr_enabled(&self) -> bool {
        matches!(
            self.active,
            Some(ActiveRuntimePlan {
                ocr: OcrConsumerRuntimeConfig::Enabled(_),
                ..
            })
        )
    }

    #[must_use]
    pub const fn series_analysis_enabled(&self) -> bool {
        self.active.is_some()
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
pub async fn run(
    config: WorkerRuntimePlan,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    let Some(active) = config.active else {
        return wait_until_shutdown(shutdown).await;
    };
    match active.ocr {
        OcrConsumerRuntimeConfig::Disabled => {
            series_analysis::run(active.series_analysis, shutdown)
                .await
                .map_err(SupervisorError::SeriesAnalysis)
        }
        OcrConsumerRuntimeConfig::Enabled(ocr) => {
            run_combined(active.series_analysis, *ocr, shutdown).await
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
    series_analysis_config: WorkerRuntimeConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    mut external_shutdown: watch::Receiver<bool>,
) -> Result<(), SupervisorError> {
    use crate::ocr::IsolatedNativeOcrEngine;

    enum FirstExit {
        SeriesAnalysis(Result<(), SeriesAnalysisConsumerError>),
        Ocr(Result<(), crate::ocr::consumer::OcrConsumerError>),
        Shutdown,
    }

    let engine = IsolatedNativeOcrEngine::new(
        series_analysis_config.child_cgroup.clone(),
        None,
        series_analysis_config.shutdown_grace,
    );
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let series_analysis_consumer =
        series_analysis::run(series_analysis_config, shutdown_receiver.clone());
    let ocr_consumer = crate::ocr::consumer::run(ocr_config, &engine, shutdown_receiver);
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
    series_analysis_config: WorkerRuntimeConfig,
    ocr_config: crate::ocr::consumer::OcrConsumerConfig,
    shutdown: watch::Receiver<bool>,
) -> std::future::Ready<Result<(), SupervisorError>> {
    drop((series_analysis_config, ocr_config, shutdown));
    std::future::ready(Err(SupervisorError::UnsupportedPlatform))
}

#[derive(Debug, Error)]
pub enum SupervisorError {
    #[error(transparent)]
    SeriesAnalysisConfiguration(#[from] ConfigError),
    #[error(transparent)]
    OcrConfiguration(#[from] OcrRuntimeConfigError),
    #[error("Rust OCR v2 requires the shared series-analysis runtime to be enabled")]
    OcrRequiresSeriesAnalysisRuntime,
    #[error("worker environment changed while its runtime plan was loading")]
    ConfigurationChangedDuringLoad,
    #[error("series-analysis consumer failed: {0}")]
    SeriesAnalysis(SeriesAnalysisConsumerError),
    #[error("OCR consumer failed: {0}")]
    Ocr(crate::ocr::consumer::OcrConsumerError),
    #[error("{worker} worker exited without a shutdown request")]
    UnexpectedExit { worker: &'static str },
    #[error("combined worker runtime is supported only on Linux")]
    UnsupportedPlatform,
}
