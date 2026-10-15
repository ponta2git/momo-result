use std::time::Duration;

use crate::{
    notifications::NotificationConfig,
    ocr::{OcrConsumerMode, OcrConsumerRuntimeConfig, consumer_mode_from_environment},
    series_analysis::config::{
        AnalysisActivationConfig, AnalysisConsumerConfig, AnalysisPublicationMode,
    },
};

pub(super) struct EnabledConsumers {
    pub(super) notifications: NotificationConfig,
    pub(super) series_analysis: AnalysisConsumerConfig,
    pub(super) ocr: OcrConsumerRuntimeConfig,
    pub(super) shutdown_drain_timeout: Duration,
}

pub(crate) struct WorkerRuntimePlan {
    pub(super) enabled_consumers: Option<EnabledConsumers>,
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
    ) -> Result<Self, super::WorkerError> {
        let notifications = crate::notifications::config_from_environment()?;
        let ocr_mode = consumer_mode_from_environment()?;
        if analysis_activation.publication_mode == AnalysisPublicationMode::Disabled {
            if ocr_mode == OcrConsumerMode::Enabled {
                return Err(super::WorkerError::OcrRequiresSeriesAnalysisRuntime);
            }
            return Ok(Self {
                enabled_consumers: None,
            });
        }

        let series_analysis = AnalysisConsumerConfig::from_environment(analysis_activation)?;
        let ocr = OcrConsumerRuntimeConfig::from_environment(
            ocr_mode,
            series_analysis.database_url.clone(),
            series_analysis.child_stop_grace,
        )?;
        // Idle scheduler scans observe shutdown before starting a claim. Owned work can instead
        // have a claim/heartbeat operation in flight, then stop its child and durably finalize.
        // Analysis subsequently persists its capability's draining state.
        let analysis_shutdown_timeout = composed_shutdown_drain_timeout(
            Duration::from_secs(10),
            series_analysis.renewal_window(),
            series_analysis.child_stop_grace,
            series_analysis.execution_limits.finalization_timeout,
            series_analysis.control_response_timeout(),
        )?;
        let shutdown_drain_timeout = match &ocr {
            OcrConsumerRuntimeConfig::Disabled => analysis_shutdown_timeout,
            OcrConsumerRuntimeConfig::Enabled(ocr) => {
                analysis_shutdown_timeout.max(composed_shutdown_drain_timeout(
                    Duration::from_secs(10),
                    ocr.shutdown_attempt_operation_bound(),
                    series_analysis.child_stop_grace,
                    ocr.shutdown_finalization_bound(),
                    Duration::ZERO,
                )?)
            }
        };
        // Preserve the normal finalization budget and reserve the existing child-stop grace
        // for abort acknowledgement/reaping before the one absolute process deadline.
        let shutdown_drain_timeout = shutdown_drain_timeout
            .checked_add(series_analysis.child_stop_grace)
            .ok_or(super::WorkerError::ShutdownDrainBudgetBound)?;
        Ok(Self {
            enabled_consumers: Some(EnabledConsumers {
                notifications,
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

fn composed_shutdown_drain_timeout(
    idle_dependency: Duration,
    attempt_operation: Duration,
    child_stop: Duration,
    finalization: Duration,
    capability_drain: Duration,
) -> Result<Duration, super::WorkerError> {
    attempt_operation
        .checked_add(child_stop)
        .and_then(|duration| duration.checked_add(finalization))
        .map(|duration| duration.max(idle_dependency))
        .and_then(|duration| duration.checked_add(capability_drain))
        .ok_or(super::WorkerError::ShutdownDrainBudgetBound)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_budget_includes_sequential_capability_drain_and_rejects_overflow() {
        assert!(matches!(
            composed_shutdown_drain_timeout(
                Duration::from_secs(11),
                Duration::from_secs(2),
                Duration::from_secs(3),
                Duration::from_secs(5),
                Duration::ZERO,
            ),
            Ok(duration) if duration == Duration::from_secs(11)
        ));
        assert!(matches!(
            composed_shutdown_drain_timeout(
                Duration::from_secs(11),
                Duration::from_secs(5),
                Duration::from_secs(1),
                Duration::from_secs(45),
                Duration::from_secs(5),
            ),
            Ok(duration) if duration == Duration::from_secs(56)
        ));
        assert!(matches!(
            composed_shutdown_drain_timeout(
                Duration::ZERO,
                Duration::MAX,
                Duration::ZERO,
                Duration::ZERO,
                Duration::from_nanos(1),
            ),
            Err(super::super::WorkerError::ShutdownDrainBudgetBound)
        ));
    }
}
