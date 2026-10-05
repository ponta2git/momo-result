//! Finite saved facts for rank outlook. All ordering is inherited from normalized match input.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    contract::ScopeRef,
    model::{
        NormalizedAnalysisInput, PlayerMatchInput, ordered_member_ids, player_matches_by_member,
    },
    stats::{quality_status, rate},
};

pub(crate) const MAX_WINDOW: usize = 1_000;
pub(crate) const EXAMPLE_SIZE: usize = 20;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Period {
    pub start_match_id: String,
    pub end_match_id: String,
    pub started_at: String,
    pub ended_at: String,
    pub start_sequence: usize,
    pub end_sequence: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Window {
    #[serde(rename = "windowSize")]
    pub size: usize,
    pub rank_sum: usize,
    pub average_rank: f64,
    pub period: Period,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Source {
    pub game_title_id: String,
    pub title_match_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Scope {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season_master_id: Option<String>,
    pub match_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Player {
    pub member_id: String,
    pub rank_sum: usize,
    pub average_rank: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RecentPlayer {
    pub member_id: String,
    pub rank_counts: [usize; 4],
    pub rank_sum: usize,
    pub average_rank: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Joint {
    pub member_a_id: String,
    pub member_b_id: String,
    pub rank_counts: [[usize; 4]; 4],
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Recent {
    pub match_count: usize,
    pub quality_status: String,
    pub period: Option<Period>,
    pub players: Vec<RecentPlayer>,
    pub joint_ranks: Vec<Joint>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct BestPreview {
    pub member_id: String,
    pub window_size: usize,
    pub status: String,
    pub window: Option<Window>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Summary {
    pub schema_version: u32,
    pub scope: Scope,
    pub source: Source,
    pub quality_status: String,
    pub period: Option<Period>,
    pub players: Vec<Player>,
    pub recent: Recent,
    pub best_windows: Vec<BestPreview>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Example {
    pub rank_counts: [usize; 4],
    pub window: Window,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Examples {
    pub status: String,
    pub types: Vec<Example>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Reference {
    pub schema_version: u32,
    pub scope: Scope,
    pub source: Source,
    pub member_id: String,
    pub recent_rank_counts: [usize; 4],
    pub best_windows: Vec<Window>,
    pub examples: Examples,
}

/// Title-wide reference facts are computed once, independent of the number of seasons.
pub(crate) struct TitleFacts {
    source: Source,
    sequences: BTreeMap<String, usize>,
    recent: Recent,
    previews: Vec<BestPreview>,
    references: Vec<Reference>,
}

impl TitleFacts {
    pub(crate) fn new(input: &NormalizedAnalysisInput) -> Self {
        let rows = input.player_matches().iter().collect::<Vec<_>>();
        let mut member_ids = ordered_member_ids(&rows);
        member_ids.sort();
        let by_member = player_matches_by_member(&rows, &member_ids);
        let match_count = rows.len() / 4;
        let source = Source {
            game_title_id: input.game_title_id().into(),
            title_match_count: match_count,
        };
        let sequences = rows
            .as_chunks::<4>()
            .0
            .iter()
            .enumerate()
            .filter_map(|(index, group)| group.first().map(|row| (row.match_id.clone(), index + 1)))
            .collect();
        let recent_count = match_count.min(EXAMPLE_SIZE);
        let mut references = Vec::with_capacity(member_ids.len());
        let mut recent_players = Vec::with_capacity(member_ids.len());
        let mut previews = Vec::with_capacity(member_ids.len() * 2);
        for (member_id, member_rows) in &by_member {
            let recent_rows = member_rows
                .get(match_count.saturating_sub(EXAMPLE_SIZE)..)
                .unwrap_or_default();
            let counts = rank_counts(recent_rows);
            let sum = rank_sum(&counts);
            recent_players.push(RecentPlayer {
                member_id: member_id.clone(),
                rank_counts: counts,
                rank_sum: sum,
                average_rank: average(sum, recent_count),
            });
            let best_windows = best_windows(member_rows);
            for h in [50, 100] {
                let window = best_windows.get(h - 1).cloned();
                previews.push(BestPreview {
                    member_id: member_id.clone(),
                    window_size: h,
                    status: availability(window.is_some()).into(),
                    window,
                });
            }
            references.push(Reference {
                schema_version: 1,
                scope: Scope {
                    kind: "overall".into(),
                    season_master_id: None,
                    match_count,
                },
                source: source.clone(),
                member_id: member_id.clone(),
                recent_rank_counts: counts,
                best_windows,
                examples: examples(member_rows, &counts),
            });
        }
        let joints = recent_joints(&member_ids, &rows, recent_count);
        let period = by_member.values().next().and_then(|member_rows| {
            period(
                member_rows,
                match_count.saturating_sub(EXAMPLE_SIZE),
                match_count,
            )
        });
        Self {
            source,
            sequences,
            recent: Recent {
                match_count: recent_count,
                quality_status: quality_status(recent_count).into(),
                period,
                players: recent_players,
                joint_ranks: joints,
            },
            previews,
            references,
        }
    }

    pub(crate) fn references(&self) -> &[Reference] {
        &self.references
    }

    pub(crate) fn summary(&self, scope: &ScopeRef, rows: &[&PlayerMatchInput]) -> Summary {
        let member_ids = ordered_member_ids(rows);
        let by_member = player_matches_by_member(rows, &member_ids);
        let match_count = rows.len() / 4;
        let players = by_member
            .iter()
            .map(|(member_id, member_rows)| {
                let sum = rank_sum(&rank_counts(member_rows));
                Player {
                    member_id: member_id.clone(),
                    rank_sum: sum,
                    average_rank: average(sum, member_rows.len()),
                }
            })
            .collect();
        let period = rows.first().zip(rows.last()).and_then(|(first, last)| {
            Some(Period {
                start_match_id: first.match_id.clone(),
                end_match_id: last.match_id.clone(),
                started_at: first.played_at.clone(),
                ended_at: last.played_at.clone(),
                start_sequence: *self.sequences.get(&first.match_id)?,
                end_sequence: *self.sequences.get(&last.match_id)?,
            })
        });
        let season_master_id = if let ScopeRef::Season { season_master_id } = scope {
            Some(season_master_id.clone())
        } else {
            None
        };
        Summary {
            schema_version: 1,
            scope: Scope {
                kind: if season_master_id.is_some() {
                    "season"
                } else {
                    "overall"
                }
                .into(),
                season_master_id,
                match_count,
            },
            source: self.source.clone(),
            quality_status: quality_status(match_count).into(),
            period,
            players,
            recent: self.recent.clone(),
            best_windows: self.previews.clone(),
        }
    }
}

pub(crate) fn average(sum: usize, count: usize) -> f64 {
    rate(sum, count).unwrap_or(0.0)
}
pub(crate) const fn availability(available: bool) -> &'static str {
    if available {
        "available"
    } else {
        "insufficient"
    }
}
pub(crate) fn rank_sum(counts: &[usize; 4]) -> usize {
    counts
        .iter()
        .enumerate()
        .map(|(offset, count)| (offset + 1) * count)
        .sum()
}
fn rank_index(rank: i32) -> usize {
    usize::try_from(rank.saturating_sub(1)).unwrap_or_default()
}

fn rank_counts(rows: &[&PlayerMatchInput]) -> [usize; 4] {
    let mut counts = [0; 4];
    for row in rows {
        if let Some(count) = counts.get_mut(rank_index(row.rank)) {
            *count += 1;
        }
    }
    counts
}

fn period(rows: &[&PlayerMatchInput], start: usize, end: usize) -> Option<Period> {
    let first = rows.get(start)?;
    let last = rows.get(end.checked_sub(1)?)?;
    Some(Period {
        start_match_id: first.match_id.clone(),
        end_match_id: last.match_id.clone(),
        started_at: first.played_at.clone(),
        ended_at: last.played_at.clone(),
        start_sequence: start + 1,
        end_sequence: end,
    })
}

fn best_windows(rows: &[&PlayerMatchInput]) -> Vec<Window> {
    let mut prefix = Vec::with_capacity(rows.len() + 1);
    prefix.push(0_usize);
    let mut cumulative_sum = 0;
    for row in rows {
        cumulative_sum += rank_index(row.rank) + 1;
        prefix.push(cumulative_sum);
    }
    (1..=rows.len().min(MAX_WINDOW))
        .filter_map(|h| {
            let (start, sum) = prefix
                .iter()
                .zip(prefix.iter().skip(h))
                .enumerate()
                .map(|(start, (left, right))| (start, right - left))
                .min_by(|(a_start, a_sum), (b_start, b_sum)| {
                    a_sum.cmp(b_sum).then_with(|| b_start.cmp(a_start))
                })?;
            Some(Window {
                size: h,
                rank_sum: sum,
                average_rank: average(sum, h),
                period: period(rows, start, start + h)?,
            })
        })
        .collect()
}

pub(crate) fn example_distance(counts: &[usize; 4], recent: &[usize; 4]) -> usize {
    counts.iter().zip(recent).map(|(a, b)| a.abs_diff(*b)).sum()
}

fn examples(rows: &[&PlayerMatchInput], recent: &[usize; 4]) -> Examples {
    let mut by_counts = BTreeMap::new();
    let mut counts = [0; 4];
    for (offset, row) in rows.iter().enumerate() {
        if let Some(count) = counts.get_mut(rank_index(row.rank)) {
            *count += 1;
        }
        if let Some(prior) = offset
            .checked_sub(EXAMPLE_SIZE)
            .and_then(|index| rows.get(index))
            && let Some(count) = counts.get_mut(rank_index(prior.rank))
        {
            *count -= 1;
        }
        if offset + 1 >= EXAMPLE_SIZE {
            by_counts.insert(counts, offset + 1);
        }
    }
    let mut types = by_counts
        .into_iter()
        .filter_map(|(rank_counts, end)| {
            let sum = rank_sum(&rank_counts);
            Some(Example {
                rank_counts,
                window: Window {
                    size: EXAMPLE_SIZE,
                    rank_sum: sum,
                    average_rank: average(sum, EXAMPLE_SIZE),
                    period: period(rows, end - EXAMPLE_SIZE, end)?,
                },
            })
        })
        .collect::<Vec<_>>();
    types.sort_by(|a, b| {
        example_distance(&a.rank_counts, recent)
            .cmp(&example_distance(&b.rank_counts, recent))
            .then_with(|| {
                b.window
                    .period
                    .end_sequence
                    .cmp(&a.window.period.end_sequence)
            })
            .then_with(|| a.rank_counts.cmp(&b.rank_counts))
    });
    Examples {
        status: availability(rows.len() >= EXAMPLE_SIZE).into(),
        types,
    }
}

#[cfg(test)]
mod tests;

fn recent_joints(
    member_ids: &[String],
    rows: &[&PlayerMatchInput],
    recent_count: usize,
) -> Vec<Joint> {
    let mut joints = Vec::with_capacity(6);
    let recent_rows = rows
        .get(rows.len().saturating_sub(recent_count * 4)..)
        .unwrap_or_default();
    for (a_offset, a) in member_ids.iter().enumerate() {
        for b in member_ids.iter().skip(a_offset + 1) {
            let mut counts = [[0; 4]; 4];
            for group in recent_rows.as_chunks::<4>().0 {
                let a_rank = group
                    .iter()
                    .find(|row| row.member_id == *a)
                    .map(|row| rank_index(row.rank));
                let b_rank = group
                    .iter()
                    .find(|row| row.member_id == *b)
                    .map(|row| rank_index(row.rank));
                if let Some(count) = a_rank
                    .and_then(|a_rank| counts.get_mut(a_rank))
                    .and_then(|row| b_rank.and_then(|b_rank| row.get_mut(b_rank)))
                {
                    *count += 1;
                }
            }
            joints.push(Joint {
                member_a_id: a.clone(),
                member_b_id: b.clone(),
                rank_counts: counts,
            });
        }
    }
    joints
}
