  INSERT INTO game_titles (id, name, layout_family, display_order)
  VALUES
    ('title-release-smoke-a', 'Release smoke A', 'momotetsu2', 901),
    ('title-release-smoke-b', 'Release smoke B', 'momotetsu2', 902);
  INSERT INTO map_masters (id, game_title_id, name, display_order)
  VALUES ('map-release-smoke-a', 'title-release-smoke-a', 'Release smoke map', 1);
  INSERT INTO season_masters (id, game_title_id, name, display_order)
  VALUES ('season-release-smoke-a', 'title-release-smoke-a', 'Release smoke season', 1);
  INSERT INTO held_events (id, session_id, held_date_iso, start_at)
  VALUES ('event-release-smoke-a', NULL, DATE '2026-08-09', TIMESTAMPTZ '2026-08-09T00:00:00Z');
  INSERT INTO matches (
    id, held_event_id, match_no_in_event, game_title_id, layout_family,
    season_master_id, owner_member_id, map_master_id, played_at,
    created_by_member_id, created_by_account_id, analysis_revision
  ) VALUES (
    'match-release-smoke-a', 'event-release-smoke-a', 1,
    'title-release-smoke-a', 'momotetsu2', 'season-release-smoke-a',
    'member_ponta', 'map-release-smoke-a', TIMESTAMPTZ '2026-08-09T00:00:00Z',
    'member_ponta', 'account_ponta', 1
  );
  INSERT INTO match_players (
    match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
  ) VALUES
    ('match-release-smoke-a', 'member_eu', 1, 4, -100, 10),
    ('match-release-smoke-a', 'member_ponta', 2, 1, 4000, 800),
    ('match-release-smoke-a', 'member_akane_mami', 3, 2, 3000, 600),
    ('match-release-smoke-a', 'member_otaka', 4, 3, 2000, 400);
  INSERT INTO match_incidents (match_id, member_id, incident_master_id, count)
  VALUES
    ('match-release-smoke-a', 'member_ponta', 'incident_destination', 2),
    ('match-release-smoke-a', 'member_eu', 'incident_suri_no_ginji', 1);
  INSERT INTO series_analysis_reader_capabilities (
    reader_id, artifact_schema_versions, validation_contract_ids
  ) VALUES (
    'reader-release-smoke',
    :'reader_schemas'::jsonb,
    :'reader_contracts'::jsonb
  );
  INSERT INTO series_analysis_worker_capabilities (
    worker_id, algorithm_versions, artifact_schema_versions
  ) VALUES (
    :'release_capability_id',
    jsonb_build_array(:'algorithm_version'),
    jsonb_build_array(:artifact_schema_version)
  );
