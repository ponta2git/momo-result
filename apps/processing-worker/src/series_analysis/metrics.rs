use std::time::Instant;

use crate::series_analysis::control::AttemptMetrics;

pub(super) fn elapsed_metrics(started: Instant, child_peak_bytes: Option<u64>) -> AttemptMetrics {
    let elapsed = signed_milliseconds(started.elapsed());
    AttemptMetrics {
        elapsed_milliseconds: elapsed,
        calculation_milliseconds: elapsed,
        child_peak_bytes: signed_optional_quantity(child_peak_bytes),
        ..AttemptMetrics::default()
    }
}

fn signed_milliseconds(duration: std::time::Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

pub(super) fn signed_quantity(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

pub(super) fn signed_optional_quantity(value: Option<u64>) -> Option<i64> {
    value.map(signed_quantity)
}
