DELETE FROM game_titles WHERE id = 'analysis-history-test-title';
INSERT INTO game_titles (id, name, layout_family)
VALUES ('analysis-history-test-title', 'History retention', 'momotetsu2');
INSERT INTO series_analysis_jobs (
  id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
  status, trigger, requested_at, available_at, finished_at
)
SELECT 'analysis-history-test-' || name, 'analysis-history-test-title', 0,
       'series-analysis-v5', 4, status, 'manual',
       '2099-06-01'::timestamptz, '2099-06-01'::timestamptz, finished_at::timestamptz
FROM (VALUES
  ('old-a', 'failed', '2099-06-01'),
  ('old-b', 'failed', '2099-06-01'),
  ('fresh', 'failed', '2099-08-01'),
  ('active', 'queued', NULL)
) fixtures(name, status, finished_at);
INSERT INTO series_analysis_job_attempts (
  id, job_id, attempt_no, owner, fencing_token, input_revision, algorithm_version,
  artifact_schema_version, validation_contract_id, status, outcome,
  effective_config_version, calculation_timeout_milliseconds, finished_at
) VALUES (
  'analysis-history-test-attempt', 'analysis-history-test-old-a', 1,
  'history-test', 1, 0, 'series-analysis-v5', 4,
  'series-analysis-artifact-v4-full-validation-v1', 'terminal', 'failed',
  'history-test', 1000, '2099-06-01'
);
INSERT INTO series_analysis_artifacts (
  id, game_title_id, attempt_id, input_revision, algorithm_version,
  artifact_schema_version, source_input_checksum, root_checksum,
  status, aggregate_chunk_count, review_chunk_count, drilldown_chunk_count,
  match_context_chunk_count, encoded_bytes, decoded_bytes, created_at
)
SELECT 'analysis-history-test-' || name, 'analysis-history-test-title',
       CASE WHEN name = 'staging' THEN 'analysis-history-test-attempt' END,
       0, 'series-analysis-v5', 4, 'sha256:' || repeat('0', 64),
       'sha256:' || repeat('1', 64), 'staging', 1, 0, 0, 0, 2, 2, '2099-06-01'
FROM (VALUES ('staging'), ('current'), ('previous'), ('baseline'), ('obsolete')) fixtures(name);
INSERT INTO series_analysis_scope_aggregate_artifacts (
  artifact_id, scope_key, scope_kind, payload, encoded_bytes,
  decoded_bytes, item_count, nesting_depth, checksum
)
SELECT id, 'overall', 'overall', decode('7b7d', 'hex'), 2, 2, 0, 1,
       'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
FROM series_analysis_artifacts WHERE game_title_id = 'analysis-history-test-title';
UPDATE series_analysis_artifacts
SET validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1'
WHERE game_title_id = 'analysis-history-test-title';
UPDATE series_analysis_artifacts SET status = 'published', published_at = '2099-06-01'
WHERE game_title_id = 'analysis-history-test-title' AND id <> 'analysis-history-test-staging';
UPDATE series_analysis_title_states
SET algorithm_version = 'series-analysis-v5', artifact_schema_version = 4,
    validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1',
    current_artifact_id = 'analysis-history-test-current',
    previous_artifact_id = 'analysis-history-test-previous',
    notification_baseline_state = 'artifact',
    notification_baseline_artifact_id = 'analysis-history-test-baseline'
WHERE game_title_id = 'analysis-history-test-title';
