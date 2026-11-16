//! Expected-rank gap.
//!
//! The expected rank of one player-match result is the average saved rank of every result in the
//! selected scope with the same revenue rank and destination-count level. The remaining gap is
//! summarized per player and per incident-count level, judged against within-match permutations,
//! described by the values that moved together, and backed by evidence matches. The contract is
//! `docs/requirements/series-expected-rank-gap.md`.

use crate::{
    model::{IncidentCounts, PlayerMatchInput},
    numeric::{count_as_f64, exact_i64_as_f64},
};

mod background;
mod judgement;
mod layers;
mod levels;
mod presentation;
#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "expected-rank-gap fixture builders stop immediately on an impossible test input"
)]
mod tests;

pub(crate) use levels::CountLevels;

use background::{Background, Target};
use judgement::{Entry, Judged};
use layers::Layer;
use levels::LevelBound;

const PLAYER_COUNT: usize = 4;
const ITEM_COUNT: usize = 5;
const MAXIMUM_LEVEL_COUNT: usize = 3;
const DESTINATION_LEVEL_COUNT: usize = 3;
const MINIMUM_MATCH_COUNT: usize = 3;
const JUDGED_MATCH_COUNT: usize = 20;
const MINIMUM_CELL_COUNT: usize = 3;
const PERMUTATION_COUNT: usize = 2_000;
const TREND_BELOW: f64 = 0.05;
const HINT_BELOW: f64 = 0.10;
const EVIDENCE_LIMIT: usize = 5;
const TIE_TOLERANCE: f64 = 1e-10;

/// Incident items whose count levels explain the remaining gap, in display order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Item {
    CardShop,
    PlusStation,
    CardStation,
    MinusStation,
    Ginji,
}

impl Item {
    const ALL: [Self; ITEM_COUNT] = [
        Self::CardShop,
        Self::PlusStation,
        Self::CardStation,
        Self::MinusStation,
        Self::Ginji,
    ];

    const fn index(self) -> usize {
        match self {
            Self::CardShop => 0,
            Self::PlusStation => 1,
            Self::CardStation => 2,
            Self::MinusStation => 3,
            Self::Ginji => 4,
        }
    }

    const fn code(self) -> &'static str {
        match self {
            Self::CardShop => "card_shop",
            Self::PlusStation => "plus_station",
            Self::CardStation => "card_station",
            Self::MinusStation => "minus_station",
            Self::Ginji => "ginji",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::CardShop => "カード売り場",
            Self::PlusStation => "プラス駅",
            Self::CardStation => "カード駅",
            Self::MinusStation => "マイナス駅",
            Self::Ginji => "スリの銀次",
        }
    }

    const fn count(self, incidents: &IncidentCounts) -> i32 {
        match self {
            Self::CardShop => incidents.card_shop,
            Self::PlusStation => incidents.plus_station,
            Self::CardStation => incidents.card_station,
            Self::MinusStation => incidents.minus_station,
            Self::Ginji => incidents.suri_no_ginji,
        }
    }

    /// Minus stations and the pickpocket are zero in most results and use `0` / `1+`.
    const fn has_three_levels(self) -> bool {
        matches!(self, Self::CardShop | Self::PlusStation | Self::CardStation)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Quality {
    Ok,
    Reference,
    NoTarget,
}

impl Quality {
    const fn wire(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Reference => "reference",
            Self::NoTarget => "no_target",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Signal {
    Trend,
    Hint,
    Chance,
}

impl Signal {
    const fn wire(self) -> &'static str {
        match self {
            Self::Trend => "trend",
            Self::Hint => "hint",
            Self::Chance => "chance",
        }
    }

    const fn is_reported(self) -> bool {
        matches!(self, Self::Trend | Self::Hint)
    }
}

/// One player's result in one match, with its layer and gap once layers are assigned.
#[derive(Clone, Copy, Debug)]
struct Cell<'a> {
    row: &'a PlayerMatchInput,
    revenue_rank: u8,
    destination_level: u8,
    revenue_share: f64,
    levels: [usize; ITEM_COUNT],
    layer: usize,
    expected: f64,
    gap: f64,
}

/// The four cells of one match in canonical member order.
type Match<'a> = [Cell<'a>; PLAYER_COUNT];

#[derive(Clone, Debug, PartialEq)]
struct Summary {
    count: usize,
    share: f64,
    expected_rank: Option<f64>,
    average_rank: Option<f64>,
    mean_gap: Option<f64>,
    halves: [Option<f64>; 2],
    quality: Quality,
    judged: Option<Judged>,
}

impl Summary {
    fn consistent(&self) -> bool {
        matches!(self.halves, [Some(first), Some(second)] if first * second > 0.0)
    }

    fn reported_signal(&self) -> Option<Signal> {
        self.judged
            .map(|judged| judged.signal)
            .filter(|signal| signal.is_reported())
    }
}

#[derive(Clone, Debug, PartialEq)]
struct PlayerGap {
    member_id: String,
    summary: Summary,
}

#[derive(Clone, Debug, PartialEq)]
struct LevelGap {
    overall: Summary,
    by_player: Vec<Summary>,
}

#[derive(Clone, Debug, PartialEq)]
struct ItemGap {
    item: Item,
    bounds: Vec<LevelBound>,
    levels: Vec<LevelGap>,
    background: Option<Background>,
}

#[derive(Clone, Copy, Debug)]
struct EvidenceRow<'a> {
    match_index: usize,
    cell: Cell<'a>,
}

#[derive(Clone, Debug)]
struct PlayerEvidence<'a> {
    member_id: String,
    above_count: usize,
    below_count: usize,
    above: Vec<EvidenceRow<'a>>,
    below: Vec<EvidenceRow<'a>>,
}

#[derive(Clone, Debug)]
pub(crate) struct ExpectedRankGap<'a> {
    status: Quality,
    reason_codes: Vec<&'static str>,
    match_count: usize,
    layers: Vec<Layer>,
    players: Vec<PlayerGap>,
    items: Vec<ItemGap>,
    evidence: Vec<PlayerEvidence<'a>>,
}

/// Computes the expected-rank gap of one scope from its canonically ordered results.
pub(crate) fn analyze<'a>(
    game_title_id: &str,
    rows: &[&'a PlayerMatchInput],
    members: &[String],
    levels: &CountLevels,
) -> ExpectedRankGap<'a> {
    let match_count = rows
        .chunk_by(|left, right| left.match_id == right.match_id)
        .count();
    if match_count < MINIMUM_MATCH_COUNT {
        return empty(match_count, "insufficient_matches");
    }
    if members.len() != PLAYER_COUNT {
        return empty(match_count, "invalid_dataset");
    }
    compute(game_title_id, rows, members, levels, match_count)
        .unwrap_or_else(|| empty(match_count, "calculation_failed"))
}

fn empty<'a>(match_count: usize, reason: &'static str) -> ExpectedRankGap<'a> {
    ExpectedRankGap {
        status: Quality::NoTarget,
        reason_codes: vec![reason],
        match_count,
        layers: Vec::new(),
        players: Vec::new(),
        items: Vec::new(),
        evidence: Vec::new(),
    }
}

fn compute<'a>(
    game_title_id: &str,
    rows: &[&'a PlayerMatchInput],
    members: &[String],
    levels: &CountLevels,
    match_count: usize,
) -> Option<ExpectedRankGap<'a>> {
    let mut matches = rows
        .chunk_by(|left, right| left.match_id == right.match_id)
        .map(|group| build_match(group, members, levels))
        .collect::<Option<Vec<_>>>()?;
    let layers = layers::assign(&mut matches)?;
    let status = if match_count < JUDGED_MATCH_COUNT {
        Quality::Reference
    } else {
        Quality::Ok
    };
    let (mut players, mut items) = summaries(&matches, members, levels, status)?;

    if status == Quality::Ok {
        let match_ids = || matches.iter().map(|cells| cells[0].row.match_id.as_str());
        judge(
            judgement::seed(game_title_id, "gap", match_ids()),
            &matches,
            &mut players,
            &mut items,
        )?;
        for found in background::analyze(
            judgement::seed(game_title_id, "background", match_ids()),
            &matches,
            layers.len(),
            &background_targets(&items),
        )? {
            let index = found.item.index();
            items.get_mut(index)?.background = Some(found);
        }
    }

    let evidence = members
        .iter()
        .enumerate()
        .map(|(slot, member_id)| player_evidence(&matches, slot, member_id))
        .collect::<Option<Vec<_>>>()?;
    Some(ExpectedRankGap {
        status,
        reason_codes: if status == Quality::Reference {
            vec!["insufficient_matches"]
        } else {
            Vec::new()
        },
        match_count,
        layers,
        players,
        items,
        evidence,
    })
}

/// Player rows and item level rows of one scope, before any judgement.
fn summaries(
    matches: &[Match<'_>],
    members: &[String],
    levels: &CountLevels,
    status: Quality,
) -> Option<(Vec<PlayerGap>, Vec<ItemGap>)> {
    let half = matches.len() / 2;
    let cell_count = matches.len().checked_mul(PLAYER_COUNT)?;
    let players = members
        .iter()
        .enumerate()
        .map(|(slot, member_id)| {
            Some(PlayerGap {
                member_id: member_id.clone(),
                summary: summarize(
                    cells(matches).filter(|(_, cell_slot, _)| *cell_slot == slot),
                    matches.len(),
                    half,
                    status,
                )?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let items = Item::ALL
        .into_iter()
        .map(|item| {
            let bounds = levels.bounds(item).to_vec();
            let level_gaps = (0..bounds.len())
                .map(|level| {
                    let in_level = |(_, _, cell): &(usize, usize, &Cell<'_>)| {
                        cell.levels.get(item.index()) == Some(&level)
                    };
                    Some(LevelGap {
                        overall: summarize(
                            cells(matches).filter(in_level),
                            cell_count,
                            half,
                            status,
                        )?,
                        by_player: (0..PLAYER_COUNT)
                            .map(|slot| {
                                summarize(
                                    cells(matches)
                                        .filter(in_level)
                                        .filter(|(_, cell_slot, _)| *cell_slot == slot),
                                    matches.len(),
                                    half,
                                    status,
                                )
                            })
                            .collect::<Option<Vec<_>>>()?,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(ItemGap {
                item,
                bounds,
                levels: level_gaps,
                background: None,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some((players, items))
}

/// Items with a reported level, each with the levels that have enough results.
fn background_targets(items: &[ItemGap]) -> Vec<Target> {
    items
        .iter()
        .filter(|item| {
            item.levels
                .iter()
                .any(|level| level.overall.reported_signal().is_some())
        })
        .map(|item| Target {
            item: item.item,
            levels: item
                .levels
                .iter()
                .enumerate()
                .filter(|(_, level)| level.overall.quality == Quality::Ok)
                .map(|(index, level)| (index, level.overall.count))
                .collect(),
        })
        .collect()
}

fn build_match<'a>(
    group: &[&'a PlayerMatchInput],
    members: &[String],
    levels: &CountLevels,
) -> Option<Match<'a>> {
    if group.len() != PLAYER_COUNT {
        return None;
    }
    let total_revenue = group
        .iter()
        .map(|row| i64::from(row.revenue_man_yen))
        .sum::<i64>();
    let mut slots = [None::<Cell<'a>>; PLAYER_COUNT];
    for row in group {
        let slot = members.iter().position(|member| *member == row.member_id)?;
        let greater = group
            .iter()
            .filter(|other| other.revenue_man_yen > row.revenue_man_yen)
            .count();
        // Four results whose revenues sum to zero share the revenue equally.
        let revenue_share = if total_revenue > 0 {
            exact_i64_as_f64(i64::from(row.revenue_man_yen))? / exact_i64_as_f64(total_revenue)?
        } else {
            0.25
        };
        let [card_shop, plus, card_station, minus, ginji] =
            Item::ALL.map(|item| levels.level_of(item, item.count(&row.incidents)));
        let cell = Cell {
            row,
            revenue_rank: u8::try_from(greater + 1).ok()?,
            destination_level: u8::try_from(row.incidents.destination.clamp(0, 2)).ok()?,
            revenue_share,
            levels: [card_shop?, plus?, card_station?, minus?, ginji?],
            layer: 0,
            expected: 0.0,
            gap: 0.0,
        };
        let target = slots.get_mut(slot)?;
        if target.replace(cell).is_some() {
            return None;
        }
    }
    let [first, second, third, fourth] = slots;
    Some([first?, second?, third?, fourth?])
}

/// Every cell with its match index and member slot, in canonical order.
fn cells<'m, 'a>(
    matches: &'m [Match<'a>],
) -> impl Iterator<Item = (usize, usize, &'m Cell<'a>)> + Clone {
    matches.iter().enumerate().flat_map(|(match_index, cells)| {
        cells
            .iter()
            .enumerate()
            .map(move |(slot, cell)| (match_index, slot, cell))
    })
}

fn summarize<'m, 'a: 'm>(
    cells: impl Iterator<Item = (usize, usize, &'m Cell<'a>)>,
    denominator: usize,
    half: usize,
    scope: Quality,
) -> Option<Summary> {
    let mut count = 0_usize;
    let (mut expected, mut rank, mut gap) = (0.0_f64, 0.0_f64, 0.0_f64);
    let mut halves = [(0_usize, 0.0_f64); 2];
    for (match_index, _, cell) in cells {
        count += 1;
        expected += cell.expected;
        rank += f64::from(cell.row.rank);
        gap += cell.gap;
        let half_total = halves.get_mut(usize::from(match_index >= half))?;
        half_total.0 += 1;
        half_total.1 += cell.gap;
    }
    let mean = |total: f64, samples: usize| -> Option<Option<f64>> {
        Some((samples > 0).then_some(total / count_as_f64(samples)?))
    };
    let [first, second] = halves;
    Some(Summary {
        count,
        share: count_as_f64(count)? / count_as_f64(denominator)?,
        expected_rank: mean(expected, count)?,
        average_rank: mean(rank, count)?,
        mean_gap: mean(gap, count)?,
        halves: [mean(first.1, first.0)?, mean(second.1, second.0)?],
        quality: if count == 0 {
            Quality::NoTarget
        } else if count < MINIMUM_CELL_COUNT {
            Quality::Reference
        } else {
            scope
        },
        judged: None,
    })
}

fn judge(
    seed: u64,
    matches: &[Match<'_>],
    players: &mut [PlayerGap],
    items: &mut [ItemGap],
) -> Option<()> {
    let observed_players = players
        .iter()
        .map(|player| Some((player.summary.mean_gap?, player.summary.consistent())))
        .collect::<Option<Vec<_>>>()?;
    let mut overall = Vec::new();
    let mut by_player = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        for (level_index, level) in item.levels.iter().enumerate() {
            let entry = |slot, summary: &Summary| {
                (summary.quality == Quality::Ok)
                    .then_some(())
                    .and_then(|()| {
                        Some(Entry {
                            item: item_index,
                            level: level_index,
                            slot,
                            count: summary.count,
                            observed: summary.mean_gap?,
                            consistent: summary.consistent(),
                        })
                    })
            };
            overall.extend(entry(None, &level.overall));
            for (slot, summary) in level.by_player.iter().enumerate() {
                by_player.extend(entry(Some(slot), summary));
            }
        }
    }
    let judgements = judgement::judge_gaps(seed, matches, &observed_players, &overall, &by_player)?;
    for (player, result) in players.iter_mut().zip(judgements.players) {
        player.summary.judged = Some(result);
    }
    for (entry, result) in overall.iter().zip(judgements.overall) {
        level_summary(items, entry)?.judged = Some(result);
    }
    for (entry, result) in by_player.iter().zip(judgements.by_player) {
        level_summary(items, entry)?.judged = Some(result);
    }
    Some(())
}

fn level_summary<'i>(items: &'i mut [ItemGap], entry: &Entry) -> Option<&'i mut Summary> {
    let level = items.get_mut(entry.item)?.levels.get_mut(entry.level)?;
    match entry.slot {
        None => Some(&mut level.overall),
        Some(slot) => level.by_player.get_mut(slot),
    }
}

/// The largest gaps above and below expectation; equal gaps keep the newer match first.
fn player_evidence<'a>(
    matches: &[Match<'a>],
    slot: usize,
    member_id: &str,
) -> Option<PlayerEvidence<'a>> {
    let newest_first = matches
        .iter()
        .enumerate()
        .rev()
        .map(|(index, cells)| {
            Some(EvidenceRow {
                match_index: index + 1,
                cell: *cells.get(slot)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let mut above = newest_first
        .iter()
        .filter(|row| row.cell.gap > TIE_TOLERANCE)
        .copied()
        .collect::<Vec<_>>();
    above.sort_by(|left, right| right.cell.gap.total_cmp(&left.cell.gap));
    let mut below = newest_first
        .iter()
        .filter(|row| row.cell.gap < -TIE_TOLERANCE)
        .copied()
        .collect::<Vec<_>>();
    below.sort_by(|left, right| left.cell.gap.total_cmp(&right.cell.gap));
    let (above_count, below_count) = (above.len(), below.len());
    above.truncate(EVIDENCE_LIMIT);
    below.truncate(EVIDENCE_LIMIT);
    Some(PlayerEvidence {
        member_id: member_id.to_owned(),
        above_count,
        below_count,
        above,
        below,
    })
}
