INSERT INTO game_titles (id, name, layout_family, display_order)
VALUES ('ci-preemption-title', 'Preemption smoke', 'momotetsu_2', 9901);
INSERT INTO map_masters (id, game_title_id, name, display_order)
VALUES ('ci-preemption-map', 'ci-preemption-title', 'Preemption map', 1);
INSERT INTO season_masters (id, game_title_id, name, display_order)
VALUES ('ci-preemption-season', 'ci-preemption-title', 'Preemption season', 1);
INSERT INTO held_events (id, session_id, held_date_iso, start_at)
VALUES ('ci-preemption-event', NULL, DATE '2026-08-12', TIMESTAMPTZ '2026-08-12T00:00:00Z');
INSERT INTO matches (
  id, held_event_id, match_no_in_event, game_title_id, layout_family,
  season_master_id, owner_member_id, map_master_id, played_at,
  created_by_member_id, created_by_account_id, analysis_revision
) VALUES (
  'ci-preemption-match', 'ci-preemption-event', 1, 'ci-preemption-title', 'momotetsu_2',
  'ci-preemption-season', 'member_ponta', 'ci-preemption-map',
  TIMESTAMPTZ '2026-08-12T00:00:00Z', 'member_ponta', 'account_ponta', 1
);
INSERT INTO match_players (
  match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
) VALUES
  ('ci-preemption-match', 'member_eu', 1, 4, -100, 10),
  ('ci-preemption-match', 'member_ponta', 2, 1, 4000, 800),
  ('ci-preemption-match', 'member_akane_mami', 3, 2, 3000, 600),
  ('ci-preemption-match', 'member_otaka', 4, 3, 2000, 400);
UPDATE series_analysis_title_states
SET input_revision = 1, pending_work = true, algorithm_version = :'algorithm_version',
    artifact_schema_version = :artifact_schema_version,
    validation_contract_id = :'validation_contract_id'
WHERE game_title_id = 'ci-preemption-title';
INSERT INTO series_analysis_jobs (
  id, game_title_id, input_revision, algorithm_version,
  artifact_schema_version, validation_contract_id,
  status, trigger, requested_at, available_at
) VALUES (
  'ci-preemption-analysis-job', 'ci-preemption-title', 1, :'algorithm_version',
  :artifact_schema_version, :'validation_contract_id',
  'queued', 'manual', clock_timestamp(), clock_timestamp()
);
INSERT INTO source_images (
  id, owner_account_id, object_key, idempotency_key_hash, status,
  media_type, byte_length, sha256_hex, width, height, storage_etag, available_at
) VALUES (
  'ci-preemption-source-image', 'account_ponta',
  'source-images/ci-preemption-source.png', repeat('1', 64), 'AVAILABLE',
  'image/png', 68, repeat('ab', 32), 1, 1, 'ci-preemption-etag', clock_timestamp()
);
INSERT INTO ocr_jobs (
  id, draft_id, image_id, image_path, requested_screen_type,
  status, source_image_id, input_snapshot, available_at
) VALUES (
  'ci-preemption-ocr-job', 'ci-preemption-draft', 'ci-preemption-source-image', NULL,
  'total_assets', 'queued', 'ci-preemption-source-image', jsonb_build_object(
    'schemaVersion', '2',
    'jobId', 'ci-preemption-ocr-job',
    'draftId', 'ci-preemption-draft',
    'sourceImageId', 'ci-preemption-source-image',
    'imageObjectKey', 'source-images/ci-preemption-source.png',
    'sha256', repeat('ab', 32),
    'byteLength', '68',
    'mediaType', 'image/png',
    'requestedScreenType', 'total_assets'
  ), clock_timestamp() + interval '1 hour'
);
INSERT INTO match_drafts (id, created_by_account_id, created_by_member_id, status, total_assets_draft_id)
VALUES ('ci-preemption-match-draft', 'account_ponta', 'member_ponta', 'ocr_running', 'ci-preemption-draft');
INSERT INTO ocr_submissions (id, owner_account_id, match_draft_id, ocr_hints_json, admission_deadline)
VALUES ('00000000-0024-4000-8000-000000000099', 'account_ponta', 'ci-preemption-match-draft', '{}'::jsonb, clock_timestamp() + interval '10 minutes');
INSERT INTO ocr_submission_members (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex, image_byte_length, status, job_id)
VALUES ('00000000-0024-4000-8000-000000000099', 'total_assets', repeat('1', 64), repeat('ab', 32), 68, 'registered', 'ci-preemption-ocr-job');
