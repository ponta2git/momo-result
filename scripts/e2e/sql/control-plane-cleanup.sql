BEGIN;
SET LOCAL statement_timeout TO '10s';
SET LOCAL lock_timeout TO '5s';
UPDATE series_analysis_title_states
SET current_artifact_id = NULL, previous_artifact_id = NULL, notification_baseline_state = 'unknown',
    notification_baseline_artifact_id = NULL
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_artifacts
WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_operation_requests AS operation
WHERE EXISTS (SELECT 1
              FROM series_analysis_campaigns AS campaign
                   INNER JOIN series_analysis_campaign_targets AS target ON (SELECT fixture_parent.legacy_id
                                                                             FROM series_analysis_campaigns AS fixture_parent
                                                                             WHERE fixture_parent.id = target.campaign_id) = campaign.legacy_id
              WHERE (SELECT fixture_parent.legacy_id
                     FROM series_analysis_operation_requests AS fixture_parent
                     WHERE fixture_parent.id = campaign.operation_request_id) = operation.legacy_id
                AND target.legacy_game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b'))
   OR EXISTS (SELECT 1
              FROM series_analysis_job_requests AS request
              WHERE (SELECT fixture_parent.legacy_id
                     FROM series_analysis_operation_requests AS fixture_parent
                     WHERE fixture_parent.id = request.operation_request_id) = operation.legacy_id
                AND request.legacy_game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b'));
DELETE FROM series_analysis_job_requests
WHERE series_analysis_job_requests.legacy_game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_jobs
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_jobs.game_title_id) IN ('title-release-smoke-a', 'title-release-smoke-b');
DELETE FROM series_analysis_reader_capabilities
WHERE reader_id = 'reader-release-smoke';
DELETE FROM series_analysis_worker_capabilities
WHERE worker_id IN ('worker-release-smoke', :'release_capability_id', :'analysis_worker_id', :'analysis_capability_id');
DELETE FROM match_incidents
WHERE (SELECT fixture_parent.legacy_id
       FROM matches AS fixture_parent
       WHERE fixture_parent.id = match_incidents.match_id) = 'match-release-smoke-a';
DELETE FROM match_players
WHERE (SELECT fixture_parent.legacy_id
       FROM matches AS fixture_parent
       WHERE fixture_parent.id = match_players.match_id) = 'match-release-smoke-a';
DELETE FROM matches
WHERE matches.legacy_id = 'match-release-smoke-a';
DELETE FROM held_events
WHERE held_events.legacy_id = 'event-release-smoke-a';
DELETE FROM season_masters
WHERE season_masters.legacy_id = 'season-release-smoke-a';
DELETE FROM map_masters
WHERE map_masters.legacy_id = 'map-release-smoke-a';
DELETE FROM game_titles
WHERE game_titles.legacy_id IN ('title-release-smoke-a', 'title-release-smoke-b');
COMMIT;
