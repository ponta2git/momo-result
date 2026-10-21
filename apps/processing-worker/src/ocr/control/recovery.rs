use tokio_postgres::Transaction;

use super::{OcrControlError, OcrFailureCode, sync_match_draft_status};
use crate::job_lease::ExpiredJobLease;

pub(crate) async fn recover_expired_ocr_holder(
    transaction: &Transaction<'_>,
    holder: &ExpiredJobLease,
    maximum_recoveries: i32,
) -> Result<(), OcrControlError> {
    let row = transaction
        .query_opt(
            "SELECT status, lease_owner, attempt_id::text, lease_fencing_token,\x20\
                    lease_expires_at <= clock_timestamp(), lease_recovery_count\x20\
             FROM ocr_jobs WHERE legacy_id = $1 FOR UPDATE",
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
                return Ok(());
            }
            let recoveries: i32 = row.try_get(5)?;
            if recoveries >= maximum_recoveries {
                let failure = OcrFailureCode::OcrTimeout;
                transaction.execute("UPDATE ocr_jobs SET status='failed',failure_code=$2,failure_message=$3,failure_retryable=$4,failure_user_action=$5,finished_at=clock_timestamp(),duration_ms=0,attempt_id=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE legacy_id=$1", &[&holder.job_id,&failure.wire(),&failure.message(),&failure.retryable(),&failure.user_action()]).await?;
                sync_match_draft_status(transaction, &holder.job_id).await?;
            } else {
                let updated = transaction
                .execute(
                    "UPDATE ocr_jobs SET status = 'queued', worker_id = NULL, lease_recovery_count = lease_recovery_count + 1, available_at =\x20\
                       clock_timestamp(), started_at = NULL, attempt_id = NULL, lease_owner = NULL,\x20\
                       lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
                     WHERE legacy_id = $1 AND status = 'running' AND lease_owner = $2\x20\
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
            }
        } else if ownership_matches {
            transaction
                .execute(
                    "UPDATE ocr_jobs SET attempt_id = NULL, lease_owner = NULL, lease_token = NULL,\x20\
                       lease_expires_at = NULL, updated_at = clock_timestamp() WHERE legacy_id = $1\x20\
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
    Ok(())
}
