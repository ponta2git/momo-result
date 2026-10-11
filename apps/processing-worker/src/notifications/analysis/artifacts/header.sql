SELECT left(artifact.id, 201), artifact.input_revision::text,
  left(artifact.algorithm_version, 201), artifact.artifact_schema_version,
  left(artifact.validation_contract_id, 201), artifact.status,
  artifact.match_context_chunk_count, size.scope_count, size.payload_bytes,
  (SELECT count(*) FROM series_analysis_match_context_artifacts
   WHERE artifact_id = artifact.id) AS actual_match_context_count,
  (SELECT COALESCE(json_agg(json_build_array(left(season_master_id, 201), item_count)
    ORDER BY scope_key), '[]'::json)
   FROM (
     SELECT season_master_id, item_count, scope_key
     FROM series_analysis_scope_aggregate_artifacts
     WHERE artifact_id = artifact.id AND scope_kind IN ('overall', 'season')
     ORDER BY scope_key LIMIT $3
   ) bounded) AS scope_metadata
FROM series_analysis_artifacts artifact
CROSS JOIN LATERAL (
  SELECT count(*)::bigint AS scope_count,
    COALESCE(sum(octet_length(payload)), 0)::bigint AS payload_bytes
  FROM series_analysis_scope_aggregate_artifacts
  WHERE artifact_id = artifact.id AND scope_kind IN ('overall', 'season')
) size
WHERE artifact.id = ANY($1::text[]) AND artifact.game_title_id = $2
