use std::time::{Duration, Instant};

use serde_json::json;
use tokio_postgres::{Client, GenericClient};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};

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

/// Registers this worker generation's exact algorithm/schema/validation capability set.
///
/// # Errors
///
/// Returns an error when `PostgreSQL` rejects the capability update.
pub(crate) async fn register_capability(
    client: &Client,
    worker_id: &str,
) -> Result<(), ControlError> {
    let capability_id = capability_row_id(worker_id);
    client
        .execute(
            "INSERT INTO series_analysis_worker_capabilities (\x20\
               worker_id, algorithm_versions, artifact_schema_versions, validation_contract_ids,\x20\
               draining, started_at, heartbeat_at\x20\
             ) VALUES ($1, $2, $3, $4, false, clock_timestamp(), clock_timestamp())\x20\
             ON CONFLICT (worker_id) DO UPDATE SET\x20\
               algorithm_versions = EXCLUDED.algorithm_versions,\x20\
               artifact_schema_versions = EXCLUDED.artifact_schema_versions,\x20\
               validation_contract_ids = EXCLUDED.validation_contract_ids,\x20\
               draining = false, heartbeat_at = clock_timestamp()",
            &[
                &capability_id,
                &json!([ALGORITHM_VERSION]),
                &json!([ARTIFACT_SCHEMA_VERSION]),
                &json!([ARTIFACT_VALIDATION_CONTRACT_ID]),
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
    let capability_id = capability_row_id(worker_id);
    client
        .execute(
            "UPDATE series_analysis_worker_capabilities\x20\
             SET draining = true, heartbeat_at = clock_timestamp()\x20\
             WHERE worker_id = $1",
            &[&capability_id],
        )
        .await?;
    Ok(())
}

pub(super) async fn refresh_heartbeat<C>(client: &C, worker_id: &str) -> Result<(), ControlError>
where
    C: GenericClient + Sync,
{
    let capability_id = capability_row_id(worker_id);
    client
        .execute(
            "UPDATE series_analysis_worker_capabilities\x20\
             SET heartbeat_at = clock_timestamp() WHERE worker_id = $1",
            &[&capability_id],
        )
        .await?;
    Ok(())
}

fn capability_row_id(worker_id: &str) -> String {
    format!(
        "{worker_id}@{ALGORITHM_VERSION}@{ARTIFACT_SCHEMA_VERSION}@{ARTIFACT_VALIDATION_CONTRACT_ID}"
    )
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

    #[test]
    fn capability_identity_is_scoped_to_the_complete_worker_generation() {
        let capability_id = capability_row_id("worker-1");

        assert_ne!(capability_id, "worker-1");
        assert!(capability_id.contains(ALGORITHM_VERSION));
        assert!(capability_id.contains(&ARTIFACT_SCHEMA_VERSION.to_string()));
        assert!(capability_id.contains(ARTIFACT_VALIDATION_CONTRACT_ID));
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the isolated database contract test keeps exact persisted capability assertions together"
    )]
    async fn real_postgres_registration_replaces_the_generation_capability_set()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const WORKER_ID: &str = "analysis-capability-smoke-generation";
        let capability_id = capability_row_id(WORKER_ID);
        let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let client = crate::postgres::connect(&database_url).await?;
        client
            .execute(
                "DELETE FROM series_analysis_worker_capabilities WHERE worker_id IN ($1, $2)",
                &[&WORKER_ID, &capability_id],
            )
            .await?;

        register_capability(&client, WORKER_ID).await?;

        let row = client
            .query_one(
                "SELECT algorithm_versions, artifact_schema_versions, validation_contract_ids, draining\x20\
                 FROM series_analysis_worker_capabilities WHERE worker_id = $1",
                &[&capability_id],
            )
            .await?;
        assert_eq!(
            row.try_get::<_, serde_json::Value>(0)?,
            json!([ALGORITHM_VERSION])
        );
        assert_eq!(
            row.try_get::<_, serde_json::Value>(1)?,
            json!([ARTIFACT_SCHEMA_VERSION])
        );
        assert_eq!(
            row.try_get::<_, serde_json::Value>(2)?,
            json!([ARTIFACT_VALIDATION_CONTRACT_ID])
        );
        assert!(!row.try_get::<_, bool>(3)?);

        // A rollback to a pre-attestation binary writes the unscoped legacy ID and cannot inherit
        // this generation's validation contract through its narrower ON CONFLICT update.
        client
            .execute(
                "INSERT INTO series_analysis_worker_capabilities (\x20\
                   worker_id, algorithm_versions, artifact_schema_versions, draining, heartbeat_at\x20\
                 ) VALUES ($1, $2, $3, false, clock_timestamp())\x20\
                 ON CONFLICT (worker_id) DO UPDATE SET\x20\
                   algorithm_versions = EXCLUDED.algorithm_versions,\x20\
                   artifact_schema_versions = EXCLUDED.artifact_schema_versions,\x20\
                   draining = false, heartbeat_at = clock_timestamp()",
                &[
                    &WORKER_ID,
                    &json!([ALGORITHM_VERSION]),
                    &json!([ARTIFACT_SCHEMA_VERSION]),
                ],
            )
            .await?;
        let legacy_contracts = client
            .query_one(
                "SELECT validation_contract_ids FROM series_analysis_worker_capabilities\x20\
                 WHERE worker_id = $1",
                &[&WORKER_ID],
            )
            .await?
            .try_get::<_, serde_json::Value>(0)?;
        assert_eq!(legacy_contracts, json!([]));

        client
            .execute(
                "DELETE FROM series_analysis_worker_capabilities WHERE worker_id IN ($1, $2)",
                &[&WORKER_ID, &capability_id],
            )
            .await?;
        Ok(())
    }
}
