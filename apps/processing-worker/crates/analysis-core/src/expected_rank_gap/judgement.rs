//! Chance judgement from within-match permutations of the four players' results.
//!
//! Each permutation shuffles the four cells of every match independently while every mask (a
//! player, an item level) stays on its original position. A statistic is "unlikely by chance"
//! when the permuted scopes rarely reach its absolute value. Families of comparisons are
//! corrected together: players by the largest of the four permuted means, item levels by the
//! smallest single-entry tail frequency of every entry in the family.

use sha2::{Digest, Sha256};

use crate::{numeric::count_as_f64, stats::percentile_f64};

use super::{
    HINT_BELOW, ITEM_COUNT, MAXIMUM_LEVEL_COUNT, Match, PERMUTATION_COUNT, PLAYER_COUNT, Signal,
    TIE_TOLERANCE, TREND_BELOW,
};

/// Signal and the absolute size that a chance gap of this row reaches at the hint frequency.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Judged {
    pub(super) signal: Signal,
    pub(super) band: f64,
}

/// One judged level row. `slot: None` is the whole table; otherwise one player's slot.
#[derive(Clone, Copy, Debug)]
pub(super) struct Entry {
    pub(super) item: usize,
    pub(super) level: usize,
    pub(super) slot: Option<usize>,
    pub(super) count: usize,
    pub(super) observed: f64,
    pub(super) consistent: bool,
}

pub(super) struct GapJudgements {
    pub(super) players: Vec<Judged>,
    pub(super) overall: Vec<Judged>,
    pub(super) by_player: Vec<Judged>,
}

/// Deterministic seed from the title and the ordered identities of the analysed matches.
///
/// Two scopes with exactly the same matches therefore receive the same judgement, independent
/// of which scope computed it first.
pub(super) fn seed<'a>(
    game_title_id: &str,
    purpose: &str,
    match_ids: impl Iterator<Item = &'a str>,
) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(b"series-expected-rank-gap\x1f");
    hasher.update(game_title_id.as_bytes());
    hasher.update(b"\x1f");
    hasher.update(purpose.as_bytes());
    for match_id in match_ids {
        hasher.update(b"\x1f");
        hasher.update(match_id.as_bytes());
    }
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    for (target, source) in bytes.iter_mut().zip(digest.iter()) {
        *target = *source;
    }
    u64::from_be_bytes(bytes)
}

/// `SplitMix64` stream; stateless enough to make the permutation order part of the contract.
pub(super) struct Permutations(u64);

impl Permutations {
    pub(super) const fn new(seed: u64) -> Self {
        Self(seed)
    }

    const fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut mixed = self.0;
        mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        mixed ^ (mixed >> 31)
    }

    /// Uniform index below `bound` by the multiply-high reduction (bias below 2^-61 here).
    fn below(&mut self, bound: usize) -> Option<usize> {
        let bound = u64::try_from(bound).ok()?;
        let reduced = (u128::from(self.next()) * u128::from(bound)) >> 64;
        usize::try_from(reduced).ok()
    }

    /// Fisher–Yates order: position `j` receives the value originally at `order[j]`.
    pub(super) fn shuffle(&mut self) -> Option<[usize; PLAYER_COUNT]> {
        let mut order = [0, 1, 2, 3];
        for position in (1..PLAYER_COUNT).rev() {
            let other = self.below(position + 1)?;
            order.swap(position, other);
        }
        Some(order)
    }
}

pub(super) fn judge_gaps(
    seed: u64,
    matches: &[Match<'_>],
    players: &[(f64, bool)],
    overall: &[Entry],
    by_player: &[Entry],
) -> Option<GapJudgements> {
    let match_count = count_as_f64(matches.len())?;
    let mut random = Permutations::new(seed);
    let mut player_null = Vec::with_capacity(PERMUTATION_COUNT);
    let mut overall_null = vec![Vec::with_capacity(PERMUTATION_COUNT); overall.len()];
    let mut by_player_null = vec![Vec::with_capacity(PERMUTATION_COUNT); by_player.len()];
    for _ in 0..PERMUTATION_COUNT {
        let mut player_sums = [0.0_f64; PLAYER_COUNT];
        let mut overall_sums = [[0.0_f64; MAXIMUM_LEVEL_COUNT]; ITEM_COUNT];
        let mut by_player_sums = [[[0.0_f64; MAXIMUM_LEVEL_COUNT]; ITEM_COUNT]; PLAYER_COUNT];
        for cells in matches {
            let order = random.shuffle()?;
            for (((cell, source), player_sum), slot_sums) in cells
                .iter()
                .zip(order)
                .zip(player_sums.iter_mut())
                .zip(by_player_sums.iter_mut())
            {
                let value = cells.get(source)?.gap;
                *player_sum += value;
                for ((level, item_sums), slot_item_sums) in cell
                    .levels
                    .iter()
                    .zip(overall_sums.iter_mut())
                    .zip(slot_sums.iter_mut())
                {
                    *item_sums.get_mut(*level)? += value;
                    *slot_item_sums.get_mut(*level)? += value;
                }
            }
        }
        player_null.push(
            player_sums
                .iter()
                .map(|sum| (sum / match_count).abs())
                .fold(0.0, f64::max),
        );
        for (entry, null) in overall.iter().zip(overall_null.iter_mut()) {
            null.push(entry_mean(&overall_sums, entry)?.abs());
        }
        for (entry, null) in by_player.iter().zip(by_player_null.iter_mut()) {
            let slot_sums = by_player_sums.get(entry.slot?)?;
            null.push(entry_mean(slot_sums, entry)?.abs());
        }
    }
    Some(GapJudgements {
        players: judge_by_maximum(players, &player_null)?,
        overall: judge_family(overall, &overall_null)?,
        by_player: judge_family(by_player, &by_player_null)?,
    })
}

fn entry_mean(sums: &[[f64; MAXIMUM_LEVEL_COUNT]; ITEM_COUNT], entry: &Entry) -> Option<f64> {
    Some(sums.get(entry.item)?.get(entry.level)? / count_as_f64(entry.count)?)
}

/// Players share one family: the permuted statistic is the largest absolute player mean.
fn judge_by_maximum(players: &[(f64, bool)], null_maximum: &[f64]) -> Option<Vec<Judged>> {
    let mut sorted = null_maximum.to_vec();
    sorted.sort_by(f64::total_cmp);
    let band = percentile_f64(null_maximum, 1.0 - HINT_BELOW)?;
    players
        .iter()
        .map(|(observed, consistent)| {
            let frequency = fraction(tail_count(&sorted, observed.abs()))?;
            Some(Judged {
                signal: classify(frequency, *consistent),
                band,
            })
        })
        .collect()
}

fn judge_family(entries: &[Entry], nulls: &[Vec<f64>]) -> Option<Vec<Judged>> {
    let observed = entries
        .iter()
        .map(|entry| entry.observed)
        .collect::<Vec<_>>();
    let corrected = corrected_frequencies(&observed, nulls)?;
    entries
        .iter()
        .zip(nulls)
        .zip(corrected.frequencies)
        .map(|((entry, null), frequency)| {
            Some(Judged {
                signal: classify(frequency, entry.consistent),
                band: percentile_f64(null, 1.0 - corrected.hint_level)?,
            })
        })
        .collect()
}

pub(super) struct CorrectedFrequencies {
    pub(super) frequencies: Vec<f64>,
    /// Single-entry tail frequency that the family minimum stays below at the hint level.
    hint_level: f64,
}

/// Min-p correction: the frequency with which the smallest single-entry tail frequency of the
/// whole family is at most this entry's own tail frequency.
pub(super) fn corrected_frequencies(
    observed: &[f64],
    nulls: &[Vec<f64>],
) -> Option<CorrectedFrequencies> {
    if observed.is_empty() {
        return Some(CorrectedFrequencies {
            frequencies: Vec::new(),
            hint_level: 0.0,
        });
    }
    let sorted = nulls
        .iter()
        .map(|null| {
            let mut sorted = null.clone();
            sorted.sort_by(f64::total_cmp);
            sorted
        })
        .collect::<Vec<_>>();
    let mut family_minimum = vec![usize::MAX; PERMUTATION_COUNT];
    for (null, sorted_null) in nulls.iter().zip(&sorted) {
        for (minimum, value) in family_minimum.iter_mut().zip(null) {
            *minimum = (*minimum).min(tail_count(sorted_null, *value));
        }
    }
    let minimum_fractions = family_minimum
        .iter()
        .map(|count| fraction(*count))
        .collect::<Option<Vec<_>>>()?;
    let hint_level = percentile_f64(&minimum_fractions, HINT_BELOW)?;
    let frequencies = observed
        .iter()
        .zip(&sorted)
        .map(|(value, sorted_null)| {
            let threshold = tail_count(sorted_null, value.abs()).max(1);
            fraction(
                family_minimum
                    .iter()
                    .filter(|minimum| **minimum <= threshold)
                    .count(),
            )
        })
        .collect::<Option<Vec<_>>>()?;
    Some(CorrectedFrequencies {
        frequencies,
        hint_level,
    })
}

/// Number of permuted values at least `value`, treating floating-point ties as reached.
fn tail_count(sorted: &[f64], value: f64) -> usize {
    sorted.len() - sorted.partition_point(|candidate| *candidate < value - TIE_TOLERANCE)
}

fn fraction(count: usize) -> Option<f64> {
    Some(count_as_f64(count)? / count_as_f64(PERMUTATION_COUNT)?)
}

fn classify(frequency: f64, consistent: bool) -> Signal {
    if frequency < TREND_BELOW && consistent {
        Signal::Trend
    } else if frequency < HINT_BELOW {
        Signal::Hint
    } else {
        Signal::Chance
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shuffles_are_deterministic_permutations() {
        let mut first = Permutations::new(7);
        let mut second = Permutations::new(7);
        for _ in 0..100 {
            let order = first.shuffle();
            assert_eq!(
                order,
                second.shuffle(),
                "the same seed yields the same order"
            );
            let mut sorted = order.unwrap_or_default();
            sorted.sort_unstable();
            assert_eq!(sorted, [0, 1, 2, 3], "every order is a permutation");
        }
    }

    #[test]
    fn seed_depends_on_title_purpose_and_match_order() {
        let base = seed("title", "gap", ["a", "b"].into_iter());
        assert_eq!(base, seed("title", "gap", ["a", "b"].into_iter()));
        assert_ne!(base, seed("other", "gap", ["a", "b"].into_iter()));
        assert_ne!(base, seed("title", "background", ["a", "b"].into_iter()));
        assert_ne!(base, seed("title", "gap", ["b", "a"].into_iter()));
    }

    #[test]
    fn tail_count_treats_rounding_ties_as_reached() {
        let sorted = [0.1, 0.2, 0.3 - 1e-15, 0.4];
        assert_eq!(tail_count(&sorted, 0.3), 2);
        assert_eq!(tail_count(&sorted, 0.0), 4);
        assert_eq!(tail_count(&sorted, 0.5), 0);
    }

    #[test]
    fn trend_requires_both_a_rare_size_and_the_same_direction_in_both_halves() {
        assert_eq!(classify(0.04, true), Signal::Trend);
        assert_eq!(classify(0.04, false), Signal::Hint);
        assert_eq!(classify(0.09, true), Signal::Hint);
        assert_eq!(classify(0.10, true), Signal::Chance);
    }

    #[test]
    fn a_larger_family_needs_a_rarer_single_entry() {
        // Entry 0 is reached by 3 of 2,000 permuted values in both families. Alone it stays rare;
        // among ten unrelated entries the smallest of ten tail frequencies reaches it more often.
        let null = (0..PERMUTATION_COUNT)
            .map(|index| count_as_f64(index).unwrap_or_default() / 2_000.0)
            .collect::<Vec<_>>();
        let observed = 0.9985;
        let alone = corrected_frequencies(&[observed], std::slice::from_ref(&null))
            .map(|corrected| corrected.frequencies);
        let mut shifted = Vec::new();
        for offset in 0..10 {
            shifted.push(
                null.iter()
                    .cycle()
                    .skip(offset * 137)
                    .take(PERMUTATION_COUNT)
                    .copied()
                    .collect::<Vec<_>>(),
            );
        }
        let family = corrected_frequencies(&[observed; 10], &shifted)
            .and_then(|corrected| corrected.frequencies.first().copied());
        let alone = alone.and_then(|frequencies| frequencies.first().copied());
        assert!(alone < Some(0.01), "a single comparison keeps its own tail");
        assert!(
            family > alone,
            "the family correction is stricter than a single comparison"
        );
    }
}
