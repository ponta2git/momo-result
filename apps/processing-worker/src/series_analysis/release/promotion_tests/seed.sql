INSERT INTO game_titles(id, name, layout_family)
VALUES ('obsolete-title', 'Obsolete snapshot', 'momotetsu2'),
       ('current-title', 'Current snapshot', 'momotetsu2'),
       ('stale-title', 'Current-format stale snapshot', 'momotetsu2');
UPDATE series_analysis_title_states
SET algorithm_version = 'series-analysis-v5',
    artifact_schema_version = CASE game_title_id WHEN 'obsolete-title' THEN 3 ELSE 4 END,
    validation_contract_id = CASE game_title_id
      WHEN 'obsolete-title' THEN 'series-analysis-artifact-v3-full-validation-v1'
      ELSE 'series-analysis-artifact-v4-full-validation-v1' END;
INSERT INTO series_analysis_artifacts(id, game_title_id, input_revision,
  algorithm_version, artifact_schema_version, source_input_checksum, root_checksum,
  aggregate_chunk_count, review_chunk_count, drilldown_chunk_count, match_context_chunk_count,
  encoded_bytes, decoded_bytes)
SELECT kind || '-' || position, kind || '-title', 0, 'series-analysis-v5',
  CASE kind WHEN 'obsolete' THEN 3 ELSE 4 END,
  'sha256:' || repeat('a', 64), 'sha256:' || repeat('a', 64), 1, 0, 0, 0, 2, 2
FROM unnest(ARRAY['obsolete', 'current', 'stale']) AS kind,
     unnest(ARRAY['current', 'previous']) AS position;
INSERT INTO series_analysis_scope_aggregate_artifacts(artifact_id, scope_key, scope_kind,
  payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum)
SELECT id, 'overall', 'overall', convert_to('{}', 'UTF8'), 2, 2, 0, 1, 'sha256:' || repeat('a', 64)
FROM series_analysis_artifacts;
UPDATE series_analysis_artifacts SET validation_contract_id = CASE artifact_schema_version
  WHEN 4 THEN 'series-analysis-artifact-v4-full-validation-v1'
  ELSE 'series-analysis-artifact-v3-full-validation-v1' END;
UPDATE series_analysis_artifacts SET status = 'published', published_at = clock_timestamp();
UPDATE series_analysis_title_states
SET current_artifact_id = split_part(game_title_id, '-', 1) || '-current',
    previous_artifact_id = split_part(game_title_id, '-', 1) || '-previous';

-- A new input revision legitimately keeps the previous current snapshot readable.
UPDATE series_analysis_title_states SET input_revision = 1 WHERE game_title_id = 'stale-title';
