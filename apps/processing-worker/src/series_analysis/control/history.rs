use std::time::{Duration, SystemTime};

use tokio_postgres::Client;

use super::ControlError;

pub(crate) const HISTORY_CLEANUP_INTERVAL: Duration = Duration::from_hours(1);

// Materialize the locked victim set once. A rescanned locking subquery can select
// new victims after each deletion and silently exceed its LIMIT.
const DELETE_HISTORY: [&str; 5] = [
    r"
      WITH victims AS MATERIALIZED (
        SELECT id FROM series_analysis_operation_requests
        WHERE status = 'terminal' AND finished_at < ($1::timestamptz - interval '45 days')
        ORDER BY finished_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM series_analysis_operation_requests target
      USING victims
      WHERE target.id = victims.id
    ",
    r"
      WITH victims AS MATERIALIZED (
        SELECT id FROM series_analysis_job_requests
        WHERE status = 'fulfilled'
          AND fulfilled_at < ($1::timestamptz - interval '45 days')
          AND operation_request_id IS NULL
          AND campaign_id IS NULL
        ORDER BY fulfilled_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM series_analysis_job_requests target
      USING victims
      WHERE target.id = victims.id
    ",
    r"
      WITH victims AS MATERIALIZED (
        SELECT id FROM series_analysis_jobs
        WHERE status IN ('succeeded', 'failed', 'timed_out')
          AND finished_at < ($1::timestamptz - interval '45 days')
        ORDER BY finished_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM series_analysis_jobs target
      USING victims
      WHERE target.id = victims.id
    ",
    r"
      WITH victims AS MATERIALIZED (
        SELECT a.id FROM series_analysis_artifacts a
        WHERE a.status = 'staging' AND a.created_at < ($1::timestamptz - interval '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_title_states s
            WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id, s.notification_baseline_artifact_id)
          )
        ORDER BY a.created_at, a.id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM series_analysis_artifacts target
      USING victims
      WHERE target.id = victims.id
    ",
    r"
      WITH victims AS MATERIALIZED (
        SELECT a.id FROM series_analysis_artifacts a
        WHERE a.status = 'published' AND a.published_at < ($1::timestamptz - interval '45 days')
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_title_states s
            WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id, s.notification_baseline_artifact_id)
          )
        ORDER BY a.published_at, a.id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM series_analysis_artifacts target
      USING victims
      WHERE target.id = victims.id
    ",
];

/// Prunes expired terminal history and unreferenced artifacts as one bounded transaction.
/// Public results, the notification input baseline and unfinished jobs survive regardless of age.
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
    // Small basis/application history remains available. Only unreferenced large snapshots expire.
    cleanup_radar_payloads(&transaction, now, limit_per_table).await?;
    transaction.commit().await?;
    Ok(deleted)
}

async fn cleanup_radar_payloads(
    transaction: &tokio_postgres::Transaction<'_>,
    now: SystemTime,
    limit: i64,
) -> Result<(), ControlError> {
    transaction.execute(r"
      WITH victims AS MATERIALIZED (
        SELECT p.id FROM series_radar_previews p JOIN series_radar_candidates c ON c.id=p.candidate_id
        WHERE p.updated_at < ($1::timestamptz - interval '45 days') AND p.evaluation_snapshot IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM series_radar_operations o WHERE o.preview_id=p.id AND o.status IN ('pending','running'))
          AND (c.status IN ('withdrawn','invalid','applied') OR EXISTS (SELECT 1 FROM series_radar_previews newer WHERE newer.candidate_id=p.candidate_id AND (newer.created_at,newer.id)>(p.created_at,p.id)))
        ORDER BY p.updated_at,p.id LIMIT $2 FOR UPDATE OF p SKIP LOCKED
      ), removed_scopes AS (
        DELETE FROM series_radar_preview_scopes s USING victims WHERE s.preview_id=victims.id RETURNING s.preview_id
      )
      UPDATE series_radar_previews p SET evaluation_snapshot=NULL,scope_keys='{}',status='stale'
      FROM victims WHERE p.id=victims.id
    ", &[&now,&limit]).await?;
    transaction.execute(r"
      WITH victims AS MATERIALIZED (
        SELECT b.id FROM series_radar_bases b
        WHERE b.created_at < ($1::timestamptz - interval '45 days') AND b.source_snapshot IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM series_radar_title_states s WHERE b.id IN (s.current_basis_id,s.previous_basis_id,s.desired_basis_id))
          AND NOT EXISTS (SELECT 1 FROM series_analysis_artifacts a WHERE a.radar_basis_id=b.id)
          AND NOT EXISTS (SELECT 1 FROM series_analysis_jobs j WHERE j.radar_basis_id=b.id AND j.status IN ('queued','running','publishing'))
          AND NOT EXISTS (SELECT 1 FROM series_radar_candidates c WHERE c.basis_id=b.id AND c.status IN ('pending','ready','unavailable','failed'))
          AND NOT EXISTS (SELECT 1 FROM series_radar_operations o WHERE o.basis_id=b.id AND o.status IN ('pending','running'))
        ORDER BY b.created_at,b.id LIMIT $2 FOR UPDATE OF b SKIP LOCKED
      )
      UPDATE series_radar_bases b SET source_snapshot=NULL FROM victims WHERE b.id=victims.id
    ", &[&now,&limit]).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
