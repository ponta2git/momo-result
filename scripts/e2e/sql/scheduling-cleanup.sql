BEGIN;
SET LOCAL statement_timeout TO '10s';
SET LOCAL lock_timeout TO '5s';
DELETE FROM ocr_drafts
WHERE ocr_drafts.legacy_job_id = 'ci-scheduling-ocr-job';
DELETE FROM ocr_submission_members
WHERE (SELECT fixture_parent.legacy_id
       FROM ocr_submissions AS fixture_parent
       WHERE fixture_parent.id = ocr_submission_members.submission_id) = '00000000-0024-4000-8000-000000000099';
DELETE FROM ocr_submissions
WHERE ocr_submissions.legacy_id = '00000000-0024-4000-8000-000000000099';
DELETE FROM match_drafts
WHERE match_drafts.legacy_id = 'ci-scheduling-match-draft';
DELETE FROM ocr_jobs
WHERE ocr_jobs.legacy_id = 'ci-scheduling-ocr-job';
DELETE FROM source_images
WHERE source_images.legacy_id = 'ci-scheduling-source-image';
UPDATE series_analysis_title_states
SET current_artifact_id = NULL, previous_artifact_id = NULL, notification_baseline_state = 'unknown',
    notification_baseline_artifact_id = NULL
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) IN ('ci-scheduling-title', 'ci-scheduling-waiting-title');
DELETE FROM series_analysis_artifacts
WHERE game_title_id IN ('ci-scheduling-title', 'ci-scheduling-waiting-title');
DELETE FROM series_analysis_jobs
WHERE series_analysis_jobs.legacy_id IN ('ci-scheduling-analysis-job', 'ci-scheduling-waiting-analysis-job');
DELETE FROM series_analysis_worker_capabilities
WHERE worker_id IN (:'analysis_worker_id', :'analysis_capability_id');
DELETE FROM match_incidents
WHERE (SELECT fixture_parent.legacy_id
       FROM matches AS fixture_parent
       WHERE fixture_parent.id = match_incidents.match_id) IN ('ci-scheduling-match', 'ci-scheduling-waiting-match');
DELETE FROM match_players
WHERE (SELECT fixture_parent.legacy_id
       FROM matches AS fixture_parent
       WHERE fixture_parent.id = match_players.match_id) IN ('ci-scheduling-match', 'ci-scheduling-waiting-match');
DELETE FROM matches
WHERE matches.legacy_id IN ('ci-scheduling-match', 'ci-scheduling-waiting-match');
DELETE FROM held_events
WHERE held_events.legacy_id = 'ci-scheduling-event';
DELETE FROM season_masters
WHERE season_masters.legacy_id IN ('ci-scheduling-season', 'ci-scheduling-waiting-season');
DELETE FROM map_masters
WHERE map_masters.legacy_id IN ('ci-scheduling-map', 'ci-scheduling-waiting-map');
DELETE FROM game_titles
WHERE game_titles.legacy_id IN ('ci-scheduling-title', 'ci-scheduling-waiting-title');
COMMIT;
