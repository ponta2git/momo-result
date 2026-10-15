//! OCR resource initialization after the worker has verified its shared notification routes.

use super::{consumer, orchestrator::ImageRunner, submissions::runtime::Reconciler};
use crate::{notifications::NotificationSink, series_analysis::config::AnalysisConsumerConfig};
use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum BootstrapError {
    #[error("OCR image initialization failed")]
    Image(#[from] consumer::OcrConsumerError),
    #[error("OCR submission initialization failed")]
    Submissions(#[from] super::submissions::runtime::RuntimeError),
    #[cfg(not(target_os = "linux"))]
    #[error("OCR requires Linux process isolation")]
    UnsupportedPlatform,
}

pub(crate) struct Bootstrapped {
    pub(crate) images: ImageRunner,
    pub(crate) submissions: Reconciler,
}

#[cfg(target_os = "linux")]
pub(crate) async fn initialize(
    config: consumer::OcrConsumerConfig,
    analysis: &AnalysisConsumerConfig,
    sink: NotificationSink,
) -> Result<Bootstrapped, BootstrapError> {
    let submissions = Reconciler::initialize(
        config.database_url.clone(),
        config.shutdown_finalization_bound(),
        sink,
    )
    .await?;
    let launcher = super::IsolatedOcrChildLauncher::new(
        analysis.child_cgroup.clone(),
        None,
        analysis.child_stop_grace,
        config.child_liveness_timeout(),
    );
    let images = ImageRunner::new(config, Box::new(launcher)).await?;
    Ok(Bootstrapped {
        images,
        submissions,
    })
}

#[cfg(not(target_os = "linux"))]
#[expect(
    clippy::unused_async,
    reason = "the platform stub preserves the Linux initialization signature"
)]
pub(crate) async fn initialize(
    _config: consumer::OcrConsumerConfig,
    _analysis: &AnalysisConsumerConfig,
    _sink: NotificationSink,
) -> Result<Bootstrapped, BootstrapError> {
    Err(BootstrapError::UnsupportedPlatform)
}
