package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{GameTitleId, MatchId}

/** Called after the ordinary mutation intent has acquired the affected title locks. */
private[postgres] object PostgresSeriesPlayerRadarMutationOps:
  final case class MatchInputIdentity(statistics: String, achievementIncidents: String)
      derives CanEqual

  /** Keeps six-axis source changes separate from facts that can change achievement points. */
  def inputIdentity(matchId: MatchId)(using
      identities: PostgresIdentities): ConnectionIO[Option[MatchInputIdentity]] = sql"""
    SELECT jsonb_build_object(
      'gameTitleId', ${identities.wireReference(
      Entity.GameTitles,
      fr"m.game_title_id"
    )}, 'heldEventId', ${identities.wireReference(Entity.HeldEvents, fr"m.held_event_id")},
      'playedAt', m.played_at, 'matchNoInEvent', m.match_no_in_event,
      'seasonMasterId', ${identities.wireReference(
      Entity.SeasonMasters,
      fr"m.season_master_id"
    )}, 'mapMasterId', ${identities.wireReference(Entity.MapMasters, fr"m.map_master_id")},
      'players', (SELECT jsonb_agg(jsonb_build_array(${identities.wireReference(
      Entity.Members,
      fr"mp.member_id"
    )}, rank,
        total_assets_man_yen, revenue_man_yen) ORDER BY ${identities.wireReference(
      Entity.Members,
      fr"mp.member_id"
    )})
        FROM match_players mp WHERE match_id = m.id))::text,
      COALESCE((SELECT jsonb_agg(jsonb_build_array(i.member_id::text, k.key, i.count)
        ORDER BY i.member_id, k.key)
        FROM match_incidents i JOIN incident_masters k ON k.id = i.incident_master_id
        WHERE i.match_id = m.id AND k.key IN ('destination', 'suri_no_ginji') AND i.count <> 0),
        '[]'::jsonb)::text
    FROM matches m WHERE m.id = ${identities.lookup(Entity.Matches, matchId.value)}
  """.query[MatchInputIdentity].option

  /** Rust compares generated point sources; mutations only invalidate the reviewed evaluation. */
  def achievementsChanged(titles: List[GameTitleId])(using
      identities: PostgresIdentities): ConnectionIO[Unit] = titles.traverse(title =>
    identities.normalize(Entity.GameTitles, title.value).map(GameTitleId.unsafeFromString)
  ).flatMap(_.distinct.sortBy(_.value).traverse_(title =>
    for
      _ <- sql"""
        SELECT ${identities.wireReference(Entity.GameTitles, fr"r.game_title_id")}
        FROM series_radar_title_states r
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, title.value)} FOR UPDATE
      """.query[GameTitleId].option
      _ <- sql"""
        UPDATE series_radar_previews SET status = 'stale', updated_at = now()
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, title.value)}
          AND status = 'ready'
      """.update.run
      stopped <- sql"""
        UPDATE series_radar_operations o
        SET status = 'failed', safe_failure_code = 'evaluation_changed',
            finished_at = now(), updated_at = now()
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, title.value)}
          AND kind = 'apply' AND status IN ('pending', 'running')
        RETURNING ${identities.wireId("o")}
      """.query[String].to[List]
      _ <- resetApplications(title, stopped)
    yield ()
  ))

  def changed(titles: List[GameTitleId], matchId: MatchId, sourceMayHaveChanged: Boolean)(using
      identities: PostgresIdentities)
      : ConnectionIO[Unit] = titles.traverse(title =>
    identities.normalize(Entity.GameTitles, title.value).map(GameTitleId.unsafeFromString)
  )
    .flatMap(_.distinct.sortBy(_.value).traverse_(title =>
      changedTitle(title, matchId, sourceMayHaveChanged)
    ))

  private def changedTitle(
      title: GameTitleId,
      matchId: MatchId,
      sourceMayHaveChanged: Boolean
  )(using identities: PostgresIdentities): ConnectionIO[Unit] =
    for
      _ <- sql"""
        SELECT ${identities.wireReference(
          Entity.GameTitles,
          fr"r.game_title_id"
        )} FROM series_radar_title_states r
        WHERE game_title_id = ${identities.lookup(Entity.GameTitles, title.value)} FOR UPDATE
      """.query[GameTitleId].option
      _ <- sql"""
        UPDATE series_radar_previews SET status = 'stale', updated_at = now()
        WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          title.value
        )} AND status = 'ready'
      """.update.run
      invalidCandidates <- if sourceMayHaveChanged then
        sql"""
        UPDATE series_radar_candidates c
        SET status = 'invalid', safe_failure_code = 'source_changed', updated_at = now()
        FROM series_radar_bases b
        WHERE c.game_title_id = ${identities.lookup(
            Entity.GameTitles,
            title.value
          )} AND b.game_title_id = ${title.value}
          AND ${identities.wireReference(
            Entity.RadarBases,
            fr"c.basis_id"
          )} = b.id AND c.status IN ('pending', 'ready', 'unavailable', 'failed')
          AND b.payload->'manual' IS NULL
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.source_snapshot->'matches') m
            WHERE m->'order'->>'matchId' = ${matchId.value})
        RETURNING ${identities.wireId("c")}
      """.query[String].to[List]
      else List.empty[String].pure[ConnectionIO]
      invalidIds = identities.lookupArray(Entity.RadarCandidates, invalidCandidates)
      stopped <- sql"""
        UPDATE series_radar_operations o
        SET status = 'failed', safe_failure_code = 'source_changed',
            finished_at = now(), updated_at = now()
        WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          title.value
        )} AND candidate_id = ANY($invalidIds)
          AND status IN ('pending', 'running')
        RETURNING ${identities.wireId("o")}
      """.query[String].to[List]
      stoppedManual <- if sourceMayHaveChanged then
        sql"""
        UPDATE series_radar_operations o
        SET status = 'failed', safe_failure_code = 'evaluation_changed', finished_at = now(), updated_at = now()
        FROM series_radar_candidates c, series_radar_previews p, series_radar_bases b
        WHERE o.game_title_id = ${identities.lookup(
            Entity.GameTitles,
            title.value
          )} AND o.kind = 'apply' AND o.status IN ('pending', 'running')
          AND c.id = o.candidate_id AND c.game_title_id = ${identities.lookup(
            Entity.GameTitles,
            title.value
          )}
          AND b.id = ${identities.wireReference(
            Entity.RadarBases,
            fr"c.basis_id"
          )} AND b.game_title_id = ${title.value} AND b.payload->'manual' IS NOT NULL
          AND p.id = o.preview_id AND p.game_title_id = ${identities.lookup(
            Entity.GameTitles,
            title.value
          )}
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.evaluation_snapshot->'matches') m
            WHERE m->'order'->>'matchId' = ${matchId.value})
        RETURNING ${identities.wireId("o")}
      """.query[String].to[List]
      else List.empty[String].pure[ConnectionIO]
      _ <- resetApplications(title, stopped ++ stoppedManual)
    yield ()

  private def resetApplications(title: GameTitleId, stopped: List[String])(using
      identities: PostgresIdentities): ConnectionIO[Unit] =
    val stoppedIds = identities.lookupArray(Entity.RadarOperations, stopped)
    for
      reset <- sql"""
        UPDATE series_radar_title_states
        SET desired_basis_id = current_basis_id, generation = generation + 1,
            active_operation_id = NULL, updated_at = now()
        WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          title.value
        )} AND active_operation_id = ANY($stoppedIds)
      """.update.run
      _ <- if reset > 0 then
        PostgresSeriesAnalysisJobTransitions.bindQueuedRadar(title)
      else ().pure[ConnectionIO]
    yield ()
