use std::time::{Duration, Instant};

use serde_json::json;
use tokio_postgres::Client;

use momo_analysis_core::contract::ARTIFACT_SCHEMA_VERSION;

use super::{ALGORITHM_VERSION, ControlError};

pub(crate) const CAPABILITY_FRESH_SECONDS: i64 = 60;
const IDLE_REFRESH_INTERVAL: Duration = Duration::from_secs(20);

/// Schedules idle capability refreshes from the last successful UPSERT.
///
/// Job heartbeats refresh the database independently. They deliberately do not advance this local
/// schedule, so returning from a long-running job makes the next idle-loop check immediately due.
#[derive(Clone, Copy, Debug)]
pub(crate) struct IdleRefreshSchedule {
    last_success_at: Instant,
}

impl IdleRefreshSchedule {
    #[must_use]
    pub(crate) const fn after_success(last_success_at: Instant) -> Self {
        Self { last_success_at }
    }

    #[must_use]
    pub(crate) fn is_due_at(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.last_success_at) >= IDLE_REFRESH_INTERVAL
    }

    pub(crate) const fn record_success_at(&mut self, refreshed_at: Instant) {
        self.last_success_at = refreshed_at;
    }
}

/// Registers this worker's exact algorithm/schema capability set.
///
/// # Errors
///
/// Returns an error when `PostgreSQL` rejects the capability update.
pub(crate) async fn register_capability(
    client: &Client,
    worker_id: &str,
) -> Result<(), ControlError> {
    client
        .execute(
            "INSERT INTO series_analysis_worker_capabilities (\x20\
               worker_id, algorithm_versions, artifact_schema_versions, draining, started_at, heartbeat_at\x20\
             ) VALUES ($1, $2, $3, false, clock_timestamp(), clock_timestamp())\x20\
             ON CONFLICT (worker_id) DO UPDATE SET\x20\
               algorithm_versions = EXCLUDED.algorithm_versions,\x20\
               artifact_schema_versions = EXCLUDED.artifact_schema_versions,\x20\
               draining = false, heartbeat_at = clock_timestamp()",
            &[
                &worker_id,
                &json!([ALGORITHM_VERSION]),
                &json!([ARTIFACT_SCHEMA_VERSION]),
            ],
        )
        .await?;
    Ok(())
}

/// Prevents this worker generation from claiming another job.
///
/// # Errors
///
/// Returns an error when `PostgreSQL` rejects the state transition.
pub(crate) async fn mark_draining(client: &Client, worker_id: &str) -> Result<(), ControlError> {
    client
        .execute(
            "UPDATE series_analysis_worker_capabilities\x20\
             SET draining = true, heartbeat_at = clock_timestamp()\x20\
             WHERE worker_id = $1",
            &[&worker_id],
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_refresh_schedule_uses_a_bounded_cadence() {
        assert!(
            i64::try_from(IDLE_REFRESH_INTERVAL.as_secs())
                .is_ok_and(|seconds| seconds * 2 < CAPABILITY_FRESH_SECONDS),
            "idle refresh cadence must leave room for a delayed or failed refresh"
        );
        let registered_at = Instant::now();
        let cases = [
            (Duration::ZERO, false),
            (Duration::from_secs(19), false),
            (Duration::from_secs(20), true),
            (Duration::from_mins(1), true),
            (Duration::from_hours(1), true),
        ];
        let schedule = IdleRefreshSchedule::after_success(registered_at);

        for (elapsed, expected) in cases {
            assert_eq!(
                schedule.is_due_at(registered_at + elapsed),
                expected,
                "unexpected refresh decision after {elapsed:?}"
            );
        }
    }

    #[test]
    fn successful_idle_refresh_restarts_the_cadence() {
        let registered_at = Instant::now();
        let refreshed_at = registered_at + Duration::from_secs(20);
        let mut schedule = IdleRefreshSchedule::after_success(registered_at);

        schedule.record_success_at(refreshed_at);

        assert!(
            !schedule.is_due_at(refreshed_at + Duration::from_secs(19)),
            "a recent successful UPSERT must suppress an early refresh"
        );
        assert!(
            schedule.is_due_at(refreshed_at + Duration::from_secs(20)),
            "the next refresh must become due at the bounded cadence"
        );
    }
}
