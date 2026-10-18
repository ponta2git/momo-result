BEGIN;
UPDATE series_analysis_title_states
SET pending_work = TRUE, updated_at = clock_timestamp()
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) IN ('title-release-smoke-a', 'title-release-smoke-b');
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at)
SELECT pg_temp.fixture_uuid('series_analysis_jobs', fixture.job_id), fixture.job_id, state.game_title_id,
       state.input_revision, state.algorithm_version, state.artifact_schema_version, state.validation_contract_id,
       'queued', 'algorithm_update', clock_timestamp(), clock_timestamp() + CAST('1 hour' AS interval)
FROM series_analysis_title_states AS state
     INNER JOIN ((VALUES ('title-release-smoke-a', :'job_a'),
                         ('title-release-smoke-b', :'job_b'))) AS fixture (game_title_id, job_id) ON state.game_title_id=pg_temp.fixture_uuid('game_titles', fixture.game_title_id);
COMMIT;
