INSERT INTO series_analysis_jobs (
  id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
  status, trigger, requested_at, available_at, finished_at
)
SELECT 'ci-analysis-expired-history', game_title_id, input_revision, algorithm_version,
       artifact_schema_version, 'succeeded', 'manual',
       clock_timestamp() - interval '46 days', clock_timestamp() - interval '46 days',
       clock_timestamp() - interval '46 days'
FROM series_analysis_title_states WHERE game_title_id = 'title-release-smoke-a';
