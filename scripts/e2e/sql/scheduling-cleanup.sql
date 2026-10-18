BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DELETE FROM ocr_drafts WHERE job_id = 'ci-scheduling-ocr-job';
DELETE FROM ocr_submission_members WHERE submission_id = '00000000-0024-4000-8000-000000000099';
DELETE FROM ocr_submissions WHERE id = '00000000-0024-4000-8000-000000000099';
DELETE FROM match_drafts WHERE id = 'ci-scheduling-match-draft';
DELETE FROM ocr_jobs WHERE id = 'ci-scheduling-ocr-job';
DELETE FROM source_images WHERE id = 'ci-scheduling-source-image';
UPDATE series_analysis_title_states
SET current_artifact_id = NULL, previous_artifact_id = NULL,
    notification_baseline_state = 'unknown', notification_baseline_artifact_id = NULL
WHERE game_title_id IN ('ci-scheduling-title', 'ci-scheduling-waiting-title');
DELETE FROM series_analysis_artifacts WHERE game_title_id IN ('ci-scheduling-title', 'ci-scheduling-waiting-title');
DELETE FROM series_analysis_jobs WHERE id IN ('ci-scheduling-analysis-job', 'ci-scheduling-waiting-analysis-job');
DELETE FROM series_analysis_worker_capabilities
WHERE worker_id IN (:'analysis_worker_id', :'analysis_capability_id');
DELETE FROM match_incidents WHERE match_id IN ('ci-scheduling-match', 'ci-scheduling-waiting-match');
DELETE FROM match_players WHERE match_id IN ('ci-scheduling-match', 'ci-scheduling-waiting-match');
DELETE FROM matches WHERE id IN ('ci-scheduling-match', 'ci-scheduling-waiting-match');
DELETE FROM held_events WHERE id = 'ci-scheduling-event';
DELETE FROM season_masters WHERE id IN ('ci-scheduling-season', 'ci-scheduling-waiting-season');
DELETE FROM map_masters WHERE id IN ('ci-scheduling-map', 'ci-scheduling-waiting-map');
DELETE FROM game_titles WHERE id IN ('ci-scheduling-title', 'ci-scheduling-waiting-title');
COMMIT;
