BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
UPDATE series_analysis_title_states
SET current_artifact_id = NULL, previous_artifact_id = NULL,
    notification_baseline_state = 'unknown', notification_baseline_artifact_id = NULL
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_artifacts
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_operation_requests operation
WHERE EXISTS (
  SELECT 1
  FROM series_analysis_campaigns campaign
  JOIN series_analysis_campaign_targets target ON target.campaign_id = campaign.id
  WHERE campaign.operation_request_id = operation.id
    AND target.game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b')
)
OR EXISTS (
  SELECT 1
  FROM series_analysis_job_requests request
  WHERE request.operation_request_id = operation.id
    AND request.game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b')
);
DELETE FROM series_analysis_job_requests
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_jobs
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_reader_capabilities
WHERE reader_id = 'reader-release-smoke';
DELETE FROM series_analysis_worker_capabilities
WHERE worker_id IN (
  :'release_worker_id',
  :'release_capability_id',
  'ci-analysis-worker',
  :'analysis_capability_id'
);
DELETE FROM match_incidents WHERE match_id = 'match-release-smoke-a';
DELETE FROM match_players WHERE match_id = 'match-release-smoke-a';
DELETE FROM matches WHERE id = 'match-release-smoke-a';
DELETE FROM held_events WHERE id = 'event-release-smoke-a';
DELETE FROM season_masters WHERE id = 'season-release-smoke-a';
DELETE FROM map_masters WHERE id = 'map-release-smoke-a';
DELETE FROM game_titles
WHERE id IN ('title-release-smoke-a', 'title-release-smoke-b');
COMMIT;
