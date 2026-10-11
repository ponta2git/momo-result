BEGIN;
UPDATE series_analysis_title_states
SET pending_work = true, updated_at = clock_timestamp()
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
INSERT INTO series_analysis_jobs (
  id, game_title_id, input_revision, algorithm_version,
  artifact_schema_version, validation_contract_id,
  status, trigger, requested_at, available_at
)
SELECT
  fixture.job_id,
  state.game_title_id,
  state.input_revision,
  state.algorithm_version,
  state.artifact_schema_version,
  state.validation_contract_id,
  'queued',
  'algorithm_update',
  clock_timestamp(),
  clock_timestamp()
FROM series_analysis_title_states state
JOIN (
  VALUES
    ('title-release-smoke-a', :'job_a'),
    ('title-release-smoke-b', :'job_b')
) AS fixture(game_title_id, job_id) USING (game_title_id);
COMMIT;
