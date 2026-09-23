use std::time::Instant;

use crate::series_analysis::control::AttemptMetrics;

/// Diagnostic intervals may nest. They are never summed into the stored phase metrics.
pub(super) struct PhaseTimer {
    phase: &'static str,
    started: Instant,
    completed: bool,
}

impl PhaseTimer {
    pub(super) fn start(phase: &'static str) -> Self {
        Self {
            phase,
            started: Instant::now(),
            completed: false,
        }
    }

    pub(super) fn complete(mut self) {
        self.completed = true;
    }
}

impl Drop for PhaseTimer {
    fn drop(&mut self) {
        tracing::info!(
            event = "analysis_phase_finished",
            phase = self.phase,
            duration_milliseconds = signed_milliseconds(self.started.elapsed()),
            completed = self.completed,
            "analysis diagnostic interval finished"
        );
    }
}

pub(super) async fn measure<T, E>(
    phase: &'static str,
    operation: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let timer = PhaseTimer::start(phase);
    let result = operation.await?;
    timer.complete();
    Ok(result)
}

pub(super) fn elapsed_metrics(started: Instant, child_peak_bytes: Option<u64>) -> AttemptMetrics {
    let elapsed = signed_milliseconds(started.elapsed());
    AttemptMetrics {
        elapsed_milliseconds: elapsed,
        calculation_milliseconds: elapsed,
        child_peak_bytes: signed_optional_quantity(child_peak_bytes),
        ..AttemptMetrics::default()
    }
}

pub(super) fn signed_milliseconds(duration: std::time::Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

pub(super) fn signed_quantity(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

pub(super) fn signed_optional_quantity(value: Option<u64>) -> Option<i64> {
    value.map(signed_quantity)
}
