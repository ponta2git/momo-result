DELETE FROM series_analysis_operation_requests WHERE id = 'analysis-campaign-concurrency';
INSERT INTO series_analysis_operation_requests
(id, scope, idempotency_key_hash, endpoint, status, target_count)
VALUES ('analysis-campaign-concurrency', 'all_titles', 'concurrency', 'test', 'running', 2);
INSERT INTO series_analysis_campaigns
(id, operation_request_id, trigger, algorithm_version, artifact_schema_version,
status, target_count)
VALUES ('analysis-campaign-concurrency', 'analysis-campaign-concurrency', 'manual',
'series-analysis-v1', 1, 'expanding', 2);
INSERT INTO series_analysis_campaign_targets (campaign_id, game_title_id, input_revision)
VALUES ('analysis-campaign-concurrency', 'concurrent-title-a', 0),
('analysis-campaign-concurrency', 'concurrent-title-b', 0);
