DELETE FROM game_titles
WHERE game_titles.legacy_id = 'analysis-history-test-title';
WITH fixture_titles AS (
       INSERT INTO game_titles (id, legacy_id, name, layout_family)
       VALUES (pg_temp.fixture_uuid('game_titles', 'analysis-history-test-title'), 'analysis-history-test-title',
               'History retention', 'momotetsu_2')
       RETURNING id
     )
  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
  WHERE release.singleton_key = 'current'
  ON CONFLICT (game_title_id) DO NOTHING;
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, status, trigger, requested_at, available_at, finished_at)
SELECT pg_temp.fixture_uuid('series_analysis_jobs', 'analysis-history-test-' || name),
       'analysis-history-test-' || name, pg_temp.fixture_uuid('game_titles', 'analysis-history-test-title'), 0,
       'series-analysis-v5', 4, status, 'manual', CAST('2099-06-01' AS timestamptz), CAST('2099-06-01' AS timestamptz),
       CAST(finished_at AS timestamptz)
FROM ((VALUES ('old-a', 'failed', '2099-06-01'), ('old-b', 'failed', '2099-06-01'),
              ('fresh', 'failed', '2099-08-01'), ('active', 'queued', NULL))) AS fixtures (name, status, finished_at);
INSERT INTO series_analysis_job_attempts (id, legacy_id, job_id, attempt_no, owner, fencing_token, input_revision,
                                          algorithm_version, artifact_schema_version, validation_contract_id, status, outcome, effective_config_version,
                                          calculation_timeout_milliseconds, finished_at)
VALUES (pg_temp.fixture_uuid('series_analysis_job_attempts', 'analysis-history-test-attempt'),
        'analysis-history-test-attempt', pg_temp.fixture_uuid('series_analysis_jobs', 'analysis-history-test-old-a'), 1,
        'history-test', 1, 0, 'series-analysis-v5', 4, 'series-analysis-artifact-v4-full-validation-v1', 'terminal',
        'failed', 'history-test', 1000, '2099-06-01');
WITH fixture_insert AS (
       INSERT INTO series_analysis_artifacts (id, game_title_id, attempt_id, input_revision, algorithm_version,
                                              artifact_schema_version, source_input_checksum, root_checksum, status, aggregate_chunk_count, review_chunk_count,
                                              drilldown_chunk_count, match_context_chunk_count, encoded_bytes, decoded_bytes, created_at)
       SELECT 'analysis-history-test-' || name, 'analysis-history-test-title', CASE
                WHEN name = 'staging' THEN 'analysis-history-test-attempt'
              END, 0, 'series-analysis-v5', 4, 'sha256:' || repeat('0', 64), 'sha256:' || repeat('1', 64), 'staging', 1, 0, 0, 0,
              2, 2, '2099-06-01'
       FROM ((VALUES ('staging'), ('current'), ('previous'), ('baseline'), ('obsolete'))) AS fixtures (name)
       RETURNING id, game_title_id
     )
  INSERT INTO series_analysis_artifact_identities (id, legacy_id, game_title_id, legacy_game_title_id)
  SELECT pg_temp.fixture_uuid('series_analysis_artifacts', fixture_insert.id), fixture_insert.id, title.id,
         fixture_insert.game_title_id
  FROM fixture_insert INNER JOIN game_titles AS title ON title.legacy_id = fixture_insert.game_title_id;
INSERT INTO series_analysis_scope_aggregate_artifacts (artifact_id, scope_key, scope_kind, payload, encoded_bytes,
                                                       decoded_bytes, item_count, nesting_depth, checksum)
SELECT id, 'overall', 'overall', decode('7b7d', 'hex'), 2, 2, 0, 1,
       'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
FROM series_analysis_artifacts
WHERE game_title_id = 'analysis-history-test-title';
UPDATE series_analysis_artifacts
SET validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1'
WHERE game_title_id = 'analysis-history-test-title';
WITH fixture_insert AS (
       INSERT INTO series_radar_bases (id, game_title_id, checksum, payload, source_snapshot, source_checksum,
                                       source_input_revision, created_at)
       SELECT 'analysis-history-radar-' || name, 'analysis-history-test-title', 'sha256:' || repeat('a', 64), '{}',
              '{"matches":[]}', 'sha256:' || repeat('b', 64), 0, '2099-06-01'
       FROM ((VALUES ('current'), ('obsolete'))) AS fixtures (name)
       RETURNING id, game_title_id
     )
  INSERT INTO series_radar_basis_identities (id, legacy_id, game_title_id, legacy_game_title_id)
  SELECT pg_temp.fixture_uuid('series_radar_bases', fixture_insert.id), fixture_insert.id, title.id, fixture_insert.game_title_id
  FROM fixture_insert INNER JOIN game_titles AS title ON title.legacy_id = fixture_insert.game_title_id;
INSERT INTO series_radar_title_states (game_title_id, current_basis_id, desired_basis_id, current_applied_at)
VALUES (pg_temp.fixture_uuid('game_titles', 'analysis-history-test-title'),
        pg_temp.fixture_uuid('series_radar_bases', 'analysis-history-radar-current'),
        pg_temp.fixture_uuid('series_radar_bases', 'analysis-history-radar-current'), '2099-06-01');
INSERT INTO series_radar_candidates (id, legacy_id, game_title_id, legacy_game_title_id, basis_id, status)
VALUES (pg_temp.fixture_uuid('series_radar_candidates', 'analysis-history-radar-candidate'),
        'analysis-history-radar-candidate', pg_temp.fixture_uuid('game_titles', 'analysis-history-test-title'),
        'analysis-history-test-title', pg_temp.fixture_uuid('series_radar_bases', 'analysis-history-radar-current'),
        'ready');
INSERT INTO series_radar_previews (id, legacy_id, game_title_id, candidate_id, input_revision, status,
                                   evaluation_snapshot, scope_keys, created_at, updated_at)
SELECT pg_temp.fixture_uuid('series_radar_previews', 'analysis-history-radar-preview-' || name),
       'analysis-history-radar-preview-' || name, pg_temp.fixture_uuid('game_titles', 'analysis-history-test-title'),
       pg_temp.fixture_uuid('series_radar_candidates', 'analysis-history-radar-candidate'), 0, 'ready', '{"matches":[]}',
       ARRAY['overall'], CAST(created_at AS timestamptz), '2099-06-01'
FROM ((VALUES ('old', '2099-06-01'), ('latest', '2099-06-02'))) AS fixtures (name, created_at);
INSERT INTO series_radar_preview_scopes (preview_id, scope_key, payload)
SELECT pg_temp.fixture_uuid('series_radar_previews', series_radar_previews.legacy_id), 'overall', '{"before":null,"after":null}'
FROM series_radar_previews
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_radar_previews.game_title_id) = 'analysis-history-test-title';
UPDATE series_analysis_artifacts
SET status = 'published', published_at = '2099-06-01'
WHERE game_title_id = 'analysis-history-test-title' AND id <> 'analysis-history-test-staging';
UPDATE series_analysis_title_states
SET algorithm_version = 'series-analysis-v5', artifact_schema_version = 4,
    validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1',
    current_artifact_id = pg_temp.fixture_uuid('series_analysis_artifacts', 'analysis-history-test-current'),
    previous_artifact_id = pg_temp.fixture_uuid('series_analysis_artifacts', 'analysis-history-test-previous'),
    notification_baseline_state = 'artifact',
    notification_baseline_artifact_id = pg_temp.fixture_uuid('series_analysis_artifacts', 'analysis-history-test-baseline')
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'analysis-history-test-title';
