use std::{cmp::Ordering, collections::BTreeMap, sync::Arc};

use crate::model::PlayerMatchInput;

use super::{
    ADJUSTMENT_COUNT, EncodedEvent, EncodedMatch, EncodedRow, FULL_FEATURE_COUNT, MatchKey,
    Observation, PLAY_ORDER_COUNT, PLAYER_COUNT, PairRecord, SIGNAL_COUNT, SignalKind, SourceRow,
    evaluation::bounded_count,
};

pub(super) fn encode(
    rows: &[&PlayerMatchInput],
    players: &[String],
) -> Result<Vec<EncodedEvent>, ()> {
    let player_index = players
        .iter()
        .enumerate()
        .map(|(index, member_id)| (member_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let distinct_match_rows = distinct_matches(rows);
    let mut event_matches = BTreeMap::<String, Vec<EncodedMatch>>::new();
    for match_rows in distinct_match_rows {
        if match_rows.len() != PLAYER_COUNT {
            return Err(());
        }
        let mut ordered = match_rows;
        ordered.sort_by_key(|row| player_index.get(row.member_id.as_str()).copied());
        let mut encoded_rows = Vec::with_capacity(PLAYER_COUNT);
        for (row_index, row) in ordered.iter().enumerate() {
            let mut signals = [0.0; SIGNAL_COUNT];
            for (kind, signal) in SignalKind::ALL.into_iter().zip(&mut signals) {
                let mut values = [0.0; PLAYER_COUNT];
                for (target, candidate) in values.iter_mut().zip(&ordered) {
                    *target = f64::from(kind.raw_value(candidate));
                }
                *signal = relative_rank(&values, row_index)?;
            }
            let mut adjustments = [0.0; ADJUSTMENT_COUNT];
            let play_order_index =
                usize::try_from(row.play_order - 1).map_err(|_conversion_error| ())?;
            if play_order_index >= PLAY_ORDER_COUNT {
                return Err(());
            }
            *adjustments.get_mut(play_order_index).ok_or(())? = 1.0;
            let member_index = player_index
                .get(row.member_id.as_str())
                .copied()
                .ok_or(())?;
            if member_index != row_index {
                return Err(());
            }
            let member_adjustment = PLAY_ORDER_COUNT.checked_add(member_index).ok_or(())?;
            *adjustments.get_mut(member_adjustment).ok_or(())? = 1.0;
            encoded_rows.push(EncodedRow {
                source: SourceRow {
                    member_index,
                    rank: row.rank,
                },
                signals,
                adjustments,
            });
        }
        let first = ordered.first().ok_or(())?;
        event_matches
            .entry(first.held_event_id.clone())
            .or_default()
            .push(EncodedMatch {
                match_id: Arc::from(first.match_id.as_str()),
                match_no_in_event: first.match_no_in_event,
                played_at: Arc::from(first.played_at.as_str()),
                rows: encoded_rows.try_into().map_err(|_invalid_count| ())?,
            });
    }
    let mut events = event_matches
        .into_iter()
        .map(|(held_event_id, mut held_event_matches)| {
            held_event_matches
                .sort_by(|left, right| match_sort_key(left).cmp(&match_sort_key(right)));
            let played_at = Arc::clone(&held_event_matches.first().ok_or(())?.played_at);
            Ok(EncodedEvent {
                held_event_id: Arc::from(held_event_id.as_str()),
                played_at,
                matches: held_event_matches,
            })
        })
        .collect::<Result<Vec<_>, ()>>()?;
    events.sort_by(|left, right| {
        (left.played_at.as_ref(), left.held_event_id.as_ref())
            .cmp(&(right.played_at.as_ref(), right.held_event_id.as_ref()))
    });
    if events.is_empty() {
        Err(())
    } else {
        Ok(events)
    }
}

pub(super) fn distinct_matches<'a>(
    rows: &[&'a PlayerMatchInput],
) -> Vec<Vec<&'a PlayerMatchInput>> {
    let mut match_order = Vec::<&str>::new();
    let mut matches = BTreeMap::<&str, Vec<&PlayerMatchInput>>::new();
    for row in rows {
        let match_id = row.match_id.as_str();
        match matches.entry(match_id) {
            std::collections::btree_map::Entry::Occupied(mut entry) => entry.get_mut().push(row),
            std::collections::btree_map::Entry::Vacant(entry) => {
                match_order.push(match_id);
                entry.insert(vec![row]);
            }
        }
    }
    match_order
        .into_iter()
        .filter_map(|match_id| matches.remove(match_id))
        .collect()
}

fn match_sort_key(rank_match: &EncodedMatch) -> (&str, i32, &str) {
    (
        rank_match.played_at.as_ref(),
        rank_match.match_no_in_event,
        rank_match.match_id.as_ref(),
    )
}

fn relative_rank(values: &[f64], target_index: usize) -> Result<f64, ()> {
    let target = *values.get(target_index).ok_or(())?;
    let greater_count = bounded_count(values.iter().filter(|value| **value > target).count())?;
    let tied_count = bounded_count(
        values
            .iter()
            .filter(|value| value.total_cmp(&target) == Ordering::Equal)
            .count(),
    )?;
    let average_rank = greater_count + 1.0 + (tied_count - 1.0) / 2.0;
    Ok((2.5 - average_rank) / 1.5)
}

/// Emits comparisons without retaining a second collection when callers only need observations.
pub(super) fn pair_records<'a>(
    events: impl IntoIterator<Item = &'a EncodedEvent>,
) -> impl Iterator<Item = PairRecord> {
    events
        .into_iter()
        .enumerate()
        .flat_map(|(event_index, event)| {
            event
                .matches
                .iter()
                .enumerate()
                .flat_map(move |(match_index, rank_match)| {
                    rank_match
                        .rows
                        .iter()
                        .enumerate()
                        .flat_map(move |(left_index, left)| {
                            rank_match
                                .rows
                                .iter()
                                .skip(left_index + 1)
                                .map(move |right| {
                                    let outcome = f64::from(left.source.rank < right.source.rank);
                                    PairRecord {
                                        match_key: MatchKey {
                                            event_index,
                                            match_index,
                                        },
                                        left_member_index: left.source.member_index,
                                        right_member_index: right.source.member_index,
                                        full: Observation {
                                            features: difference(
                                                &full_features(left),
                                                &full_features(right),
                                            ),
                                            outcome,
                                        },
                                        baseline: Observation {
                                            features: difference(
                                                &left.adjustments,
                                                &right.adjustments,
                                            ),
                                            outcome,
                                        },
                                    }
                                })
                        })
                })
        })
}

fn full_features(row: &EncodedRow) -> [f64; FULL_FEATURE_COUNT] {
    let mut features = [0.0; FULL_FEATURE_COUNT];
    for (target, value) in features
        .iter_mut()
        .zip(row.signals.iter().chain(&row.adjustments))
    {
        *target = *value;
    }
    features
}

fn difference<const N: usize>(left: &[f64; N], right: &[f64; N]) -> [f64; N] {
    let mut difference = [0.0; N];
    for ((target, left_value), right_value) in difference.iter_mut().zip(left).zip(right) {
        *target = left_value - right_value;
    }
    difference
}
