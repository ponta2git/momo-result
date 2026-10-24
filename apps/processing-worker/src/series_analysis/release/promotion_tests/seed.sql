WITH fixture_titles AS (
       INSERT INTO game_titles (id, legacy_id, name, layout_family)
       VALUES (pg_temp.fixture_uuid('game_titles', 'obsolete-title'), 'obsolete-title', 'Obsolete snapshot', 'momotetsu_2'),
              (pg_temp.fixture_uuid('game_titles', 'current-title'), 'current-title', 'Current snapshot', 'momotetsu_2'),
              (pg_temp.fixture_uuid('game_titles', 'stale-title'), 'stale-title', 'Current-format stale snapshot', 'momotetsu_2')
       RETURNING id
     )
  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
  WHERE release.singleton_key = 'current'
  ON CONFLICT (game_title_id) DO NOTHING;
INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
SELECT pg_temp.fixture_uuid('game_titles', t.legacy_id), r.algorithm_version, r.artifact_schema_version, r.validation_contract_id
FROM game_titles AS t CROSS JOIN series_analysis_release_state AS r
WHERE t.legacy_id IN ('obsolete-title', 'current-title', 'stale-title') AND r.singleton_key = 'current'
ON CONFLICT DO NOTHING;
UPDATE series_analysis_title_states
SET algorithm_version = CASE (SELECT legacy_id FROM game_titles WHERE id=series_analysis_title_states.game_title_id)
                          WHEN 'obsolete-title' THEN 'series-analysis-v7' ELSE 'series-analysis-v9' END,
    artifact_schema_version = CASE(SELECT fixture_parent.legacy_id
                                   FROM game_titles AS fixture_parent
                                   WHERE fixture_parent.id = series_analysis_title_states.game_title_id)
                                WHEN 'obsolete-title' THEN 3
                                ELSE 8
                              END, validation_contract_id = CASE(SELECT fixture_parent.legacy_id
                                  FROM game_titles AS fixture_parent
                                  WHERE fixture_parent.id = series_analysis_title_states.game_title_id)
                               WHEN 'obsolete-title' THEN 'series-analysis-artifact-v3-full-validation-v1'
                               ELSE 'series-analysis-artifact-v8-full-validation-v1'
                             END;
WITH fixture_insert AS (
       INSERT INTO series_analysis_artifacts (id, game_title_id, input_revision, algorithm_version,
                                              artifact_schema_version, source_input_checksum, root_checksum, aggregate_chunk_count, review_chunk_count,
                                              drilldown_chunk_count, match_context_chunk_count, encoded_bytes, decoded_bytes)
       SELECT kind || '-' || position, kind || '-title', 0, CASE kind WHEN 'obsolete' THEN 'series-analysis-v7' ELSE 'series-analysis-v9' END, CASE kind
                WHEN 'obsolete' THEN 3
                ELSE 8
              END, 'sha256:' || repeat('a', 64), 'sha256:' || repeat('a', 64), 1, 0, 0, 0, 2, 2
       FROM unnest(ARRAY['obsolete', 'current', 'stale']) AS kind, unnest(ARRAY['current', 'previous']) AS position
       RETURNING id, game_title_id
     )
  INSERT INTO series_analysis_artifact_identities (id, legacy_id, game_title_id, legacy_game_title_id)
  SELECT pg_temp.fixture_uuid('series_analysis_artifacts', fixture_insert.id), fixture_insert.id, title.id,
         fixture_insert.game_title_id
  FROM fixture_insert INNER JOIN game_titles AS title ON title.legacy_id = fixture_insert.game_title_id;
INSERT INTO series_analysis_scope_aggregate_artifacts (artifact_id, scope_key, scope_kind, payload, encoded_bytes,
                                                       decoded_bytes, item_count, nesting_depth, checksum)
SELECT id, 'overall', 'overall', convert_to('{}', 'UTF8'), 2, 2, 0, 1, 'sha256:' || repeat('a', 64)
FROM series_analysis_artifacts;
UPDATE series_analysis_artifacts
SET outlook_summary_chunk_count = 1
WHERE artifact_schema_version = 8;
INSERT INTO series_analysis_outlook_summary_artifacts (artifact_id, scope_key, scope_kind, payload, encoded_bytes,
                                                       decoded_bytes, item_count, nesting_depth, checksum)
SELECT id, 'overall', 'overall', convert_to('{}', 'UTF8'), 2, 2, 0, 1, 'sha256:' || repeat('a', 64)
FROM series_analysis_artifacts
WHERE artifact_schema_version = 8;
UPDATE series_analysis_artifacts SET achievement_chunk_count=1, encoded_bytes=6, decoded_bytes=6 WHERE artifact_schema_version=8;
INSERT INTO series_analysis_achievement_artifacts (artifact_id,scope_key,scope_kind,payload,encoded_bytes,decoded_bytes,item_count,nesting_depth,checksum)
SELECT id,'overall','overall',convert_to('{}','UTF8'),2,2,0,1,'sha256:' || repeat('a',64) FROM series_analysis_artifacts WHERE artifact_schema_version=8;
UPDATE series_analysis_artifacts
SET validation_contract_id = CASE artifact_schema_version
                               WHEN 8 THEN 'series-analysis-artifact-v8-full-validation-v1'
                               ELSE 'series-analysis-artifact-v3-full-validation-v1'
                             END;
UPDATE series_analysis_artifacts
SET status = 'published', published_at = clock_timestamp();
UPDATE series_analysis_title_states
SET current_artifact_id = pg_temp.fixture_uuid('series_analysis_artifacts',
                                               split_part((SELECT fixture_parent.legacy_id
                                                           FROM game_titles AS fixture_parent
                                                           WHERE fixture_parent.id = series_analysis_title_states.game_title_id), '-', 1) || '-current'),
    previous_artifact_id = pg_temp.fixture_uuid('series_analysis_artifacts',
                                                split_part((SELECT fixture_parent.legacy_id
                                                            FROM game_titles AS fixture_parent
                                                            WHERE fixture_parent.id = series_analysis_title_states.game_title_id), '-', 1) || '-previous');
UPDATE series_analysis_title_states
SET input_revision = 1
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'stale-title';
INSERT INTO series_radar_title_states (game_title_id, generation)
VALUES (pg_temp.fixture_uuid('game_titles', 'obsolete-title'), 3);
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, validation_contract_id, status, trigger)
SELECT pg_temp.fixture_uuid('series_analysis_jobs', 'promotion-queued-job'), 'promotion-queued-job',
       series_analysis_title_states.game_title_id, input_revision, algorithm_version, artifact_schema_version,
       validation_contract_id, 'queued', 'manual'
FROM series_analysis_title_states
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'obsolete-title';
UPDATE series_radar_title_states
SET generation = 4
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_radar_title_states.game_title_id) = 'obsolete-title';
