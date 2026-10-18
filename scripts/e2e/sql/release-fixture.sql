WITH fixture_titles AS (
       INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
       VALUES (pg_temp.fixture_uuid('game_titles', 'title-release-smoke-a'), 'title-release-smoke-a', 'Release smoke A',
               'momotetsu_2', 901), (pg_temp.fixture_uuid('game_titles', 'title-release-smoke-b'), 'title-release-smoke-b',
               'Release smoke B', 'momotetsu_2', 902)
       RETURNING id
     )
  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
  WHERE release.singleton_key = 'current'
  ON CONFLICT (game_title_id) DO NOTHING;
INSERT INTO map_masters (id, legacy_id, game_title_id, name, display_order)
VALUES (pg_temp.fixture_uuid('map_masters', 'map-release-smoke-a'), 'map-release-smoke-a',
        pg_temp.fixture_uuid('game_titles', 'title-release-smoke-a'), 'Release smoke map', 1);
INSERT INTO season_masters (id, legacy_id, game_title_id, name, display_order)
VALUES (pg_temp.fixture_uuid('season_masters', 'season-release-smoke-a'), 'season-release-smoke-a',
        pg_temp.fixture_uuid('game_titles', 'title-release-smoke-a'), 'Release smoke season', 1);
INSERT INTO held_events (id, legacy_id, session_id, held_date_iso, start_at)
VALUES (pg_temp.fixture_uuid('held_events', 'event-release-smoke-a'), 'event-release-smoke-a', NULL,
        CAST('2026-08-09' AS date), CAST('2026-08-09T00:00:00Z' AS timestamptz));
INSERT INTO matches (id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event, game_title_id,
                     layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_member_id,
                     created_by_account_id, analysis_revision)
VALUES (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'), 'match-release-smoke-a',
        pg_temp.fixture_uuid('held_events', 'event-release-smoke-a'), 'event-release-smoke-a', 1,
        pg_temp.fixture_uuid('game_titles', 'title-release-smoke-a'), 'momotetsu_2',
        pg_temp.fixture_uuid('season_masters', 'season-release-smoke-a'), pg_temp.fixture_uuid('members', 'member_ponta'),
        pg_temp.fixture_uuid('map_masters', 'map-release-smoke-a'), CAST('2026-08-09T00:00:00Z' AS timestamptz),
        pg_temp.fixture_uuid('members', 'member_ponta'), pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), 1);
INSERT INTO match_players (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
VALUES (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'), pg_temp.fixture_uuid('members', 'member_eu'), 1, 4, -100, 10),
       (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'), pg_temp.fixture_uuid('members', 'member_ponta'), 2, 1,
        4000, 800), (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'),
        pg_temp.fixture_uuid('members', 'member_akane_mami'), 3, 2, 3000, 600),
       (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'), pg_temp.fixture_uuid('members', 'member_otaka'), 4, 3,
        2000, 400);
INSERT INTO match_incidents (match_id, member_id, incident_master_id, count)
VALUES (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'), pg_temp.fixture_uuid('members', 'member_ponta'),
        pg_temp.fixture_uuid('incident_masters', 'incident_destination'), 2),
       (pg_temp.fixture_uuid('matches', 'match-release-smoke-a'), pg_temp.fixture_uuid('members', 'member_eu'),
        pg_temp.fixture_uuid('incident_masters', 'incident_suri_no_ginji'), 1);
INSERT INTO series_analysis_reader_capabilities (reader_id, artifact_schema_versions, validation_contract_ids)
VALUES ('reader-release-smoke', CAST(:'reader_schemas' AS jsonb), CAST(:'reader_contracts' AS jsonb));
INSERT INTO series_analysis_worker_capabilities (worker_id, algorithm_versions, artifact_schema_versions)
VALUES (:'release_capability_id', jsonb_build_array(:'algorithm_version'), jsonb_build_array(:artifact_schema_version));
