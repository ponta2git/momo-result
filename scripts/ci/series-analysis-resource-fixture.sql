\set ON_ERROR_STOP on

-- Deterministic synthetic upper-bound fixture for an isolated, migrated test database.
-- It deliberately combines 500 matches, four players, all 25 season/map pairs,
-- skewed pair and held-event frequencies, and four incident contexts per player.
BEGIN;

INSERT INTO game_titles (id, name, layout_family, display_order)
VALUES ('title-resource-fixture', 'Analysis resource fixture', 'momotetsu2', 990);

INSERT INTO season_masters (id, game_title_id, name, display_order)
SELECT
  'season-resource-' || season_no,
  'title-resource-fixture',
  'Resource season ' || season_no,
  season_no
FROM generate_series(1, 5) AS season(season_no);

INSERT INTO map_masters (id, game_title_id, name, display_order)
SELECT
  'map-resource-' || map_no,
  'title-resource-fixture',
  'Resource map ' || map_no,
  map_no
FROM generate_series(1, 5) AS map(map_no);

INSERT INTO held_events (id, session_id, held_date_iso, start_at)
SELECT
  'event-resource-' || event_no,
  NULL,
  DATE '2025-01-01' + (event_no - 1),
  TIMESTAMPTZ '2025-01-01T00:00:00Z' + (event_no - 1) * INTERVAL '1 day'
FROM generate_series(1, 135) AS event(event_no);

WITH fixture_match AS (
  SELECT
    match_no,
    CASE
      WHEN match_no <= 250 THEN ((match_no - 1) / 25) + 1
      ELSE 10 + ((match_no - 251) / 2) + 1
    END AS event_no,
    CASE
      WHEN match_no <= 250 THEN ((match_no - 1) % 25) + 1
      ELSE ((match_no - 251) % 2) + 1
    END AS match_no_in_event,
    CASE
      WHEN match_no <= 300 THEN 1
      ELSE ((match_no - 301) % 5) + 1
    END AS season_no,
    CASE
      WHEN match_no <= 300 THEN 1
      ELSE (((match_no - 301) / 5) % 5) + 1
    END AS map_no
  FROM generate_series(1, 500) AS match(match_no)
)
INSERT INTO matches (
  id, held_event_id, match_no_in_event, game_title_id, layout_family,
  season_master_id, owner_member_id, map_master_id, played_at,
  created_by_member_id, created_by_account_id, analysis_revision
)
SELECT
  'match-resource-' || match_no,
  'event-resource-' || event_no,
  match_no_in_event,
  'title-resource-fixture',
  'momotetsu2',
  'season-resource-' || season_no,
  'member_ponta',
  'map-resource-' || map_no,
  TIMESTAMPTZ '2025-01-01T00:00:00Z' + match_no * INTERVAL '1 minute',
  'member_ponta',
  'account_ponta',
  1
FROM fixture_match;

WITH fixture_player(play_order, member_id) AS (
  VALUES
    (1, 'member_eu'),
    (2, 'member_ponta'),
    (3, 'member_akane_mami'),
    (4, 'member_otaka')
)
INSERT INTO match_players (
  match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
)
SELECT
  'match-resource-' || match_no,
  player.member_id,
  player.play_order,
  ((match_no + player.play_order - 2) % 4) + 1,
  ((match_no * 137 + player.play_order * 997) % 100000) - 5000,
  ((match_no * 43 + player.play_order * 313) % 20000) - 1000
FROM generate_series(1, 500) AS match(match_no)
CROSS JOIN fixture_player AS player;

WITH fixture_player(play_order, member_id) AS (
  VALUES
    (1, 'member_eu'),
    (2, 'member_ponta'),
    (3, 'member_akane_mami'),
    (4, 'member_otaka')
),
fixture_incident(incident_no, incident_master_id) AS (
  VALUES
    (1, 'incident_destination'),
    (2, 'incident_plus_station'),
    (3, 'incident_card_shop'),
    (4, 'incident_suri_no_ginji')
)
INSERT INTO match_incidents (match_id, member_id, incident_master_id, count)
SELECT
  'match-resource-' || match_no,
  player.member_id,
  incident.incident_master_id,
  ((match_no + player.play_order + incident.incident_no) % 9) + 1
FROM generate_series(1, 500) AS match(match_no)
CROSS JOIN fixture_player AS player
CROSS JOIN fixture_incident AS incident;

DO $fixture$
DECLARE
  match_count bigint;
  player_count bigint;
  incident_count bigint;
  scope_pair_count bigint;
BEGIN
  SELECT COUNT(*) INTO match_count
  FROM matches
  WHERE game_title_id = 'title-resource-fixture';

  SELECT COUNT(*) INTO player_count
  FROM match_players AS player
  JOIN matches AS match ON match.id = player.match_id
  WHERE match.game_title_id = 'title-resource-fixture';

  SELECT COUNT(*) INTO incident_count
  FROM match_incidents AS incident
  JOIN matches AS match ON match.id = incident.match_id
  WHERE match.game_title_id = 'title-resource-fixture';

  SELECT COUNT(*) INTO scope_pair_count
  FROM (
    SELECT DISTINCT season_master_id, map_master_id
    FROM matches
    WHERE game_title_id = 'title-resource-fixture'
  ) AS scope_pairs;

  IF match_count <> 500
    OR player_count <> 2000
    OR incident_count <> 8000
    OR scope_pair_count <> 25
  THEN
    RAISE EXCEPTION
      'resource fixture shape mismatch: matches %, players %, incidents %, pairs %',
      match_count, player_count, incident_count, scope_pair_count;
  END IF;
END
$fixture$;

COMMIT;
