//! Groups normalized player matches into deterministic per-match views.

use crate::model::PlayerMatchInput;

pub(super) struct MatchGroup<'a> {
    pub(super) match_id: &'a str,
    pub(super) match_revision: i64,
    pub(super) played_at: &'a str,
    pub(super) held_event_id: &'a str,
    pub(super) match_no_in_event: i32,
    pub(super) player_matches: Vec<&'a PlayerMatchInput>,
}

pub(super) fn group_player_matches<'a>(
    player_matches: &[&'a PlayerMatchInput],
) -> Vec<MatchGroup<'a>> {
    let mut groups = Vec::<MatchGroup<'a>>::new();
    for player_match in player_matches {
        match groups.last_mut() {
            Some(group) if group.match_id == player_match.match_id => {
                group.player_matches.push(player_match);
            }
            _ => groups.push(MatchGroup {
                match_id: player_match.match_id.as_str(),
                match_revision: player_match.match_revision,
                played_at: player_match.played_at.as_str(),
                held_event_id: player_match.held_event_id.as_str(),
                match_no_in_event: player_match.match_no_in_event,
                player_matches: vec![player_match],
            }),
        }
    }
    groups
}
