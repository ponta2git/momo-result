use std::collections::{BTreeMap, BTreeSet};

use crate::{
    canonical::FramedSha256,
    model::{AnalysisInput, IncidentCounts, NormalizedAnalysisInput, PlayerMatchInput},
};

use super::types::{
    RadarError, RadarMapCount, RadarMatchOrder, RadarSourceMatch, RadarSourcePlayer,
    RadarSourceSnapshot, RadarSourceSummary,
};

/// Captures only facts that affect radar calculation, membership, or match ordering.
///
/// # Errors
///
/// Rejects an input that changes the fixed four-member roster between matches.
pub fn snapshot(input: &NormalizedAnalysisInput) -> Result<RadarSourceSnapshot, RadarError> {
    let rows = input.player_matches().iter().collect::<Vec<_>>();
    Ok(RadarSourceSnapshot {
        game_title_id: input.game_title_id().to_owned(),
        matches: source_matches(&rows)?,
    })
}

/// New matches are permitted; every saved source match must still have exactly the saved facts.
///
/// An incident, owner, play-order, display-name, or unrelated match revision change cannot
/// invalidate a radar candidate. A changed title, scope membership, order, or result does.
///
/// # Errors
///
/// Returns an error if the current input no longer has the fixed radar roster.
pub fn source_is_current(
    source: &RadarSourceSnapshot,
    input: &NormalizedAnalysisInput,
) -> Result<bool, RadarError> {
    if source.game_title_id != input.game_title_id() {
        return Ok(false);
    }
    let current = snapshot(input)?;
    let current_by_id = current
        .matches
        .iter()
        .map(|item| (item.order.match_id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    Ok(source.matches.iter().all(|item| {
        current_by_id
            .get(item.order.match_id.as_str())
            .is_some_and(|current_item| **current_item == *item)
    }))
}

impl RadarSourceSnapshot {
    /// Validates a saved radar-only snapshot and recovers its deterministic scope index.
    ///
    /// Synthetic incident/owner/order fields satisfy the existing input boundary only; no
    /// non-radar calculation may use the returned rows as newly observed match facts.
    ///
    /// # Errors
    ///
    /// Rejects unsupported identities, counts, ranks, duplicate matches, and noncanonical order.
    pub fn normalized_for_validation(
        &self,
        input_revision: i64,
    ) -> Result<NormalizedAnalysisInput, RadarError> {
        let rows = self
            .matches
            .iter()
            .flat_map(|item| {
                let owner = item
                    .players
                    .first()
                    .map_or("", |player| player.member_id.as_str());
                item.players
                    .iter()
                    .zip(1..=4)
                    .map(move |(player, play_order)| PlayerMatchInput {
                        match_id: item.order.match_id.clone(),
                        match_revision: 0,
                        played_at: item.order.played_at.clone(),
                        held_event_id: item.order.held_event_id.clone(),
                        match_no_in_event: item.order.match_no_in_event,
                        season_master_id: item.season_master_id.clone(),
                        map_master_id: item.map_master_id.clone(),
                        owner_member_id: owner.to_owned(),
                        member_id: player.member_id.clone(),
                        play_order,
                        rank: player.rank,
                        total_assets_man_yen: player.total_assets_man_yen,
                        revenue_man_yen: player.revenue_man_yen,
                        incidents: IncidentCounts::default(),
                    })
            })
            .collect();
        let input = AnalysisInput {
            game_title_id: self.game_title_id.clone(),
            input_revision,
            player_matches: rows,
        }
        .try_into_normalized()
        .map_err(|_invalid| RadarError::InvalidSource)?;
        if snapshot(&input)? != *self {
            return Err(RadarError::InvalidSource);
        }
        Ok(input)
    }

    /// Bounded display metadata and the semantic source checksum.
    ///
    /// # Errors
    ///
    /// Returns a canonical encoding error when a snapshot cannot be encoded.
    pub fn summary(&self) -> Result<RadarSourceSummary, RadarError> {
        let mut digest = FramedSha256::new();
        let mut buffer = Vec::new();
        digest.update_serialized(&self.game_title_id, &mut buffer)?;
        for item in &self.matches {
            digest.update_serialized(item, &mut buffer)?;
        }
        Ok(RadarSourceSummary {
            game_title_id: self.game_title_id.clone(),
            source_checksum: digest.finalize(),
            match_count: self.matches.len(),
            held_event_count: self
                .matches
                .iter()
                .map(|item| &item.order.held_event_id)
                .collect::<BTreeSet<_>>()
                .len(),
            first_match: self.matches.first().map(|item| item.order.clone()),
            last_match: self.matches.last().map(|item| item.order.clone()),
            map_master_ids: self
                .matches
                .iter()
                .map(|item| item.map_master_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            map_counts: map_counts(&self.matches),
        })
    }
}

pub(super) fn map_counts(matches: &[RadarSourceMatch]) -> Vec<RadarMapCount> {
    let mut counts = BTreeMap::<String, usize>::new();
    for item in matches {
        *counts.entry(item.map_master_id.clone()).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(map_master_id, match_count)| RadarMapCount {
            map_master_id,
            match_count,
        })
        .collect()
}

pub(super) fn source_matches(
    rows: &[&PlayerMatchInput],
) -> Result<Vec<RadarSourceMatch>, RadarError> {
    let mut by_match = BTreeMap::<RadarMatchOrder, Vec<&PlayerMatchInput>>::new();
    for row in rows {
        by_match.entry(order(row)).or_default().push(row);
    }
    let mut roster: Option<Vec<String>> = None;
    by_match
        .into_iter()
        .map(|(order, mut match_rows)| {
            match_rows.sort_by(|left, right| left.member_id.cmp(&right.member_id));
            let players = match_rows
                .iter()
                .map(|row| RadarSourcePlayer {
                    member_id: row.member_id.clone(),
                    rank: row.rank,
                    total_assets_man_yen: row.total_assets_man_yen,
                    revenue_man_yen: row.revenue_man_yen,
                })
                .collect::<Vec<_>>()
                .try_into()
                .map_err(|_wrong_length| RadarError::InvalidRoster)?;
            let member_ids = match_rows
                .iter()
                .map(|row| row.member_id.clone())
                .collect::<Vec<_>>();
            if member_ids
                .windows(2)
                .any(|pair| pair.first() == pair.last())
                || roster.as_ref().is_some_and(|roster| roster != &member_ids)
            {
                return Err(RadarError::InvalidRoster);
            }
            roster = Some(member_ids);
            let first = match_rows.first().ok_or(RadarError::InvalidRoster)?;
            Ok(RadarSourceMatch {
                order,
                season_master_id: first.season_master_id.clone(),
                map_master_id: first.map_master_id.clone(),
                players,
            })
        })
        .collect()
}

pub(super) fn order(row: &PlayerMatchInput) -> RadarMatchOrder {
    RadarMatchOrder {
        played_at: row.played_at.clone(),
        held_event_id: row.held_event_id.clone(),
        match_no_in_event: row.match_no_in_event,
        match_id: row.match_id.clone(),
    }
}
