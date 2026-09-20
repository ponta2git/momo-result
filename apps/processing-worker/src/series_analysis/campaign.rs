use tokio_postgres::{Error, Transaction};

/// Rebuilds the campaign and operation projections after changing their targets.
/// Callers keep target changes and this refresh in the same READ COMMITTED transaction.
pub(super) async fn refresh(
    transaction: &Transaction<'_>,
    campaign_ids: &[String],
) -> Result<(), Error> {
    if campaign_ids.is_empty() {
        return Ok(());
    }
    // A waiting aggregate UPDATE retains its old snapshot. Lock first, then count in a new
    // statement. Consistent order avoids cycles; NO KEY UPDATE permits concurrent FK inserts.
    transaction
        .query(
            "SELECT id FROM series_analysis_campaigns
             WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE",
            &[&campaign_ids],
        )
        .await?;
    transaction
        .execute(
            "WITH counts AS (
               SELECT campaign_id,
                 COUNT(*) FILTER (WHERE status <> 'pending')::int AS expanded_count,
                 COUNT(*) FILTER (
                   WHERE status IN ('succeeded','failed','skipped_title_deleted')
                 )::int AS terminal_count,
                 COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
                 COUNT(*) FILTER (WHERE status = 'skipped_title_deleted')::int AS skipped_count
               FROM series_analysis_campaign_targets
               WHERE campaign_id = ANY($1) GROUP BY campaign_id
             )
             UPDATE series_analysis_campaigns c SET
               expanded_count = counts.expanded_count, terminal_count = counts.terminal_count,
               failed_count = counts.failed_count, skipped_count = counts.skipped_count,
               status = CASE
                 WHEN counts.terminal_count = c.target_count THEN 'terminal'
                 WHEN counts.expanded_count = c.target_count THEN 'running'
                 ELSE 'expanding'
               END,
               finished_at = CASE
                 WHEN counts.terminal_count = c.target_count
                   THEN COALESCE(c.finished_at, clock_timestamp())
                 ELSE NULL
               END
             FROM counts WHERE c.id = counts.campaign_id",
            &[&campaign_ids],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_operation_requests o
             SET status = CASE WHEN c.status = 'terminal' THEN 'terminal' ELSE 'running' END,
                 finished_at = CASE
                   WHEN c.status = 'terminal'
                     THEN COALESCE(o.finished_at, c.finished_at, clock_timestamp())
                   ELSE NULL
                 END
             FROM series_analysis_campaigns c
             WHERE c.id = ANY($1) AND o.id = c.operation_request_id",
            &[&campaign_ids],
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
