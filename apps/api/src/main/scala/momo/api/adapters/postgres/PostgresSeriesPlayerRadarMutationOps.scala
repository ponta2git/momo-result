package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{GameTitleId, MatchId}

/** Called after the ordinary mutation intent has acquired the affected title locks. */
private[postgres] object PostgresSeriesPlayerRadarMutationOps:
  /** Compares only radar inputs; incidents, play order, owners and names do not invalidate a basis. */
  def inputIdentity(matchId: MatchId): ConnectionIO[Option[String]] = sql"""
    SELECT jsonb_build_object(
      'gameTitleId', m.game_title_id, 'heldEventId', m.held_event_id,
      'playedAt', m.played_at, 'matchNoInEvent', m.match_no_in_event,
      'seasonMasterId', m.season_master_id, 'mapMasterId', m.map_master_id,
      'players', (SELECT jsonb_agg(jsonb_build_array(member_id, rank,
        total_assets_man_yen, revenue_man_yen) ORDER BY member_id)
        FROM match_players WHERE match_id = m.id))::text
    FROM matches m WHERE m.id = $matchId
  """.query[String].option

  def changed(titles: List[GameTitleId], matchId: MatchId, sourceMayHaveChanged: Boolean)
      : ConnectionIO[Unit] = titles.distinct.sortBy(_.value).traverse_ { title =>
    for
      _ <- sql"""
        SELECT game_title_id FROM series_radar_title_states
        WHERE game_title_id = $title FOR UPDATE
      """.query[GameTitleId].option
      _ <- sql"""
        UPDATE series_radar_previews SET status = 'stale', updated_at = now()
        WHERE game_title_id = $title AND status = 'ready'
      """.update.run
      invalidCandidates <- if sourceMayHaveChanged then sql"""
        UPDATE series_radar_candidates c
        SET status = 'invalid', safe_failure_code = 'source_changed', updated_at = now()
        FROM series_radar_bases b
        WHERE c.game_title_id = $title AND b.game_title_id = $title
          AND c.basis_id = b.id AND c.status IN ('pending', 'ready', 'unavailable', 'failed')
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.source_snapshot->'matches') m
            WHERE m->'order'->>'matchId' = ${matchId.value})
        RETURNING c.id
      """.query[String].to[List]
      else List.empty[String].pure[ConnectionIO]
      invalidIds = invalidCandidates.toArray
      stopped <- sql"""
        UPDATE series_radar_operations
        SET status = 'failed', safe_failure_code = 'source_changed',
            finished_at = now(), updated_at = now()
        WHERE game_title_id = $title AND candidate_id = ANY($invalidIds)
          AND status IN ('pending', 'running')
        RETURNING id
      """.query[String].to[List]
      stoppedIds = stopped.toArray
      reset <- sql"""
        UPDATE series_radar_title_states
        SET desired_basis_id = current_basis_id, generation = generation + 1,
            active_operation_id = NULL, updated_at = now()
        WHERE game_title_id = $title AND active_operation_id = ANY($stoppedIds)
      """.update.run
      _ <- if reset > 0 then
        // The schema's queued-job guard copies the newly fenced desired basis into queued work.
        sql"""
          UPDATE series_analysis_jobs SET updated_at = now()
          WHERE game_title_id = $title AND status = 'queued' AND work_kind = 'analysis'
        """.update.run.void
      else ().pure[ConnectionIO]
    yield ()
  }
