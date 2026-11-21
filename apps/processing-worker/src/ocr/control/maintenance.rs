//! Repairs durable OCR lifecycle state independently of queue delivery.
use super::{
    OcrControlError, OcrFailureCode, bounded_transaction, duration_milliseconds,
    lock_match_drafts_for_job, sync_match_draft_status,
};
use std::time::Duration;
use tokio_postgres::{Client, Row};

pub(crate) async fn reap_stale(
    client: &mut Client,
    stale_after: Duration,
    timeout: Duration,
) -> Result<(), OcrControlError> {
    let stale_ms = duration_milliseconds(stale_after)?;
    let mut changed = false;
    let result = async {
        let stale = client.query(
            "SELECT legacy_id FROM ocr_jobs
             WHERE status IN ('queued','running')
               AND COALESCE(started_at,created_at) < clock_timestamp()-$1::bigint * interval '1 millisecond'
               AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
             ORDER BY created_at,legacy_id LIMIT 64",
            &[&stale_ms],
        ).await?;
        repair_candidates(client, stale, Some(stale_ms), timeout, &mut changed).await?;

        // A previous terminal commit may predate a draft projection update. Bound repairs separately.
        let repairs = client.query(
            "SELECT DISTINCT j.legacy_id FROM match_drafts md
             JOIN ocr_jobs j ON j.draft_id IN (md.total_assets_draft_id,md.revenue_draft_id,md.incident_log_draft_id)
             WHERE md.status='ocr_running' AND j.status IN ('succeeded','failed','cancelled')
               AND NOT EXISTS (
                 SELECT 1 FROM unnest(ARRAY[md.total_assets_draft_id,md.revenue_draft_id,md.incident_log_draft_id]) slot(draft_id)
                 LEFT JOIN ocr_jobs pending ON pending.draft_id=slot.draft_id
                 WHERE slot.draft_id IS NOT NULL AND (pending.status IS NULL OR pending.status IN ('queued','running'))
               )
             ORDER BY j.legacy_id LIMIT 64",
            &[],
        ).await?;
        repair_candidates(client, repairs, None, timeout, &mut changed).await
    }.await;
    // Each candidate commits independently. An error on a later candidate cannot undo a repair.
    if changed {
        super::super::submissions::wake(client).await;
    }
    result
}

async fn repair_candidates(
    client: &mut Client,
    candidates: Vec<Row>,
    stale_ms: Option<i64>,
    timeout: Duration,
    changed: &mut bool,
) -> Result<(), OcrControlError> {
    for row in candidates {
        let id: String = row.try_get(0)?;
        match repair_candidate(client, &id, stale_ms, timeout).await {
            Ok(committed) => *changed |= committed,
            Err(error) if error.is_contention() => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

async fn repair_candidate(
    client: &mut Client,
    id: &str,
    stale_ms: Option<i64>,
    timeout: Duration,
) -> Result<bool, OcrControlError> {
    let tx = bounded_transaction(client, timeout).await?;
    tx.batch_execute("SET LOCAL lock_timeout='100ms'").await?;
    lock_match_drafts_for_job(&tx, id).await?;
    let expired = if let Some(stale_ms) = stale_ms {
        let failure = OcrFailureCode::OcrTimeout;
        tx.execute(
            "UPDATE ocr_jobs SET status='failed',failure_code=$2,failure_message=$3,
               failure_retryable=$4,failure_user_action=$5,finished_at=clock_timestamp(),duration_ms=0,
               attempt_id=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
             WHERE legacy_id=$1 AND status IN ('queued','running')
               AND COALESCE(started_at,created_at) < clock_timestamp()-$6::bigint * interval '1 millisecond'
               AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())",
            &[
                &id,
                &failure.wire(),
                &failure.message(),
                &failure.retryable(),
                &failure.user_action(),
                &stale_ms,
            ],
        ).await? != 0
    } else {
        false
    };
    let draft_changed = sync_match_draft_status(&tx, id).await?;
    tx.commit().await?;
    Ok(expired || draft_changed)
}
