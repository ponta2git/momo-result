//! Only this command moves an ordinary submission from open to settled.

use crate::notifications::{
    NotificationSink, PreparedNotification, log_skip,
    ocr::{self, Failure},
};
use std::time::Duration;
use thiserror::Error;
use tokio::time::{Instant, timeout_at};
use tokio_postgres::{Client, Transaction};

pub(crate) enum Settlement {
    Open,
    Busy,
    Closed,
    Aborted,
    Settled(Option<PreparedNotification>),
}

#[derive(Debug, Error)]
pub(crate) enum SubmissionError {
    #[error("OCR submission database operation failed")]
    Database(#[from] tokio_postgres::Error),
    #[error("OCR submission finalization deadline elapsed")]
    Deadline,
    #[error("OCR submission references violate the saved contract")]
    InvalidState,
}

pub(crate) async fn settle(
    client: &mut Client,
    id: &str,
    timeout: Duration,
    sink: &NotificationSink,
) -> Result<Settlement, SubmissionError> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(SubmissionError::Deadline)?;
    timeout_at(
        deadline,
        settle_transaction(client, id, timeout, deadline, sink),
    )
    .await
    .map_err(|_elapsed| SubmissionError::Deadline)?
}

async fn settle_transaction(
    client: &mut Client,
    id: &str,
    timeout: Duration,
    deadline: Instant,
    sink: &NotificationSink,
) -> Result<Settlement, SubmissionError> {
    let transaction = client.transaction().await?;
    let milliseconds = format!("{}ms", timeout.as_millis().max(1));
    transaction.query_one("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)", &[&milliseconds]).await?;
    let Some(source) = transaction
        .query_opt(
            "SELECT match_draft_id FROM ocr_submissions WHERE id = $1 AND status = 'open'",
            &[&id],
        )
        .await?
    else {
        return Ok(Settlement::Closed);
    };
    let draft_id: String = source.get(0);
    // All source writers lock draft before submission. SKIP LOCKED gives a busy source its next
    // fair turn without blocking other submissions; a separate read distinguishes deletion.
    let draft = transaction
        .query_opt(
            "SELECT status FROM match_drafts WHERE id = $1 FOR UPDATE SKIP LOCKED",
            &[&draft_id],
        )
        .await?;
    if draft.is_none()
        && transaction
            .query_opt("SELECT id FROM match_drafts WHERE id = $1", &[&draft_id])
            .await?
            .is_some()
    {
        return Ok(Settlement::Busy);
    }
    let Some(header) = transaction
        .query_opt(
            "SELECT status FROM ocr_submissions WHERE id = $1 FOR UPDATE SKIP LOCKED",
            &[&id],
        )
        .await?
    else {
        return Ok(Settlement::Busy);
    };
    if header.get::<_, String>(0) != "open" {
        return Ok(Settlement::Closed);
    }
    if draft.is_none_or(|row| matches!(row.get::<_, &str>(0), "confirmed" | "cancelled")) {
        transaction.execute("UPDATE ocr_submissions SET status = 'aborted', finished_at = clock_timestamp() WHERE id = $1", &[&id]).await?;
        transaction.commit().await?;
        return Ok(Settlement::Aborted);
    }
    transaction.execute("UPDATE ocr_submission_members m SET status = 'failed', failure_code = 'admission_timeout' \
        FROM ocr_submissions s WHERE s.id = $1 AND m.submission_id = s.id AND m.status = 'pending' \
        AND s.admission_deadline <= clock_timestamp()", &[&id]).await?;
    let members = transaction.query("SELECT m.screen_type, m.status, m.failure_code, j.status AS job_status, j.failure_code AS job_failure, j.requested_screen_type AS job_screen_type \
        FROM ocr_submission_members m LEFT JOIN ocr_jobs j ON j.id = m.job_id WHERE m.submission_id = $1 \
        ORDER BY CASE m.screen_type WHEN 'total_assets' THEN 0 WHEN 'revenue' THEN 1 ELSE 2 END", &[&id]).await?;
    if members.is_empty() || members.len() > 3 {
        return Err(SubmissionError::InvalidState);
    }
    let mut failures = Vec::new();
    let mut open = false;
    for member in members {
        let screen: String = member.get("screen_type");
        let status: &str = member.get("status");
        let failure: Option<&str> = member.get("failure_code");
        let job: Option<&str> = member.get("job_status");
        let job_failure: Option<&str> = member.get("job_failure");
        let job_screen: Option<&str> = member.get("job_screen_type");
        if status == "registered" && job_screen != Some(screen.as_str()) {
            return Err(SubmissionError::InvalidState);
        }
        let result = outcome(status, failure, job, job_failure)?;
        match result {
            Outcome::Pending => open = true,
            Outcome::Succeeded => (),
            Outcome::Failed(reason) => failures.push(Failure {
                screen_type: screen,
                reason,
            }),
        }
    }
    if open {
        transaction.commit().await?;
        return Ok(Settlement::Open);
    }
    project_empty_draft(&transaction, id, &draft_id).await?;
    transaction.execute("UPDATE ocr_submissions SET status = 'settled', finished_at = clock_timestamp() WHERE id = $1", &[&id]).await?;
    let notification = match sink.reserve(ocr::MAXIMUM_SNAPSHOT_BYTES) {
        Ok(reservation) => ocr::prepare(&transaction, reservation, id, failures, deadline).await?,
        Err(reason) => {
            log_skip("ocr_completed", id, reason);
            None
        }
    };
    transaction.commit().await?;
    Ok(Settlement::Settled(notification))
}

async fn project_empty_draft(
    transaction: &Transaction<'_>,
    id: &str,
    draft_id: &str,
) -> Result<(), SubmissionError> {
    transaction.execute("UPDATE match_drafts md SET status = 'ocr_failed', updated_at = clock_timestamp() \
        WHERE md.id = $1 AND md.status = 'ocr_running' AND md.total_assets_draft_id IS NULL \
        AND md.revenue_draft_id IS NULL AND md.incident_log_draft_id IS NULL \
        AND md.total_assets_image_id IS NULL AND md.revenue_image_id IS NULL AND md.incident_log_image_id IS NULL \
        AND NOT EXISTS (SELECT 1 FROM ocr_submissions s WHERE s.match_draft_id = md.id AND s.id <> $2 AND s.status = 'open')",
        &[&draft_id, &id]).await?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Pending,
    Succeeded,
    Failed(&'static str),
}

fn outcome(
    status: &str,
    failure: Option<&str>,
    job: Option<&str>,
    job_failure: Option<&str>,
) -> Result<Outcome, SubmissionError> {
    match (status, failure, job) {
        ("pending", None, None) | ("registered", None, Some("queued" | "running")) => {
            Ok(Outcome::Pending)
        }
        ("failed", Some("admission_failed"), None) => Ok(Outcome::Failed("admission_failed")),
        ("failed", Some("admission_timeout"), None) => Ok(Outcome::Failed("admission_timeout")),
        ("registered", None, Some("succeeded")) => Ok(Outcome::Succeeded),
        ("registered", None, Some("cancelled")) => Ok(Outcome::Failed("cancelled")),
        ("registered", None, Some("failed")) => {
            Ok(Outcome::Failed(if job_failure == Some("OCR_TIMEOUT") {
                "ocr_timeout"
            } else {
                "ocr_failed"
            }))
        }
        _ => Err(SubmissionError::InvalidState),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_saved_terminal_members_finish_and_failures_are_safe() {
        assert_eq!(
            outcome("pending", None, None, None).ok(),
            Some(Outcome::Pending)
        );
        assert_eq!(
            outcome("registered", None, Some("running"), None).ok(),
            Some(Outcome::Pending)
        );
        assert_eq!(
            outcome("registered", None, Some("succeeded"), None).ok(),
            Some(Outcome::Succeeded)
        );
        assert_eq!(
            outcome("registered", None, Some("failed"), Some("OCR_TIMEOUT")).ok(),
            Some(Outcome::Failed("ocr_timeout"))
        );
        assert_eq!(
            outcome("registered", None, Some("failed"), Some("untrusted detail")).ok(),
            Some(Outcome::Failed("ocr_failed"))
        );
        assert!(
            outcome("registered", None, None, None).is_err(),
            "missing job cannot count as complete"
        );
    }
}
