use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use tokio_postgres::{Client, Transaction};

use super::super::{ALGORITHM_VERSION, DeliveryReason, transaction::stable_id};

/// Both maintenance recovery and radar preparation use the same oldest pending title intent.
pub(crate) async fn materialize_pending(
    client: &mut Client,
    limit: i64,
) -> Result<usize, tokio_postgres::Error> {
    let titles = client.query(
        "SELECT s.game_title_id FROM series_analysis_title_states s WHERE \
         (EXISTS (SELECT 1 FROM series_radar_operations o WHERE o.game_title_id=s.game_title_id AND o.status='pending' AND o.job_id IS NULL AND o.kind IN ('candidate','preview','restore','apply')) \
          OR EXISTS (SELECT 1 FROM series_analysis_job_requests r WHERE r.game_title_id=s.game_title_id AND r.status='pending')) \
         AND NOT EXISTS (SELECT 1 FROM series_analysis_jobs j WHERE j.game_title_id=s.game_title_id AND j.status IN ('queued','running')) \
         ORDER BY s.game_title_id LIMIT $1", &[&limit]).await?;
    let mut count = 0;
    for title in titles {
        let title: String = title.try_get(0)?;
        let tx = client.transaction().await?;
        tx.batch_execute("SET LOCAL statement_timeout='10000ms'; SET LOCAL lock_timeout='5000ms'")
            .await?;
        count += usize::from(materialize_next(&tx, &title).await?);
        tx.commit().await?;
    }
    Ok(count)
}

/// The title lock is shared with every normal and radar job producer; only one job can be active.
pub(in crate::series_analysis::control) async fn materialize_next(
    tx: &Transaction<'_>,
    title: &str,
) -> Result<bool, tokio_postgres::Error> {
    let desired = tx.query_opt("SELECT input_revision,algorithm_version,artifact_schema_version,validation_contract_id FROM series_analysis_title_states WHERE game_title_id=$1 FOR UPDATE", &[&title]).await?;
    let Some(desired) = desired else {
        return Ok(false);
    };
    let algorithm: String = desired.try_get(1)?;
    let schema: i32 = desired.try_get(2)?;
    let contract: Option<String> = desired.try_get(3)?;
    if algorithm != ALGORITHM_VERSION
        || u32::try_from(schema).ok() != Some(ARTIFACT_SCHEMA_VERSION)
        || contract.as_deref() != Some(ARTIFACT_VALIDATION_CONTRACT_ID)
    {
        return Ok(false);
    }
    if tx.query_opt("SELECT id FROM series_analysis_jobs WHERE game_title_id=$1 AND status IN ('queued','running') FOR UPDATE", &[&title]).await?.is_some() { return Ok(false); }
    let intent = tx.query_opt(
        "SELECT origin,id,kind FROM (\
         SELECT 'radar'::text AS origin,id,kind,requested_at AS accepted_at FROM series_radar_operations WHERE game_title_id=$1 AND status='pending' AND job_id IS NULL AND kind IN ('candidate','preview','restore','apply') \
         UNION ALL SELECT 'analysis',id,trigger,accepted_at FROM series_analysis_job_requests WHERE game_title_id=$1 AND status='pending'\
         ) intents ORDER BY accepted_at,id LIMIT 1", &[&title]).await?;
    let Some(intent) = intent else {
        return Ok(false);
    };
    let is_radar = intent.try_get::<_, String>(0)? == "radar";
    let id: String = intent.try_get(1)?;
    let kind: String = intent.try_get(2)?;
    let job_id = if is_radar {
        stable_id("radar-job", &[&id])
    } else {
        stable_id("analysis-job-followup", &[title, &id])
    };
    let purpose = if is_radar && kind != "apply" {
        "radar_prepare"
    } else {
        "analysis"
    };
    let operation_id = (purpose == "radar_prepare").then_some(id.as_str());
    let trigger = if is_radar { "manual" } else { kind.as_str() };
    let revision: i64 = desired.try_get(0)?;
    tx.execute("INSERT INTO series_analysis_jobs (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,trigger,work_kind,radar_operation_id) VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9)", &[&job_id,&title,&revision,&algorithm,&schema,&contract,&trigger,&purpose,&operation_id]).await?;
    if is_radar {
        tx.execute("UPDATE series_radar_operations SET job_id=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND job_id IS NULL", &[&id,&job_id]).await?;
    } else {
        tx.execute("UPDATE series_analysis_job_requests SET assigned_job_id=$1,assigned_attempt_id=NULL WHERE game_title_id=$2 AND status='pending'", &[&job_id,&title]).await?;
        tx.execute("UPDATE series_analysis_title_states SET pending_work=true,pending_forced_run_count=0,updated_at=clock_timestamp() WHERE game_title_id=$1", &[&title]).await?;
        tx.execute("UPDATE series_analysis_campaign_targets t SET status='expanded',updated_at=clock_timestamp() FROM series_analysis_job_requests r WHERE t.job_request_id=r.id AND r.assigned_job_id=$1", &[&job_id]).await?;
    }
    let delivery_reason = DeliveryReason::FollowUp.wire();
    let outbox_id = stable_id("analysis-outbox", &[&job_id, delivery_reason, "0"]);
    let dedupe = format!("{job_id}:{delivery_reason}:0");
    tx.execute("INSERT INTO series_analysis_queue_outbox (id,job_id,dedupe_key,next_attempt_at) VALUES ($1,$2,$3,(SELECT available_at FROM series_analysis_jobs WHERE id=$2)) ON CONFLICT(dedupe_key) DO NOTHING", &[&outbox_id,&job_id,&dedupe]).await?;
    Ok(true)
}
