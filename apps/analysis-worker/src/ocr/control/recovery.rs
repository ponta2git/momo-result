use tokio_postgres::Transaction;

use super::OcrControlError;
use crate::{
    control::recover_expired_analysis_holder,
    execution_slot::{ExecutionSlotHolder, ExecutionTaskKind, clear_expired},
};

pub(super) async fn recover_expired_holder(
    transaction: &Transaction<'_>,
    holder: &ExecutionSlotHolder,
) -> Result<(), OcrControlError> {
    match holder.task_kind {
        ExecutionTaskKind::Analysis => {
            recover_expired_analysis_holder(transaction, holder)
                .await
                .map_err(|error| OcrControlError::AnalysisRecovery(error.kind()))?;
            Ok(())
        }
        ExecutionTaskKind::Ocr => recover_expired_ocr_holder(transaction, holder).await,
    }
}

async fn recover_expired_ocr_holder(
    transaction: &Transaction<'_>,
    holder: &ExecutionSlotHolder,
) -> Result<(), OcrControlError> {
    let row = transaction
        .query_opt(
            "SELECT status, lease_owner, attempt_id::text, lease_fencing_token,\x20\
                    lease_expires_at <= clock_timestamp()\x20\
             FROM ocr_jobs WHERE id = $1 FOR UPDATE",
            &[&holder.job_id],
        )
        .await?;
    if let Some(row) = row {
        let status = row.try_get::<_, String>(0)?;
        let ownership_matches = row.try_get::<_, Option<String>>(1)?.as_deref()
            == Some(holder.owner.as_str())
            && row.try_get::<_, Option<String>>(2)?.as_deref() == Some(holder.attempt_id.as_str())
            && row.try_get::<_, i64>(3)? == holder.fencing_token;
        let job_expired = row.try_get::<_, Option<bool>>(4)?.unwrap_or(false);
        if status == "running" {
            if !ownership_matches || !job_expired {
                return Err(OcrControlError::InvalidState);
            }
            let updated = transaction
                .execute(
                    "UPDATE ocr_jobs SET status = 'queued', worker_id = NULL, available_at =\x20\
                       clock_timestamp(), started_at = NULL, attempt_id = NULL, lease_owner = NULL,\x20\
                       lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
                     WHERE id = $1 AND status = 'running' AND lease_owner = $2\x20\
                       AND attempt_id::text = $3 AND lease_fencing_token = $4\x20\
                       AND lease_expires_at <= clock_timestamp()",
                    &[
                        &holder.job_id,
                        &holder.owner,
                        &holder.attempt_id,
                        &holder.fencing_token,
                    ],
                )
                .await?;
            if updated != 1 {
                return Err(OcrControlError::OwnerLost);
            }
        } else if ownership_matches {
            transaction
                .execute(
                    "UPDATE ocr_jobs SET attempt_id = NULL, lease_owner = NULL, lease_token = NULL,\x20\
                       lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = $1\x20\
                       AND lease_owner = $2 AND attempt_id::text = $3 AND lease_fencing_token = $4",
                    &[
                        &holder.job_id,
                        &holder.owner,
                        &holder.attempt_id,
                        &holder.fencing_token,
                    ],
                )
                .await?;
        }
    }
    if !clear_expired(transaction, holder).await? {
        return Err(OcrControlError::OwnerLost);
    }
    Ok(())
}
