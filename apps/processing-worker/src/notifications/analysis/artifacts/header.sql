SELECT left(artifact.id, 201), artifact.input_revision::text,
  left(artifact.algorithm_version, 201), artifact.artifact_schema_version,
  left(artifact.validation_contract_id, 201), artifact.status,
  artifact.match_context_chunk_count, size.scope_count, size.payload_bytes,
  (SELECT count(*) FROM series_analysis_match_context_artifacts
   WHERE artifact_id = artifact.id) AS actual_match_context_count
FROM series_analysis_artifacts artifact
CROSS JOIN LATERAL (
  SELECT count(*)::bigint AS scope_count,
    COALESCE(sum(octet_length(payload)), 0)::bigint AS payload_bytes
  FROM series_analysis_scope_aggregate_artifacts
  WHERE artifact_id = artifact.id AND scope_kind IN ('overall', 'season')
) size
WHERE artifact.id = $1 AND artifact.game_title_id = $2
