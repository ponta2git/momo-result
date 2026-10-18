//! Repairs durable OCR lifecycle state independently of queue delivery.
use super::{
    OcrControlError, OcrFailureCode, bounded_transaction, duration_milliseconds,
    lock_match_drafts_for_job, sync_match_draft_status,
};
use std::time::Duration;
use tokio_postgres::Client;

pub(crate) async fn reap_stale(
    client: &mut Client,
    stale_after: Duration,
    timeout: Duration,
) -> Result<(), OcrControlError> {
    let stale_ms = duration_milliseconds(stale_after)?;
    let rows = client.query("SELECT legacy_id FROM ocr_jobs WHERE status IN ('queued','running') AND COALESCE(started_at,created_at) < clock_timestamp()-$1::bigint * interval '1 millisecond' AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) ORDER BY created_at,legacy_id LIMIT 64", &[&stale_ms]).await?;
    for row in rows {
        let id: String = row.try_get(0)?;
        let result=async {
        let tx = bounded_transaction(client, timeout).await?;
        tx.batch_execute("SET LOCAL lock_timeout='100ms'").await?;
        lock_match_drafts_for_job(&tx, &id).await?;
        let failure = OcrFailureCode::OcrTimeout;
        tx.execute("UPDATE ocr_jobs SET status='failed',failure_code=$2,failure_message=$3,failure_retryable=$4,failure_user_action=$5,finished_at=clock_timestamp(),duration_ms=0,attempt_id=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE legacy_id=$1 AND status IN ('queued','running') AND COALESCE(started_at,created_at) < clock_timestamp()-$6::bigint * interval '1 millisecond' AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())", &[&id,&failure.wire(),&failure.message(),&failure.retryable(),&failure.user_action(),&stale_ms]).await?;
        sync_match_draft_status(&tx, &id).await?;
        tx.commit().await?;
        Ok::<(),OcrControlError>(())
        }.await;
        match result {
            Ok(()) => {}
            Err(error) if error.is_contention() => {}
            Err(error) => return Err(error),
        }
    }
    // A previous terminal commit may predate a draft projection update. Bound repairs separately.
    let repairs = client.query("SELECT DISTINCT j.legacy_id FROM match_drafts md JOIN ocr_jobs j ON j.draft_id IN (md.total_assets_draft_id,md.revenue_draft_id,md.incident_log_draft_id) WHERE md.status='ocr_running' AND j.status IN ('succeeded','failed','cancelled') AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[md.total_assets_draft_id,md.revenue_draft_id,md.incident_log_draft_id]) slot(draft_id) LEFT JOIN ocr_jobs pending ON pending.draft_id=slot.draft_id WHERE slot.draft_id IS NOT NULL AND (pending.status IS NULL OR pending.status IN ('queued','running'))) ORDER BY j.legacy_id LIMIT 64", &[]).await?;
    for row in repairs {
        let id: String = row.try_get(0)?;
        let result = async {
            let tx = bounded_transaction(client, timeout).await?;
            tx.batch_execute("SET LOCAL lock_timeout='100ms'").await?;
            lock_match_drafts_for_job(&tx, &id).await?;
            sync_match_draft_status(&tx, &id).await?;
            tx.commit().await?;
            Ok::<(), OcrControlError>(())
        }
        .await;
        match result {
            Ok(()) => {}
            Err(error) if error.is_contention() => {}
            Err(error) => return Err(error),
        }
    }
    super::super::submissions::wake(client).await;
    Ok(())
}
