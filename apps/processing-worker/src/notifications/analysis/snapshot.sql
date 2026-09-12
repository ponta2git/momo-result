SELECT setting.enabled, setting.generation::text AS generation,
  to_char(job.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
  CASE WHEN octet_length(frozen.body::text) <= $7 THEN frozen.body END AS body
FROM discord_notification_settings setting
LEFT JOIN series_analysis_jobs job ON job.id = $3 AND job.status = 'succeeded'
LEFT JOIN series_analysis_title_states state ON state.game_title_id = $1
LEFT JOIN game_titles title ON title.id = $1
LEFT JOIN LATERAL (
  WITH member_names AS (
    SELECT left(id, 201) AS id, display_name FROM members ORDER BY id LIMIT 5
  ), selected_matches AS (
    SELECT m.id, m.analysis_revision, m.held_event_id, m.match_no_in_event, m.played_at,
      m.season_master_id, m.map_master_id, he.held_date_iso,
      CASE WHEN octet_length(m.note_body) <= 16384 THEN m.note_body END AS note,
      (m.note_body IS NULL OR octet_length(m.note_body) <= 16384) AS note_valid,
      CASE WHEN octet_length(map.name) <= 1024 THEN map.name END AS map_name,
      CASE WHEN octet_length(season.name) <= 1024 THEN season.name END AS season_name,
      owner.display_name AS owner_name
    FROM matches m
    JOIN held_events he ON he.id = m.held_event_id
    JOIN map_masters map ON map.id = m.map_master_id
    JOIN season_masters season ON season.id = m.season_master_id
    JOIN members owner ON owner.id = m.owner_member_id
    WHERE m.id = ANY($2::text[]) AND m.game_title_id = $1
      AND octet_length(m.held_event_id) <= 200
  ), match_data AS (
    SELECT m.*, players.items, players.ginji_total
    FROM selected_matches m
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'memberId', left(mp.member_id, 201), 'displayName', member.display_name,
        'rank', mp.rank, 'ginjiCount', COALESCE(mi.count, 0)
      ) ORDER BY mp.rank) AS items,
      sum(COALESCE(mi.count, 0)) AS ginji_total
      FROM match_players mp
      JOIN members member ON member.id = mp.member_id
      LEFT JOIN match_incidents mi ON mi.match_id = mp.match_id AND mi.member_id = mp.member_id
        AND mi.incident_master_id = 'incident_suri_no_ginji'
      WHERE mp.match_id = m.id
    ) players
  )
  SELECT jsonb_build_object(
    'gameTitleName', CASE WHEN octet_length(title.name) <= 1024 THEN title.name END,
    'members', (SELECT jsonb_object_agg(id, display_name) FROM member_names),
    'seasons', COALESCE((SELECT jsonb_object_agg(requested.id,
        CASE WHEN season.id IS NULL THEN '削除済みシーズン'
          WHEN octet_length(season.name) <= 1024 THEN season.name END)
      FROM unnest($6::text[]) requested(id)
      LEFT JOIN season_masters season ON season.id = requested.id AND season.game_title_id = $1), '{}'::jsonb),
    'matches', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'matchId', id, 'sourceRevision', analysis_revision::text,
      'heldEventId', held_event_id, 'heldDateIso', to_char(held_date_iso, 'YYYY-MM-DD'),
      'matchNoInEvent', match_no_in_event,
      'playedAt', to_char(played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'mapId', map_master_id, 'mapName', map_name,
      'seasonId', season_master_id, 'seasonName', season_name, 'ownerName', owner_name,
      'players', items, 'ginjiTotal', ginji_total, 'note', note
    ) ORDER BY played_at, held_event_id, match_no_in_event, id) FROM match_data WHERE note_valid), '[]'::jsonb)
  ) AS body
  WHERE setting.enabled AND job.finished_at IS NOT NULL
    AND state.current_artifact_id = $4 AND state.input_revision = $5
) frozen ON true
WHERE setting.kind = 'analysis_completed'
