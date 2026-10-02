#![expect(
    clippy::panic_in_result_fn,
    reason = "fixture errors propagate while assertions report the violated payload bound"
)]

use super::*;
use crate::notifications::analysis::types::{MatchIdentity, MatchPlayer};

fn fixture() -> (Snapshot, comparison::Changes) {
    let players = [1, 2, 3, 4].map(|rank| MatchPlayer {
        member_id: format!("member-{rank}"),
        display_name: "𠮷".repeat(32),
        rank,
        ginji_count: 0,
    });
    let members = players
        .iter()
        .map(|player| (player.member_id.clone(), player.display_name.clone()))
        .collect();
    let snapshot = Snapshot {
        game_title_name: "𠮷".repeat(256),
        members,
        seasons: BTreeMap::from([("season".to_owned(), "𠮷".repeat(256))]),
        matches: vec![NotificationMatch {
            match_id: "match".to_owned(),
            source_revision: "1".to_owned(),
            held_event_id: "held-event".to_owned(),
            held_date_iso: "2026-01-01".to_owned(),
            match_no_in_event: 1,
            played_at: "2026-01-01T00:00:00.000Z".to_owned(),
            map_id: "map".to_owned(),
            map_name: "𠮷".repeat(256),
            season_id: "season".to_owned(),
            season_name: "𠮷".repeat(256),
            owner_name: "𠮷".repeat(32),
            players,
            ginji_total: 0,
            note: Some("𠮷".repeat(150)),
        }],
    };
    let changes = comparison::Changes {
        matches: BTreeMap::from([(
            "match".to_owned(),
            MatchIdentity {
                source_revision: "1".to_owned(),
                season_id: "season".to_owned(),
                map_id: "map".to_owned(),
            },
        )]),
        seasons: BTreeSet::from(["season".to_owned()]),
    };
    (snapshot, changes)
}

#[test]
fn unicode_code_points_allow_the_exact_name_display_and_note_bounds() {
    let (snapshot, changes) = fixture();
    assert_eq!(validate(&snapshot, &changes), Ok(()));
}

#[test]
fn one_excess_code_point_rejects_each_text_field_without_shortening() -> Result<(), &'static str> {
    for field in [
        "title",
        "map",
        "match_season",
        "summary_season",
        "owner",
        "member",
        "player",
        "note",
    ] {
        let (mut snapshot, changes) = fixture();
        let text = match field {
            "title" => &mut snapshot.game_title_name,
            "map" => &mut snapshot.matches.first_mut().ok_or("match")?.map_name,
            "match_season" => &mut snapshot.matches.first_mut().ok_or("match")?.season_name,
            "summary_season" => snapshot.seasons.values_mut().next().ok_or("season")?,
            "owner" => &mut snapshot.matches.first_mut().ok_or("match")?.owner_name,
            "member" => snapshot.members.values_mut().next().ok_or("member")?,
            "player" => {
                &mut snapshot
                    .matches
                    .first_mut()
                    .ok_or("match")?
                    .players
                    .first_mut()
                    .ok_or("player")?
                    .display_name
            }
            "note" => snapshot
                .matches
                .first_mut()
                .ok_or("match")?
                .note
                .as_mut()
                .ok_or("note")?,
            _ => return Err("unknown field"),
        };
        text.push('𠮷');
        assert_eq!(
            validate(&snapshot, &changes),
            Err(SkipReason::PayloadBound),
            "the whole notification must be skipped for oversized {field}"
        );
    }
    Ok(())
}
