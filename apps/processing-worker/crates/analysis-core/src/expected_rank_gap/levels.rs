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
/// Candidate cuts are scanned in ascending `(a, b)` order and only a strictly larger smallest
/// level replaces the current choice, so ties keep the lowest cut points. Cut points between two
/// observed counts give the same partition as the lower observed count, so only observed counts
/// are scanned. `(0, 1)` is the first candidate and the fallback when fewer than three distinct
/// counts exist.
fn three_level_bounds(counts: impl Iterator<Item = i32>) -> [LevelBound; 3] {
    let mut histogram = BTreeMap::<i32, usize>::new();
    for count in counts {
        *histogram.entry(count).or_default() += 1;
    }
    let total = histogram.values().sum::<usize>();
    let at_most = |cut: i32| {
        histogram
            .range(..=cut)
            .map(|(_, frequency)| *frequency)
            .sum::<usize>()
    };
    let smallest = |low: i32, high: i32| {
        let low_count = at_most(low);
        let middle_count = at_most(high).saturating_sub(low_count);
        let high_count = total.saturating_sub(at_most(high));
        low_count.min(middle_count).min(high_count)
    };
    let mut best = (0, 1);
    let mut best_smallest = smallest(0, 1);
    let observed = histogram.keys().copied().collect::<Vec<_>>();
    for (position, low) in observed.iter().enumerate() {
        for high in observed.iter().skip(position + 1) {
            let candidate = smallest(*low, *high);
            if candidate > best_smallest {
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
