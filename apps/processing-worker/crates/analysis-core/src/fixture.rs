use std::collections::BTreeSet;

use serde_json::Value;

use crate::{
    canonical::{canonicalize_value, sha256_prefixed},
    compute::{ComputedResourceKind, compute_all},
    contract::ScopeRef,
    model::{AnalysisInput, IncidentCounts, PlayerMatchInput},
};

const INPUT_FIXTURE: &str =
    include_str!("../../../../../docs/schemas/fixtures/series-analysis/input-v1.json");

fn fixture_json() -> Value {
    serde_json::from_str(INPUT_FIXTURE)
        .unwrap_or_else(|error| panic!("invalid series-analysis input fixture: {error}"))
}

fn fixture_value<'a>(fixture: &'a Value, pointer: &str) -> &'a Value {
    fixture
        .pointer(pointer)
        .unwrap_or_else(|| panic!("fixture value is missing: {pointer}"))
}

fn fixture_count(fixture: &Value, pointer: &str) -> usize {
    fixture_value(fixture, pointer)
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or_else(|| panic!("fixture count is invalid: {pointer}"))
}

fn boundary_input() -> AnalysisInput {
    let players = ["eu", "ponta", "akane", "otaka"];
    let rows = (0_i32..8)
        .flat_map(|event_index| {
            players
                .into_iter()
                .enumerate()
                .flat_map(move |(player_index, member_id)| {
                    (0_i32..4).map(move |match_index| {
                        let player_index = i32::try_from(player_index)
                            .unwrap_or_else(|_| panic!("fixture player index exceeds i32"));
                        let mut total_assets_man_yen =
                            1_000 + event_index * 100 + match_index * 10 + player_index * 250;
                        let mut revenue_man_yen =
                            100 + event_index * 20 + match_index * 5 + player_index * 40;
                        let match_id = format!("match-{event_index:02}-{match_index:02}");
                        if match_id == "match-01-00" && member_id == "ponta" {
                            total_assets_man_yen = 0;
                            revenue_man_yen = 10;
                        }
                        if match_id == "match-02-00" && member_id == "eu" {
                            total_assets_man_yen = -500;
                        }
                        let incident = |incident_index: i32| {
                            (event_index + match_index + player_index + incident_index) % 3
                        };
                        let played_at = if event_index == 0 && match_index <= 1 {
                            String::from("2026-01-01T12:00:00.123456Z")
                        } else {
                            format!(
                                "2026-01-{:02}T12:{match_index:02}:00.123456Z",
                                event_index + 1
                            )
                        };
                        PlayerMatchInput {
                            match_id,
                            match_revision: 1,
                            played_at,
                            held_event_id: format!("event-{event_index:02}"),
                            match_no_in_event: match_index + 1,
                            season_master_id: format!("season-{}", 1 + event_index % 2),
                            map_master_id: format!("map-{}", 1 + match_index % 2),
                            member_id: String::from(member_id),
                            play_order: 1 + (match_index + player_index) % 4,
                            rank: 1 + (event_index + match_index + player_index) % 4,
                            total_assets_man_yen,
                            revenue_man_yen,
                            incidents: IncidentCounts {
                                destination: incident(0),
                                plus_station: incident(1),
                                minus_station: incident(2),
                                card_station: incident(3),
                                card_shop: incident(4),
                                suri_no_ginji: incident(5),
                            },
                        }
                    })
                })
        })
        .collect();
    AnalysisInput {
        game_title_id: String::from("title-boundary-fixture"),
        input_revision: 7,
        player_matches: rows,
    }
}

#[test]
fn shared_boundary_fixture_matches_normalized_input_and_overall_checksum() {
    let fixture = fixture_json();
    assert_eq!(fixture_value(&fixture, "/schemaVersion"), &Value::from(1));
    assert_eq!(
        fixture_value(&fixture, "/generator/heldEventCount"),
        &Value::from(8)
    );
    assert_eq!(
        fixture_value(&fixture, "/generator/matchesPerHeldEvent"),
        &Value::from(4)
    );
    assert_eq!(
        fixture_value(&fixture, "/players"),
        &serde_json::json!(["eu", "ponta", "akane", "otaka"])
    );

    let input = boundary_input();
    assert_eq!(
        input.player_matches.len(),
        fixture_count(&fixture, "/expected/rowCount")
    );
    assert_eq!(
        input
            .player_matches
            .iter()
            .map(|row| row.match_id.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        fixture_count(&fixture, "/expected/matchCount")
    );
    assert_eq!(
        input.scopes().len(),
        fixture_count(&fixture, "/expected/scopeCount")
    );

    let normalized = input.normalized();
    assert!(
        normalized
            .player_matches
            .get(..4)
            .unwrap_or_default()
            .iter()
            .all(|row| row.match_id == "match-00-00")
    );
    assert!(
        normalized
            .player_matches
            .get(4..8)
            .unwrap_or_default()
            .iter()
            .all(|row| row.match_id == "match-00-01")
    );
    let zero_denominator = normalized
        .player_matches
        .iter()
        .find(|row| row.match_id == "match-01-00" && row.member_id == "ponta")
        .unwrap_or_else(|| panic!("zero-denominator fixture row is missing"));
    assert_eq!(zero_denominator.total_assets_man_yen, 0);
    assert_eq!(zero_denominator.revenue_man_yen, 10);
    let negative_assets = normalized
        .player_matches
        .iter()
        .find(|row| row.match_id == "match-02-00" && row.member_id == "eu")
        .unwrap_or_else(|| panic!("negative-assets fixture row is missing"));
    assert_eq!(negative_assets.total_assets_man_yen, -500);

    let resources = compute_all(&input);
    assert_eq!(
        normalized.resource_count(),
        Some(u64::try_from(fixture_count(&fixture, "/expected/resourceCount")).unwrap_or(0))
    );
    assert_eq!(
        resources.len(),
        fixture_count(&fixture, "/expected/resourceCount")
    );
    let overall = resources
        .iter()
        .find(|resource| {
            resource.scope == ScopeRef::Overall && resource.kind == ComputedResourceKind::Aggregate
        })
        .unwrap_or_else(|| panic!("overall aggregate is missing"));
    assert_eq!(
        overall.payload.pointer("/scope/matchCount"),
        Some(fixture_value(&fixture, "/expected/matchCount"))
    );
    for (payload_pointer, fixture_pointer) in [
        (
            "/assetStyleProfiles/blowoutWinThreshold",
            "/expected/assetStyle/blowoutWinThreshold",
        ),
        (
            "/assetStyleProfiles/nearMissSecondThreshold",
            "/expected/assetStyle/nearMissSecondThreshold",
        ),
        (
            "/assetStyleProfiles/heavyLossThreshold",
            "/expected/assetStyle/heavyLossThreshold",
        ),
        (
            "/assetStyleProfiles/entries/0/primaryKind",
            "/expected/assetStyle/euPrimaryKind",
        ),
        (
            "/assetStyleProfiles/entries/0/shapeKind",
            "/expected/assetStyle/euShapeKind",
        ),
        (
            "/assetStyleProfiles/entries/0/tags",
            "/expected/assetStyle/euTags",
        ),
        (
            "/assetStyleProfiles/entries/3/primaryKind",
            "/expected/assetStyle/otakaPrimaryKind",
        ),
        (
            "/assetStyleProfiles/entries/3/secondaryKind",
            "/expected/assetStyle/otakaSecondaryKind",
        ),
    ] {
        assert_eq!(
            overall.payload.pointer(payload_pointer),
            Some(fixture_value(&fixture, fixture_pointer)),
            "asset-style fixture drifted at {payload_pointer}",
        );
    }
    let encoded = canonicalize_value(&overall.payload)
        .unwrap_or_else(|error| panic!("overall aggregate is not canonicalizable: {error}"));
    let checksum = sha256_prefixed(&encoded);
    assert_eq!(
        Some(checksum.as_str()),
        fixture_value(&fixture, "/expected/overallAggregateChecksum").as_str()
    );
}
