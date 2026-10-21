INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, status, trigger, requested_at, available_at, finished_at)
SELECT pg_temp.fixture_uuid('series_analysis_jobs', 'ci-analysis-expired-history'), 'ci-analysis-expired-history',
       series_analysis_title_states.game_title_id, input_revision, algorithm_version, artifact_schema_version, 'succeeded',
       'manual', clock_timestamp() - CAST('46 days' AS interval), clock_timestamp() - CAST('46 days' AS interval),
       clock_timestamp() - CAST('46 days' AS interval)
FROM series_analysis_title_states
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'title-release-smoke-a';
