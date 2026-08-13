use thiserror::Error;
use tokio::sync::watch;

use crate::{
    analysis::{self, WorkerError},
    config::{ConfigError, PublicationMode, WorkerConfig, WorkerRuntimeConfig},
    ocr::{
        OcrConsumerMode, OcrConsumerRuntimeConfig, OcrRuntimeConfigError,
        consumer_mode_from_environment,
    },
};

struct ActiveRuntime {
    analysis: WorkerRuntimeConfig,
    ocr: OcrConsumerRuntimeConfig,
}

pub struct WorkerOrchestratorConfig {
    active: Option<ActiveRuntime>,
}

impl WorkerOrchestratorConfig {
    /// Builds an explicit idle, analysis-only, or combined worker launch plan.
    ///
    /// # Errors
    ///
    /// Returns an error when OCR is requested without the shared analysis runtime, or when either
    /// worker's bounded configuration is incomplete.
    pub fn from_environment(worker: &WorkerConfig) -> Result<Self, WorkerOrchestratorError> {
        let ocr_mode = consumer_mode_from_environment()?;
        if worker.publication_mode == PublicationMode::Disabled {
            if ocr_mode == OcrConsumerMode::Enabled {
                return Err(WorkerOrchestratorError::OcrRequiresAnalysisRuntime);
            }
            return Ok(Self { active: None });
        }

        let analysis = WorkerRuntimeConfig::from_environment(worker)?;
        let ocr = OcrConsumerRuntimeConfig::from_environment(
            analysis.database_url.clone(),
            analysis.redis_url.clone(),
        )?;
        if matches!(ocr, OcrConsumerRuntimeConfig::Enabled(_))
            != (ocr_mode == OcrConsumerMode::Enabled)
        {
            return Err(WorkerOrchestratorError::ConfigurationChangedDuringLoad);
        }
        Ok(Self {
            active: Some(ActiveRuntime { analysis, ocr }),
        })
    }

    #[must_use]
    pub const fn ocr_enabled(&self) -> bool {
        matches!(
            self.active,
            Some(ActiveRuntime {
                ocr: OcrConsumerRuntimeConfig::Enabled(_),
                ..
            })
        )
    }

    #[must_use]
    pub const fn analysis_enabled(&self) -> bool {
        self.active.is_some()
    }
}

/// Runs the configured worker loops under one shutdown and failure boundary.
///
/// When OCR is enabled, the analysis and OCR loops share the same fixed child cgroup. Their DB
/// execution-slot leases ensure that only one heavy child can cross the attach barrier at a time.
///
/// # Errors
///
/// Returns the first worker failure after signalling and awaiting the sibling loop.
pub async fn run(
    config: WorkerOrchestratorConfig,
    shutdown: watch::Receiver<bool>,
) -> Result<(), WorkerOrchestratorError> {
    let Some(active) = config.active else {
        return wait_until_shutdown(shutdown).await;
    };
    match active.ocr {
        OcrConsumerRuntimeConfig::Disabled => analysis::run(active.analysis, shutdown)
            .await
            .map_err(WorkerOrchestratorError::Analysis),
        OcrConsumerRuntimeConfig::Enabled(ocr) => {
            run_combined(active.analysis, *ocr, shutdown).await
        }
    }
}

async fn wait_until_shutdown(
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), WorkerOrchestratorError> {
    while !*shutdown.borrow() {
        if shutdown.changed().await.is_err() {
            break;
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
async fn run_combined(
    analysis_config: WorkerRuntimeConfig,
    ocr_config: crate::ocr::worker::OcrWorkerRuntimeConfig,
    mut external_shutdown: watch::Receiver<bool>,
) -> Result<(), WorkerOrchestratorError> {
    use crate::ocr::IsolatedNativeOcrEngine;

    enum FirstExit {
        Analysis(Result<(), WorkerError>),
        Ocr(Result<(), crate::ocr::worker::OcrWorkerError>),
        Shutdown,
    }

    let engine = IsolatedNativeOcrEngine::new(
        analysis_config.child_cgroup.clone(),
        None,
        analysis_config.shutdown_grace,
    );
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let analysis_worker = analysis::run(analysis_config, shutdown_receiver.clone());
    let ocr_worker = crate::ocr::worker::run_with_engine(ocr_config, &engine, shutdown_receiver);
    tokio::pin!(analysis_worker);
    tokio::pin!(ocr_worker);

    let first_exit = loop {
        tokio::select! {
            result = &mut analysis_worker => break FirstExit::Analysis(result),
            result = &mut ocr_worker => break FirstExit::Ocr(result),
            changed = external_shutdown.changed() => {
                if changed.is_err() || *external_shutdown.borrow() {
                    break FirstExit::Shutdown;
                }
            }
        }
    };
    if let Err(_receivers_closed) = shutdown_sender.send(true) {}

    match first_exit {
        FirstExit::Analysis(result) => {
            let sibling = ocr_worker.await;
            log_secondary_ocr_failure(&sibling);
            result.map_err(WorkerOrchestratorError::Analysis)?;
            Err(WorkerOrchestratorError::UnexpectedExit { worker: "analysis" })
        }
        FirstExit::Ocr(result) => {
            let sibling = analysis_worker.await;
            log_secondary_analysis_failure(&sibling);
            result.map_err(WorkerOrchestratorError::Ocr)?;
            Err(WorkerOrchestratorError::UnexpectedExit { worker: "ocr" })
        }
        FirstExit::Shutdown => {
            let (analysis_result, ocr_result) = tokio::join!(analysis_worker, ocr_worker);
            analysis_result.map_err(WorkerOrchestratorError::Analysis)?;
            ocr_result.map_err(WorkerOrchestratorError::Ocr)
        }
    }
}

#[cfg(target_os = "linux")]
fn log_secondary_ocr_failure(result: &Result<(), crate::ocr::worker::OcrWorkerError>) {
    if let Err(error) = result {
        tracing::error!(
            event = "worker_orchestrator_secondary_failure",
            worker = "ocr",
            error = %error,
            "OCR worker also failed while the orchestrator was draining"
        );
    }
}

#[cfg(target_os = "linux")]
fn log_secondary_analysis_failure(result: &Result<(), WorkerError>) {
    if let Err(error) = result {
        tracing::error!(
            event = "worker_orchestrator_secondary_failure",
            worker = "analysis",
            error = %error,
            "analysis worker also failed while the orchestrator was draining"
        );
    }
}

#[cfg(not(target_os = "linux"))]
fn run_combined(
    analysis_config: WorkerRuntimeConfig,
    ocr_config: crate::ocr::worker::OcrWorkerRuntimeConfig,
    shutdown: watch::Receiver<bool>,
) -> std::future::Ready<Result<(), WorkerOrchestratorError>> {
    drop((analysis_config, ocr_config, shutdown));
    std::future::ready(Err(WorkerOrchestratorError::UnsupportedPlatform))
}

#[derive(Debug, Error)]
pub enum WorkerOrchestratorError {
    #[error(transparent)]
    AnalysisConfiguration(#[from] ConfigError),
    #[error(transparent)]
    OcrConfiguration(#[from] OcrRuntimeConfigError),
    #[error("Rust OCR v2 requires the shared analysis runtime to be enabled")]
    OcrRequiresAnalysisRuntime,
    #[error("worker environment changed while its launch plan was loading")]
    ConfigurationChangedDuringLoad,
    #[error("analysis worker failed: {0}")]
    Analysis(WorkerError),
    #[error("OCR worker failed: {0}")]
    Ocr(crate::ocr::worker::OcrWorkerError),
    #[error("{worker} worker exited without a shutdown request")]
    UnexpectedExit { worker: &'static str },
    #[error("combined worker runtime is supported only on Linux")]
    UnsupportedPlatform,
}
