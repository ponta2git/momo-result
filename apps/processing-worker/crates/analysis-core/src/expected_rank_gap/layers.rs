//! Expected-rank layers: revenue rank × destination level, with deterministic merging.

use crate::numeric::{count_as_f64, exact_i64_as_f64};

use super::{DESTINATION_LEVEL_COUNT, MINIMUM_CELL_COUNT, Match, PLAYER_COUNT};

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Layer {
    pub(super) revenue_rank: u8,
    /// Ascending destination levels (`0`, `1`, `2` = two or more) merged into this layer.
    pub(super) destination_levels: Vec<u8>,
    pub(super) count: usize,
    pub(super) expected_rank: f64,
}

impl Layer {
    pub(super) const fn merged(&self) -> bool {
        self.destination_levels.len() > 1
    }
}

#[derive(Clone, Copy, Default)]
struct CellTotal {
    count: usize,
    rank_sum: i64,
}

/// Assigns every cell to exactly one layer and stores its expected rank and gap.
///
/// Within one revenue rank, a layer with fewer than [`MINIMUM_CELL_COUNT`] results is merged
/// with its neighbouring present destination level, scanning from the most destinations down and
/// preferring the lower neighbour. A revenue rank that still has too few results becomes one
/// layer. Gaps of one layer therefore sum to zero up to floating-point rounding.
pub(super) fn assign(matches: &mut [Match<'_>]) -> Option<Vec<Layer>> {
    let mut totals = [[CellTotal::default(); DESTINATION_LEVEL_COUNT]; PLAYER_COUNT];
    for cells in matches.iter() {
        for cell in cells {
            let total = totals
                .get_mut(usize::from(cell.revenue_rank.checked_sub(1)?))?
                .get_mut(usize::from(cell.destination_level))?;
            total.count += 1;
            total.rank_sum += i64::from(cell.row.rank);
        }
    }

    let mut layers = Vec::new();
    let mut layer_of = [[None::<usize>; DESTINATION_LEVEL_COUNT]; PLAYER_COUNT];
    for (revenue_index, (row_totals, row_layers)) in
        totals.iter().zip(layer_of.iter_mut()).enumerate()
    {
        let revenue_rank = u8::try_from(revenue_index + 1).ok()?;
        for group in merged_groups(row_totals)? {
            let (count, rank_sum) = group.iter().try_fold((0_usize, 0_i64), |acc, level| {
                let total = row_totals.get(usize::from(*level))?;
                Some((acc.0 + total.count, acc.1 + total.rank_sum))
            })?;
            let expected_rank = exact_i64_as_f64(rank_sum)? / count_as_f64(count)?;
            for level in &group {
                *row_layers.get_mut(usize::from(*level))? = Some(layers.len());
            }
            layers.push(Layer {
                revenue_rank,
                destination_levels: group,
                count,
                expected_rank,
            });
        }
    }

    for cells in matches.iter_mut() {
        for cell in cells {
            let layer = (*layer_of
                .get(usize::from(cell.revenue_rank.checked_sub(1)?))?
                .get(usize::from(cell.destination_level))?)?;
            cell.layer = layer;
            cell.expected = layers.get(layer)?.expected_rank;
            cell.gap = cell.expected - f64::from(cell.row.rank);
        }
    }
    Some(layers)
}

fn merged_groups(totals: &[CellTotal; DESTINATION_LEVEL_COUNT]) -> Option<Vec<Vec<u8>>> {
    let mut groups = totals
        .iter()
        .enumerate()
        .filter(|(_, total)| total.count > 0)
        .map(|(level, _)| u8::try_from(level).ok().map(|level| vec![level]))
        .collect::<Option<Vec<_>>>()?;
    let size = |group: &[u8]| {
        group
            .iter()
            .filter_map(|level| totals.get(usize::from(*level)))
            .map(|total| total.count)
            .sum::<usize>()
    };
    while groups.len() > 1 {
        let Some(small) = groups
            .iter()
            .rposition(|group| size(group) < MINIMUM_CELL_COUNT)
        else {
            break;
        };
        let lower = small.saturating_sub(1);
        let upper = if small == 0 { 1 } else { small };
        let absorbed = groups.remove(upper);
        groups.get_mut(lower)?.extend(absorbed);
    }
    Some(groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn totals(counts: [usize; DESTINATION_LEVEL_COUNT]) -> [CellTotal; DESTINATION_LEVEL_COUNT] {
        counts.map(|count| CellTotal { count, rank_sum: 0 })
    }

    #[test]
    fn small_layers_merge_into_the_lower_neighbour_from_the_top() {
        assert_eq!(
            merged_groups(&totals([5, 4, 3])),
            Some(vec![vec![0], vec![1], vec![2]])
        );
        assert_eq!(
            merged_groups(&totals([5, 4, 2])),
            Some(vec![vec![0], vec![1, 2]])
        );
        // The lowest level has no lower neighbour and absorbs the level above it.
        assert_eq!(
            merged_groups(&totals([1, 4, 4])),
            Some(vec![vec![0, 1], vec![2]])
        );
        // An absent level does not separate its present neighbours.
        assert_eq!(merged_groups(&totals([5, 0, 1])), Some(vec![vec![0, 2]]));
        // A revenue rank that remains too small becomes one layer.
        assert_eq!(merged_groups(&totals([1, 1, 0])), Some(vec![vec![0, 1]]));
        assert_eq!(merged_groups(&totals([0, 0, 0])), Some(vec![]));
    }
}
