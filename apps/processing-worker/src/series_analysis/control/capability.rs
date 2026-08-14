use serde_json::json;
use tokio_postgres::Client;

use momo_analysis_core::contract::ARTIFACT_SCHEMA_VERSION;

use super::{ALGORITHM_VERSION, ControlError};

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
