//! Count levels shared by every scope of one game title.

use std::collections::BTreeMap;

use crate::model::PlayerMatchInput;

use super::{ITEM_COUNT, Item};

/// Inclusive count range of one level. `maximum: None` is an open upper bound.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct LevelBound {
    pub(super) minimum: i32,
    pub(super) maximum: Option<i32>,
}

impl LevelBound {
    const fn contains(self, count: i32) -> bool {
        count >= self.minimum
            && match self.maximum {
                Some(maximum) => count <= maximum,
                None => true,
            }
    }

    /// Japanese level label used by Worker-owned conclusion and background text.
    pub(super) fn label(self) -> String {
        match self.maximum {
            Some(maximum) if maximum == self.minimum => format!("{maximum}回"),
            None => format!("{}回以上", self.minimum),
            Some(maximum) if self.minimum == 0 => format!("{maximum}回以下"),
            Some(maximum) => format!("{}〜{maximum}回", self.minimum),
        }
    }
}

/// Fixed per-title count levels for the five explained incident items.
///
/// Levels are derived once from every confirmed result of the title, so a scope or a display
/// switch never redraws the boundaries. Items whose counts are mostly zero use `0` and `1+`; the
/// others use the low / middle / high split that maximizes the smallest level's share.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CountLevels {
    bounds: [Vec<LevelBound>; ITEM_COUNT],
}

impl CountLevels {
    pub(crate) fn from_rows(rows: &[PlayerMatchInput]) -> Self {
        Self {
            bounds: Item::ALL.map(|item| {
                if item.has_three_levels() {
                    three_level_bounds(rows.iter().map(|row| item.count(&row.incidents))).to_vec()
                } else {
                    vec![
                        LevelBound {
                            minimum: 0,
                            maximum: Some(0),
                        },
                        LevelBound {
                            minimum: 1,
                            maximum: None,
                        },
                    ]
                }
            }),
        }
    }

    pub(super) fn bounds(&self, item: Item) -> &[LevelBound] {
        self.bounds.get(item.index()).map_or(&[][..], Vec::as_slice)
    }

    pub(super) fn level_of(&self, item: Item, count: i32) -> Option<usize> {
        self.bounds(item)
            .iter()
            .position(|bound| bound.contains(count))
    }
}

/// Chooses the cut points `low <= a < middle <= b < high` that maximize the smallest level.
///
/// Ties keep the lowest `(a, b)` cut points. Cut points between two
/// observed counts give the same partition as the lower observed count, so only observed counts
/// are considered. Cumulative counts and midpoint searches avoid scanning every cut pair.
/// `(0, 1)` is the first candidate and the fallback when fewer than three distinct
/// counts exist.
fn three_level_bounds(counts: impl Iterator<Item = i32>) -> [LevelBound; 3] {
    let mut histogram = BTreeMap::<i32, usize>::new();
    for count in counts {
        *histogram.entry(count).or_default() += 1;
    }
    let total = histogram.values().sum::<usize>();
    let mut running_count = 0;
    let observed = histogram
        .into_iter()
        .map(|(count, frequency)| {
            running_count += frequency;
            (count, running_count)
        })
        .collect::<Vec<_>>();
    let at_most = |cut| {
        observed
            .iter()
            .take_while(|(count, _)| *count <= cut)
            .last()
            .map_or(0, |(_, cumulative)| *cumulative)
    };
    let (first, second) = (at_most(0), at_most(1));
    let mut best = (0, 1);
    let mut best_smallest = first.min(second - first).min(total - second);
    for (position, (low, low_count)) in observed.iter().enumerate() {
        let Some(upper_cuts) = observed.get(position + 1..) else {
            continue;
        };
        // For a fixed lower cut, the smaller remaining bucket grows up to the midpoint
        // and shrinks afterwards. Only its two neighbours can improve the partition.
        let remaining = total - low_count;
        let middle =
            upper_cuts.partition_point(|(_, cumulative)| cumulative - low_count < remaining / 2);
        let score = |(_, cumulative): &(i32, usize)| {
            (*low_count)
                .min(cumulative - low_count)
                .min(total - cumulative)
        };
        let candidate = upper_cuts
            .get(middle)
            .into_iter()
            .chain(
                middle
                    .checked_sub(1)
                    .and_then(|index| upper_cuts.get(index)),
            )
            .map(score)
            .max()
            .unwrap_or_default();
        if candidate > best_smallest {
            // A small lower bucket can flatten the optimum: retain the first upper cut
            // reaching it, rather than the midpoint, to preserve the lowest-cut tie rule.
            let first_best =
                upper_cuts.partition_point(|(_, cumulative)| cumulative - low_count < candidate);
            if let Some((high, _)) = upper_cuts.get(first_best) {
                best = (*low, *high);
                best_smallest = candidate;
            }
        }
    }
    let (low, high) = best;
    [
        LevelBound {
            minimum: 0,
            maximum: Some(low),
        },
        LevelBound {
            minimum: low + 1,
            maximum: Some(high),
        },
        LevelBound {
            minimum: high + 1,
            maximum: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(counts: &[i32]) -> Vec<(i32, Option<i32>)> {
        three_level_bounds(counts.iter().copied())
            .iter()
            .map(|bound| (bound.minimum, bound.maximum))
            .collect()
    }

    #[test]
    fn three_levels_maximize_the_smallest_level_and_keep_the_lowest_tie() {
        // 0回 4件、1回 3件、2回 3件: (0, 1) leaves 4 / 3 / 3.
        assert_eq!(
            bounds(&[0, 0, 0, 0, 1, 1, 1, 2, 2, 2]),
            vec![(0, Some(0)), (1, Some(1)), (2, None)]
        );
        // Cut points between observed counts collapse onto the observed count.
        assert_eq!(
            bounds(&[0, 2, 2, 5, 5, 5, 8, 8, 9, 9]),
            vec![(0, Some(2)), (3, Some(5)), (6, None)]
        );
    }

    #[test]
    fn balanced_levels_match_exhaustive_count_partitioning() {
        // Every histogram over these five counts with frequencies 0, 1 or 2. The oracle
        // scans integer cut points, including unobserved counts and flat optimum ranges.
        for encoded in 0..3_usize.pow(5) {
            let mut frequencies = encoded;
            let mut counts = Vec::new();
            for count in [0, 2, 3, 7, 9] {
                counts.extend(std::iter::repeat_n(count, frequencies % 3));
                frequencies /= 3;
            }
            let mut expected = (0, 1);
            let mut best_size = 0;
            for low in 0..9 {
                for high in low + 1..=9 {
                    let mut sizes = [0_usize; 3];
                    for count in &counts {
                        let index = usize::from(*count > low) + usize::from(*count > high);
                        if let Some(size) = sizes.get_mut(index) {
                            *size += 1;
                        }
                    }
                    let smallest = sizes.into_iter().min().unwrap_or_default();
                    if smallest > best_size {
                        expected = (low, high);
                        best_size = smallest;
                    }
                }
            }
            let [low, middle, _] = three_level_bounds(counts.iter().copied());
            assert_eq!(
                (low.maximum, middle.maximum),
                (Some(expected.0), Some(expected.1)),
                "histogram {counts:?} retains the largest smallest bucket and earliest ties"
            );
        }
    }

    #[test]
    fn sparse_counts_fall_back_to_the_first_cut() {
        assert_eq!(bounds(&[]), vec![(0, Some(0)), (1, Some(1)), (2, None)]);
        assert_eq!(bounds(&[0, 0]), vec![(0, Some(0)), (1, Some(1)), (2, None)]);
    }

    #[test]
    fn labels_name_each_inclusive_range() {
        let label = |minimum, maximum| LevelBound { minimum, maximum }.label();
        assert_eq!(label(0, Some(0)), "0回");
        assert_eq!(label(1, None), "1回以上");
        assert_eq!(label(0, Some(3)), "3回以下");
        assert_eq!(label(4, Some(5)), "4〜5回");
    }
}
