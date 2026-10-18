package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.ConnectionIO
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.GameTitleId

private[postgres] object PostgresSeriesAnalysisJobTransitions:
  /**
   * The caller holds the analysis title lock through commit. A queued ordinary job follows that
   * title's desired radar generation; a running attempt or radar preparation keeps its snapshot.
   * The distinct predicate makes this compatible with the old assignment trigger without a
   * second row update, and makes repeated calls harmless after that trigger is removed.
   */
  def bindQueuedRadar(gameTitleId: GameTitleId): ConnectionIO[Unit] = sql"""
    UPDATE series_analysis_jobs j
    SET radar_basis_id = desired.desired_basis_id, radar_generation = desired.generation,
        updated_at = now()
    FROM (
      SELECT s.game_title_id, r.desired_basis_id, COALESCE(r.generation, 0) AS generation
      FROM series_analysis_title_states s
      LEFT JOIN series_radar_title_states r ON r.game_title_id = s.game_title_id
      WHERE s.game_title_id = $gameTitleId
    ) desired
    WHERE j.game_title_id = desired.game_title_id
      AND j.status = 'queued' AND j.work_kind = 'analysis'
      AND (j.radar_basis_id IS DISTINCT FROM desired.desired_basis_id
        OR j.radar_generation <> desired.generation)
  """.update.run.void
