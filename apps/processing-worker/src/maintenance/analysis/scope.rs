//! Read-only plan binding and transaction-local fences for the single approved campaign.
use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio_postgres::{Client, GenericClient, IsolationLevel, Row, Transaction};

use super::{BoundScope, Report, Request, ScopeError};
use crate::series_analysis::control::ALGORITHM_VERSION;

pub(crate) async fn inspect(client: &mut Client, request: &Request) -> Result<Report, ScopeError> {
    let transaction = client
        .build_transaction()
        .read_only(true)
        .isolation_level(IsolationLevel::RepeatableRead)
        .start()
        .await?;
    transaction
        .batch_execute("SET LOCAL statement_timeout='10000ms'; SET LOCAL lock_timeout='100ms'")
        .await?;
    let report = inspect_in(&transaction, request).await?;
    transaction.commit().await?;
    Ok(report)
}

pub(crate) async fn validate(
    transaction: &Transaction<'_>,
    scope: &BoundScope,
) -> Result<(), ScopeError> {
    let report = inspect_in(transaction, &scope.request).await?;
    scope.accept(&report)
}

async fn inspect_in(
    client: &(impl GenericClient + Sync),
    request: &Request,
) -> Result<Report, ScopeError> {
    let campaign = campaign(client, request).await?;
    let targets = client
        .query(TARGET_SQL, &[&request.campaign_id, &request.operation_id])
        .await?;
    let target_count = u64::try_from(campaign.try_get::<_, i32>("target_count")?)
        .map_err(|_error| ScopeError::Scope)?;
    if u64::try_from(targets.len()).ok() != Some(target_count) {
        return Err(ScopeError::Scope);
    }
    let mut bindings = Vec::with_capacity(targets.len());
    let mut completed_count = 0;
    let mut failed_count = 0;
    let mut blocked = false;
    let mut next_pending_title = None;
    let mut next_job = None;
    for target in &targets {
        bindings.push(target.try_get::<_, Value>("binding")?);
        blocked |= !target.try_get::<_, bool>("safe")?;
        match target.try_get::<_, &str>("status")? {
            "succeeded" | "skipped_title_deleted" => completed_count += 1,
            "failed" => failed_count += 1,
            "pending" => {
                next_pending_title.get_or_insert(target.try_get::<_, String>("game_title_id")?);
            }
            "expanded" => {
                if let Some(job) = target.try_get::<_, Option<String>>("assigned_job_id")? {
                    next_job.get_or_insert(job);
                } else {
                    blocked = true;
                }
            }
            _ => blocked = true,
        }
    }
    blocked |= !client.query_one(
        "SELECT NOT EXISTS (SELECT 1 FROM series_analysis_jobs WHERE status='running') AND NOT EXISTS (SELECT 1 FROM ocr_jobs WHERE status='running')", &[]
    ).await?.try_get::<_, bool>(0)?;
    let complete = completed_count == target_count && failed_count == 0;
    if complete {
        blocked |= campaign.try_get::<_, &str>("status")? != "terminal"
            || campaign.try_get::<_, &str>("operation_status")? != "terminal";
    }
    let binding = json!([
        1,
        request,
        campaign.try_get::<_, Value>("binding")?,
        bindings
    ]);
    let digest = Sha256::digest(serde_json::to_vec(&binding).map_err(|_error| ScopeError::Scope)?);
    Ok(Report {
        schema_version: 1,
        request: request.clone(),
        plan_digest: format!("sha256:{}", hex::encode(digest)),
        status: if blocked || failed_count > 0 {
            "attention_required"
        } else if complete {
            "complete"
        } else {
            "planned"
        },
        target_count,
        completed_count,
        failed_count,
        next_pending_title,
        next_job,
    })
}

async fn campaign(
    client: &(impl GenericClient + Sync),
    request: &Request,
) -> Result<Row, ScopeError> {
    let row = client.query_opt(
        "SELECT c.target_count,c.status,o.status AS operation_status, \
          jsonb_build_array(c.id,c.operation_request_id,c.trigger,c.algorithm_version,c.artifact_schema_version,c.validation_contract_id, \
            c.target_count,extract(epoch FROM c.accepted_at)::text,o.scope,o.endpoint,o.idempotency_key_hash,extract(epoch FROM o.accepted_at)::text, \
            r.algorithm_version,r.artifact_schema_version,r.validation_contract_id,extract(epoch FROM r.updated_at)::text) AS binding, \
          c.operation_request_id=$2 AND o.scope='all_titles' AND o.requested_by_account_id IS NULL \
          AND o.target_count=c.target_count AND o.endpoint='release:'||c.trigger \
          AND c.trigger IN ('algorithm_update','artifact_schema_update','validation_contract_update','initial_backfill') \
          AND c.algorithm_version=$3 AND c.artifact_schema_version=$4::bigint::integer AND c.validation_contract_id=$5 \
          AND r.algorithm_version=c.algorithm_version AND r.artifact_schema_version=c.artifact_schema_version \
          AND r.validation_contract_id IS NOT DISTINCT FROM c.validation_contract_id AS valid \
         FROM series_analysis_campaigns c JOIN series_analysis_operation_requests o ON o.id=c.operation_request_id \
         CROSS JOIN series_analysis_release_state r WHERE c.id=$1 AND r.singleton_key='current'",
        &[&request.campaign_id, &request.operation_id, &ALGORITHM_VERSION, &i64::from(ARTIFACT_SCHEMA_VERSION), &ARTIFACT_VALIDATION_CONTRACT_ID]
    ).await?.ok_or(ScopeError::Scope)?;
    if !row.try_get::<_, bool>("valid")? {
        return Err(ScopeError::Scope);
    }
    Ok(row)
}

const TARGET_SQL: &str = " \
SELECT t.game_title_id,t.status,r.assigned_job_id, \
 jsonb_build_array(t.game_title_id,t.input_revision,t.algorithm_version,t.artifact_schema_version,t.validation_contract_id, \
   extract(epoch FROM t.accepted_at)::text,s.input_revision,s.algorithm_version,s.artifact_schema_version,s.validation_contract_id, \
   radar.desired_basis_id,COALESCE(radar.generation,0)) AS binding, \
 COALESCE(t.algorithm_version=c.algorithm_version AND t.artifact_schema_version=c.artifact_schema_version \
   AND t.validation_contract_id IS NOT DISTINCT FROM c.validation_contract_id \
   AND (s.game_title_id IS NULL OR (s.input_revision>=t.input_revision AND s.algorithm_version=c.algorithm_version \
     AND s.artifact_schema_version=c.artifact_schema_version AND s.validation_contract_id IS NOT DISTINCT FROM c.validation_contract_id)) \
   AND (t.status IN ('pending','skipped_title_deleted') OR (r.id IS NOT NULL AND r.campaign_id=$1 AND r.operation_request_id=$2 \
     AND r.game_title_id=t.game_title_id AND r.trigger=c.trigger)) \
   AND (t.status NOT IN ('succeeded','failed') OR r.status='fulfilled') \
   AND (t.status<>'expanded' OR (r.status='pending' AND j.status='queued' AND j.work_kind='analysis' \
     AND j.trigger=c.trigger AND j.input_revision=s.input_revision AND j.algorithm_version=s.algorithm_version \
     AND j.artifact_schema_version=s.artifact_schema_version AND j.validation_contract_id IS NOT DISTINCT FROM s.validation_contract_id)) \
   AND NOT EXISTS (SELECT 1 FROM series_analysis_job_requests x WHERE x.game_title_id=t.game_title_id AND x.status<>'fulfilled' \
     AND (x.campaign_id IS DISTINCT FROM $1 OR x.operation_request_id IS DISTINCT FROM $2 OR x.id IS DISTINCT FROM t.job_request_id)) \
   AND NOT EXISTS (SELECT 1 FROM series_analysis_jobs x WHERE x.game_title_id=t.game_title_id AND x.status IN ('queued','running') \
     AND (x.id IS DISTINCT FROM r.assigned_job_id OR x.status='running')) \
   AND NOT EXISTS (SELECT 1 FROM series_radar_operations x WHERE x.game_title_id=t.game_title_id AND x.status IN ('pending','running')),false) AS safe \
 FROM series_analysis_campaign_targets t JOIN series_analysis_campaigns c ON c.id=t.campaign_id \
 LEFT JOIN series_analysis_title_states s ON s.game_title_id=t.game_title_id \
 LEFT JOIN series_radar_title_states radar ON radar.game_title_id=t.game_title_id \
 LEFT JOIN series_analysis_job_requests r ON r.id=t.job_request_id \
 LEFT JOIN series_analysis_jobs j ON j.id=r.assigned_job_id \
 WHERE t.campaign_id=$1 ORDER BY t.game_title_id";

#[cfg(test)]
mod tests;
