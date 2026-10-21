DELETE FROM series_analysis_operation_requests
WHERE series_analysis_operation_requests.legacy_id = 'analysis-campaign-concurrency';
INSERT INTO series_analysis_operation_requests (id, legacy_id, scope, idempotency_key_hash, endpoint, status,
                                                target_count)
VALUES (pg_temp.fixture_uuid('series_analysis_operation_requests', 'analysis-campaign-concurrency'),
        'analysis-campaign-concurrency', 'all_titles', 'concurrency', 'test', 'running', 2);
INSERT INTO series_analysis_campaigns (id, legacy_id, operation_request_id, trigger, algorithm_version,
                                       artifact_schema_version, status, target_count)
VALUES (pg_temp.fixture_uuid('series_analysis_campaigns', 'analysis-campaign-concurrency'),
        'analysis-campaign-concurrency',
        pg_temp.fixture_uuid('series_analysis_operation_requests', 'analysis-campaign-concurrency'), 'manual',
        'series-analysis-v1', 1, 'expanding', 2);
INSERT INTO series_analysis_campaign_targets (campaign_id, game_title_id, legacy_game_title_id, input_revision)
VALUES (pg_temp.fixture_uuid('series_analysis_campaigns', 'analysis-campaign-concurrency'),
        pg_temp.fixture_uuid('game_titles', 'concurrent-title-a'), 'concurrent-title-a', 0),
       (pg_temp.fixture_uuid('series_analysis_campaigns', 'analysis-campaign-concurrency'),
        pg_temp.fixture_uuid('game_titles', 'concurrent-title-b'), 'concurrent-title-b', 0);
