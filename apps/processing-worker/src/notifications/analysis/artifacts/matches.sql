-- Bound the complete identity history separately for each artifact in the batch.
SELECT requested.artifact_id, matches.match_id, matches.source_revision,
  matches.season_id, matches.map_id
FROM unnest($1::text[]) AS requested(artifact_id)
CROSS JOIN LATERAL (
  SELECT left(match_id, 201) AS match_id, source_match_revision::text AS source_revision,
    left(season_master_id, 201) AS season_id, left(map_master_id, 201) AS map_id
  FROM series_analysis_match_context_artifacts context
  WHERE artifact_id = requested.artifact_id AND scope_kind = 'season_map'
  ORDER BY context.match_id LIMIT $2
) matches
