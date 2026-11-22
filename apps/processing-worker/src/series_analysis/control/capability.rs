use serde_json::json;
use tokio_postgres::{Client, GenericClient};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};

use super::{ALGORITHM_VERSION, ControlError};

pub(crate) const CAPABILITY_FRESH_SECONDS: i64 = 180;
/// Register before reading the singleton, serializing boot/rejoin with promotion's
/// registry -> singleton lock order. Candidates can attest while admission is closed.
pub(crate) async fn admit_capability(
    client: &mut Client,
    worker_id: &str,
) -> Result<bool, ControlError> {
    let tx = client.transaction().await?;
    register_capability(&tx, worker_id).await?;
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    let admitted = tx
        .query_one(
            "SELECT algorithm_version = $1 AND artifact_schema_version = $2 \
        AND validation_contract_id IS NOT DISTINCT FROM $3 FROM series_analysis_release_state \
        WHERE singleton_key='current' FOR SHARE",
            &[
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?
        .try_get(0)?;
    tx.commit().await?;
    Ok(admitted)
}

/// Registers this worker generation's exact algorithm/schema/validation capability set.
///
/// # Errors
///
/// Returns an error when `PostgreSQL` rejects the capability update.
async fn register_capability<C: GenericClient + Sync>(
    client: &C,
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
        .execute_typed(
            "UPDATE series_analysis_worker_capabilities\x20\
             SET heartbeat_at = clock_timestamp() WHERE worker_id = $1",
            &[(&capability_id, tokio_postgres::types::Type::TEXT)],
        )
        .await?;
    Ok(())
}

pub(crate) fn capability_row_id(worker_id: &str) -> String {
    format!(
        "{worker_id}@{ALGORITHM_VERSION}@{ARTIFACT_SCHEMA_VERSION}@{ARTIFACT_VALIDATION_CONTRACT_ID}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let client = crate::identity::fixtures::connect(&database_url).await?;
        client
            .execute(
                "DELETE FROM series_analysis_worker_capabilities WHERE worker_id IN ($1, $2)",
                &[&WORKER_ID, &capability_id],
            )
            .await?;

        register_capability(&*client, WORKER_ID).await?;

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
