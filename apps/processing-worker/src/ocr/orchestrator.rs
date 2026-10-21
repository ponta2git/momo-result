//! OCR's claimed-image entry point. Submission reconciliation owns separate mutable resources.

use super::{consumer, control::ClaimedOcrJob};
use tokio::sync::watch;

/// Only a claimed job with the worker's process resources reserved may reach the image runner.
/// Keeping this resource separate from the reconciler lets receipt deadlines advance while
/// an OCR image or analysis attempt is running, without another connection or a shared lock.
pub(crate) struct ImageRunner {
    runner: consumer::Runner,
}

impl ImageRunner {
    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production OCR initialization requires Linux process isolation"
        )
    )]
    pub(crate) async fn new(
        config: consumer::OcrConsumerConfig,
        launcher: Box<dyn consumer::OcrChildLauncher>,
    ) -> Result<Self, consumer::OcrConsumerError> {
        Ok(Self {
            runner: consumer::Runner::new(config, launcher).await?,
        })
    }

    pub(crate) async fn execute(
        &mut self,
        claim: ClaimedOcrJob,
        stopped: watch::Receiver<bool>,
    ) -> Result<(), consumer::OcrConsumerError> {
        self.runner.execute(claim, stopped).await
    }
}
