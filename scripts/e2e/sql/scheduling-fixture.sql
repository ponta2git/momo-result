WITH fixture_titles AS (
       INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
       VALUES (pg_temp.fixture_uuid('game_titles', 'ci-scheduling-title'), 'ci-scheduling-title', 'Scheduling smoke',
               'momotetsu_2', 9901)
       RETURNING id
     )
  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
  WHERE release.singleton_key = 'current'
  ON CONFLICT (game_title_id) DO NOTHING;
INSERT INTO map_masters (id, legacy_id, game_title_id, name, display_order)
VALUES (pg_temp.fixture_uuid('map_masters', 'ci-scheduling-map'), 'ci-scheduling-map',
        pg_temp.fixture_uuid('game_titles', 'ci-scheduling-title'), 'Scheduling map', 1);
INSERT INTO season_masters (id, legacy_id, game_title_id, name, display_order)
VALUES (pg_temp.fixture_uuid('season_masters', 'ci-scheduling-season'), 'ci-scheduling-season',
        pg_temp.fixture_uuid('game_titles', 'ci-scheduling-title'), 'Scheduling season', 1);
INSERT INTO held_events (id, legacy_id, session_id, held_date_iso, start_at)
VALUES (pg_temp.fixture_uuid('held_events', 'ci-scheduling-event'), 'ci-scheduling-event', NULL,
        CAST('2026-08-12' AS date), CAST('2026-08-12T00:00:00Z' AS timestamptz));
INSERT INTO matches (id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event, game_title_id,
                     layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_member_id,
                     created_by_account_id, analysis_revision)
VALUES (pg_temp.fixture_uuid('matches', 'ci-scheduling-match'), 'ci-scheduling-match',
        pg_temp.fixture_uuid('held_events', 'ci-scheduling-event'), 'ci-scheduling-event', 1,
        pg_temp.fixture_uuid('game_titles', 'ci-scheduling-title'), 'momotetsu_2',
        pg_temp.fixture_uuid('season_masters', 'ci-scheduling-season'), pg_temp.fixture_uuid('members', 'member_ponta'),
        pg_temp.fixture_uuid('map_masters', 'ci-scheduling-map'), CAST('2026-08-12T00:00:00Z' AS timestamptz),
        pg_temp.fixture_uuid('members', 'member_ponta'), pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), 1);
INSERT INTO match_players (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
VALUES (pg_temp.fixture_uuid('matches', 'ci-scheduling-match'), pg_temp.fixture_uuid('members', 'member_eu'), 1, 4, -100, 10),
       (pg_temp.fixture_uuid('matches', 'ci-scheduling-match'), pg_temp.fixture_uuid('members', 'member_ponta'), 2, 1, 4000, 800),
       (pg_temp.fixture_uuid('matches', 'ci-scheduling-match'), pg_temp.fixture_uuid('members', 'member_akane_mami'), 3, 2,
        3000, 600),
       (pg_temp.fixture_uuid('matches', 'ci-scheduling-match'), pg_temp.fixture_uuid('members', 'member_otaka'), 4, 3, 2000, 400);
UPDATE series_analysis_title_states
SET input_revision = 1, pending_work = TRUE, algorithm_version = :'algorithm_version',
    artifact_schema_version = :artifact_schema_version, validation_contract_id = :'validation_contract_id'
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'ci-scheduling-title';
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at)
VALUES (pg_temp.fixture_uuid('series_analysis_jobs', 'ci-scheduling-analysis-job'), 'ci-scheduling-analysis-job',
        pg_temp.fixture_uuid('game_titles', 'ci-scheduling-title'), 1, :'algorithm_version', :artifact_schema_version,
        :'validation_contract_id', 'queued', 'manual', clock_timestamp(), clock_timestamp());
WITH fixture_titles AS (
       INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
       VALUES (pg_temp.fixture_uuid('game_titles', 'ci-scheduling-waiting-title'), 'ci-scheduling-waiting-title',
               'Waiting analysis', 'momotetsu_2', 9902)
       RETURNING id
     )
  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
  WHERE release.singleton_key = 'current'
  ON CONFLICT (game_title_id) DO NOTHING;
INSERT INTO map_masters (id, legacy_id, game_title_id, name, display_order)
VALUES (pg_temp.fixture_uuid('map_masters', 'ci-scheduling-waiting-map'), 'ci-scheduling-waiting-map',
        pg_temp.fixture_uuid('game_titles', 'ci-scheduling-waiting-title'), 'Waiting map', 1);
INSERT INTO season_masters (id, legacy_id, game_title_id, name, display_order)
VALUES (pg_temp.fixture_uuid('season_masters', 'ci-scheduling-waiting-season'), 'ci-scheduling-waiting-season',
        pg_temp.fixture_uuid('game_titles', 'ci-scheduling-waiting-title'), 'Waiting season', 1);
INSERT INTO matches (id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event, game_title_id,
                     layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_member_id,
                     created_by_account_id, analysis_revision)
SELECT pg_temp.fixture_uuid('matches', 'ci-scheduling-waiting-match'), 'ci-scheduling-waiting-match',
       pg_temp.fixture_uuid('held_events', matches.legacy_held_event_id), matches.legacy_held_event_id, 2,
       pg_temp.fixture_uuid('game_titles', 'ci-scheduling-waiting-title'), layout_family,
       pg_temp.fixture_uuid('season_masters', 'ci-scheduling-waiting-season'), matches.owner_member_id,
       pg_temp.fixture_uuid('map_masters', 'ci-scheduling-waiting-map'), played_at, matches.created_by_member_id,
       matches.created_by_account_id, analysis_revision
FROM matches
WHERE matches.legacy_id = 'ci-scheduling-match';
INSERT INTO match_players (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
SELECT pg_temp.fixture_uuid('matches', 'ci-scheduling-waiting-match'), match_players.member_id, play_order, rank,
       total_assets_man_yen, revenue_man_yen
FROM match_players
WHERE (SELECT fixture_parent.legacy_id
       FROM matches AS fixture_parent
       WHERE fixture_parent.id = match_players.match_id) = 'ci-scheduling-match';
UPDATE series_analysis_title_states
SET input_revision = 1, pending_work = TRUE, algorithm_version = :'algorithm_version',
    artifact_schema_version = :artifact_schema_version, validation_contract_id = :'validation_contract_id'
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'ci-scheduling-waiting-title';
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at)
VALUES (pg_temp.fixture_uuid('series_analysis_jobs', 'ci-scheduling-waiting-analysis-job'),
        'ci-scheduling-waiting-analysis-job', pg_temp.fixture_uuid('game_titles', 'ci-scheduling-waiting-title'), 1,
        :'algorithm_version', :artifact_schema_version, :'validation_contract_id', 'queued', 'manual', clock_timestamp(),
        clock_timestamp() + CAST('1 hour' AS interval));
INSERT INTO source_images (id, legacy_id, owner_account_id, object_key, idempotency_key_hash, status, media_type,
                           byte_length, sha256_hex, width, height, storage_etag, available_at)
VALUES (pg_temp.fixture_uuid('source_images', 'ci-scheduling-source-image'), 'ci-scheduling-source-image',
        pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), 'source-images/ci-scheduling-source.png',
        repeat('1', 64), 'AVAILABLE', 'image/png', 68, repeat('ab', 32), 1, 1, 'ci-scheduling-etag', clock_timestamp());
INSERT INTO ocr_jobs (id, legacy_id, draft_id, legacy_draft_id, image_id, image_path, requested_screen_type, status,
                      source_image_id, input_snapshot, available_at)
VALUES (pg_temp.fixture_uuid('ocr_jobs', 'ci-scheduling-ocr-job'), 'ci-scheduling-ocr-job',
        pg_temp.fixture_uuid('ocr_drafts', 'ci-scheduling-draft'), 'ci-scheduling-draft', 'ci-scheduling-source-image',
        NULL, 'total_assets', 'queued', pg_temp.fixture_uuid('source_images', 'ci-scheduling-source-image'),
        jsonb_build_object('schemaVersion', '2', 'jobId', 'ci-scheduling-ocr-job', 'draftId', 'ci-scheduling-draft',
                           'sourceImageId', 'ci-scheduling-source-image', 'imageObjectKey', 'source-images/ci-scheduling-source.png', 'sha256',
                           repeat('ab', 32), 'byteLength', '68', 'mediaType', 'image/png', 'requestedScreenType', 'total_assets'),
        clock_timestamp() + CAST('1 hour' AS interval));
INSERT INTO match_drafts (id, legacy_id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
                          legacy_total_assets_draft_id)
VALUES (pg_temp.fixture_uuid('match_drafts', 'ci-scheduling-match-draft'), 'ci-scheduling-match-draft',
        pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), pg_temp.fixture_uuid('members', 'member_ponta'),
        'ocr_running', pg_temp.fixture_uuid('ocr_drafts', 'ci-scheduling-draft'), 'ci-scheduling-draft');
INSERT INTO ocr_submissions (id, legacy_id, owner_account_id, match_draft_id, legacy_match_draft_id, ocr_hints_json,
                             admission_deadline)
VALUES (pg_temp.fixture_uuid('ocr_submissions', '00000000-0024-4000-8000-000000000099'),
        '00000000-0024-4000-8000-000000000099', pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'),
        pg_temp.fixture_uuid('match_drafts', 'ci-scheduling-match-draft'), 'ci-scheduling-match-draft', CAST('{}' AS jsonb),
        clock_timestamp() + CAST('10 minutes' AS interval));
INSERT INTO ocr_submission_members (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex,
                                    image_byte_length, status, job_id)
VALUES (pg_temp.fixture_uuid('ocr_submissions', '00000000-0024-4000-8000-000000000099'), 'total_assets',
        repeat('1', 64), repeat('ab', 32), 68, 'registered', pg_temp.fixture_uuid('ocr_jobs', 'ci-scheduling-ocr-job'));
