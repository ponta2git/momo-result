use std::time::{Duration, SystemTime};

use tokio_postgres::Client;

use super::ControlError;

pub(crate) const HISTORY_CLEANUP_INTERVAL: Duration = Duration::from_hours(1);

const DELETE_HISTORY: [&str; 5] = [
    r"
      DELETE FROM series_analysis_operation_requests
      WHERE id IN (
        SELECT id FROM series_analysis_operation_requests
        WHERE status = 'terminal' AND finished_at < ($1::timestamptz - interval '45 days')
        ORDER BY finished_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
    ",
    r"
      DELETE FROM series_analysis_job_requests
      WHERE id IN (
        SELECT id FROM series_analysis_job_requests
        WHERE status = 'fulfilled'
          AND fulfilled_at < ($1::timestamptz - interval '45 days')
          AND operation_request_id IS NULL
          AND campaign_id IS NULL
        ORDER BY fulfilled_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
    ",
    r"
      DELETE FROM series_analysis_jobs
      WHERE id IN (
        SELECT id FROM series_analysis_jobs
        WHERE status IN ('succeeded', 'failed', 'timed_out')
          AND finished_at < ($1::timestamptz - interval '45 days')
        ORDER BY finished_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
    ",
    r"
      DELETE FROM series_analysis_artifacts
      WHERE id IN (
        SELECT a.id FROM series_analysis_artifacts a
        WHERE a.status = 'staging' AND a.created_at < ($1::timestamptz - interval '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_title_states s
            WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id)
          )
        ORDER BY a.created_at, a.id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
    ",
    r"
      DELETE FROM series_analysis_artifacts
      WHERE id IN (
        SELECT a.id FROM series_analysis_artifacts a
        WHERE a.status = 'published' AND a.published_at < ($1::timestamptz - interval '45 days')
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_title_states s
            WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id)
          )
        ORDER BY a.published_at, a.id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
    ",
];

/// Prunes expired terminal history and unreferenced artifacts as one bounded transaction.
/// Current/previous publications and unfinished jobs are retained regardless of age.
///
/// # Errors
/// Returns a database error after rollback if any cleanup statement fails.
pub(crate) async fn cleanup_history(
    client: &mut Client,
    now: SystemTime,
    limit_per_table: i64,
) -> Result<[u64; 5], ControlError> {
    let transaction = client.transaction().await?;
    transaction
        .batch_execute("SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '1s'")
        .await?;
    let mut deleted = [0; 5];
    for (count, statement) in deleted.iter_mut().zip(DELETE_HISTORY) {
        *count = transaction
            .execute(statement, &[&now, &limit_per_table])
            .await?;
    }
    transaction.commit().await?;
    Ok(deleted)
}

#[cfg(test)]
mod tests;
