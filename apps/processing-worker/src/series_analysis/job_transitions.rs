//! Explicit queued-job assignments shared by every analysis producer and requeue path.

use tokio_postgres::Transaction;

/// Call while holding each analysis title lock until commit. Running attempts and radar
/// preparations retain their own snapshots. With the old assignment trigger installed the
/// distinct predicate performs no second row update; without it this is the only assignment.
pub(super) async fn bind_queued_radar(
    transaction: &Transaction<'_>,
    game_title_ids: &[&str],
) -> Result<(), tokio_postgres::Error> {
    transaction
        .execute(
            "UPDATE series_analysis_jobs j \
             SET radar_basis_id = desired.desired_basis_id, radar_generation = desired.generation, \
                 updated_at = clock_timestamp() \
             FROM (\
               SELECT s.game_title_id, r.desired_basis_id, COALESCE(r.generation, 0) AS generation \
               FROM series_analysis_title_states s \
               LEFT JOIN series_radar_title_states r ON r.game_title_id = s.game_title_id \
               WHERE s.game_title_id = ANY($1)\
             ) desired \
             WHERE j.game_title_id = desired.game_title_id \
               AND j.status = 'queued' AND j.work_kind = 'analysis' \
               AND (j.radar_basis_id IS DISTINCT FROM desired.desired_basis_id \
                 OR j.radar_generation <> desired.generation)",
            &[&game_title_ids],
        )
        .await?;
    Ok(())
}
