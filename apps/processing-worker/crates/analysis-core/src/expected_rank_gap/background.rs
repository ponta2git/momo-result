//! Background of a judged item: what else differed in the results of each count level.
//!
//! Every value is compared within the same expected-rank layer, so the part explained by revenue
//! rank and destination count is removed before the level comparison. The values describe what
//! happened together and never a cause.

use crate::{
    numeric::count_as_f64,
    stats::{average, median_f64},
};

use super::{
    ITEM_COUNT, Item, Match, PERMUTATION_COUNT, PLAYER_COUNT, TREND_BELOW,
    judgement::{Permutations, corrected_frequencies},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Variable {
    RevenueShare,
    TotalAssets,
    Count(Item),
}

impl Variable {
    pub(super) const fn code(self) -> &'static str {
        match self {
            Self::RevenueShare => "revenue_share",
            Self::TotalAssets => "total_assets",
            Self::Count(item) => item.code(),
        }
    }

    const fn uses_median(self) -> bool {
        matches!(self, Self::TotalAssets)
    }

    /// Total assets are close to the saved rank itself and are shown without a judgement.
    pub(super) const fn can_be_marked(self) -> bool {
        !matches!(self, Self::TotalAssets)
    }

    fn value(self, cell: &super::Cell<'_>) -> f64 {
        match self {
            Self::RevenueShare => cell.revenue_share,
            Self::TotalAssets => f64::from(cell.row.total_assets_man_yen),
            Self::Count(item) => f64::from(item.count(&cell.row.incidents)),
        }
    }

    fn for_item(item: Item) -> Vec<Self> {
        [Self::RevenueShare, Self::TotalAssets]
            .into_iter()
            .chain(
                Item::ALL
                    .into_iter()
                    .filter(|other| *other != item)
                    .map(Self::Count),
            )
            .collect()
    }

    const ALL: [Self; 2 + ITEM_COUNT] = [
        Self::RevenueShare,
        Self::TotalAssets,
        Self::Count(Item::CardShop),
        Self::Count(Item::PlusStation),
        Self::Count(Item::CardStation),
        Self::Count(Item::MinusStation),
        Self::Count(Item::Ginji),
    ];

    fn index(self) -> Option<usize> {
        Self::ALL.iter().position(|variable| *variable == self)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Value {
    pub(super) value: f64,
    pub(super) marked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Row {
    pub(super) level: usize,
    pub(super) values: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Background {
    pub(super) item: Item,
    pub(super) variables: Vec<Variable>,
    pub(super) rows: Vec<Row>,
}

/// One background target: an item with a judged level and the levels with enough results.
pub(super) struct Target {
    pub(super) item: Item,
    pub(super) levels: Vec<(usize, usize)>,
}

struct Cell {
    target: usize,
    level: usize,
    count: usize,
    variable: Variable,
}

/// Computes the background of every target and marks values unlikely by chance.
///
/// All values of all targets form one correction family. A single joint permutation per match
/// moves every variable of a result together, keeping the relations between the variables.
pub(super) fn analyze(
    seed: u64,
    matches: &[Match<'_>],
    layer_count: usize,
    targets: &[Target],
) -> Option<Vec<Background>> {
    if targets.is_empty() {
        return Some(Vec::new());
    }
    let adjusted = adjusted_values(matches, layer_count)?;
    let cells = targets
        .iter()
        .enumerate()
        .flat_map(|(target_index, target)| {
            target.levels.iter().flat_map(move |(level, count)| {
                Variable::for_item(target.item)
                    .into_iter()
                    .map(move |variable| Cell {
                        target: target_index,
                        level: *level,
                        count: *count,
                        variable,
                    })
            })
        })
        .collect::<Vec<_>>();
    let identity = [0, 1, 2, 3];
    let observed = statistics(matches, &adjusted, targets, &cells, |_| Some(identity))?;
    let mut random = Permutations::new(seed);
    let mut nulls = vec![Vec::with_capacity(PERMUTATION_COUNT); cells.len()];
    for _ in 0..PERMUTATION_COUNT {
        let permuted = statistics(matches, &adjusted, targets, &cells, |_| random.shuffle())?;
        for (null, value) in nulls.iter_mut().zip(permuted) {
            null.push(value.abs());
        }
    }
    let corrected = corrected_frequencies(&observed, &nulls)?;
    let mut backgrounds = targets
        .iter()
        .map(|target| Background {
            item: target.item,
            variables: Variable::for_item(target.item),
            rows: target
                .levels
                .iter()
                .map(|(level, _)| Row {
                    level: *level,
                    values: Vec::new(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    for ((cell, value), frequency) in cells.iter().zip(observed).zip(corrected.frequencies) {
        let row = backgrounds
            .get_mut(cell.target)?
            .rows
            .iter_mut()
            .find(|row| row.level == cell.level)?;
        row.values.push(Value {
            value,
            marked: cell.variable.can_be_marked() && frequency < TREND_BELOW,
        });
    }
    Some(backgrounds)
}

type Adjusted = Vec<Vec<[f64; PLAYER_COUNT]>>;

/// Each value minus its layer centre (median for assets, mean otherwise).
fn adjusted_values(matches: &[Match<'_>], layer_count: usize) -> Option<Adjusted> {
    Variable::ALL
        .into_iter()
        .map(|variable| {
            let mut by_layer = vec![Vec::new(); layer_count];
            for cells in matches {
                for cell in cells {
                    by_layer.get_mut(cell.layer)?.push(variable.value(cell));
                }
            }
            let centres = by_layer
                .iter()
                .map(|values| {
                    if variable.uses_median() {
                        median_f64(values)
                    } else {
                        average(values)
                    }
                })
                .collect::<Vec<_>>();
            matches
                .iter()
                .map(|cells| {
                    let mut values = [0.0; PLAYER_COUNT];
                    for (target, cell) in values.iter_mut().zip(cells) {
                        *target = variable.value(cell) - (*centres.get(cell.layer)?)?;
                    }
                    Some(values)
                })
                .collect::<Option<Vec<_>>>()
        })
        .collect()
}

/// Statistic of every cell when each match's values are read through `order`.
fn statistics(
    matches: &[Match<'_>],
    adjusted: &Adjusted,
    targets: &[Target],
    cells: &[Cell],
    mut order: impl FnMut(usize) -> Option<[usize; PLAYER_COUNT]>,
) -> Option<Vec<f64>> {
    let mut sums = vec![0.0_f64; cells.len()];
    let mut medians = vec![Vec::new(); cells.len()];
    for (match_index, match_cells) in matches.iter().enumerate() {
        let order = order(match_index)?;
        for (slot, cell) in match_cells.iter().enumerate() {
            let source = *order.get(slot)?;
            for ((background_cell, sum), median) in
                cells.iter().zip(sums.iter_mut()).zip(medians.iter_mut())
            {
                let item = targets.get(background_cell.target)?.item;
                if *cell.levels.get(item.index())? != background_cell.level {
                    continue;
                }
                let value = *adjusted
                    .get(background_cell.variable.index()?)?
                    .get(match_index)?
                    .get(source)?;
                if background_cell.variable.uses_median() {
                    median.push(value);
                } else {
                    *sum += value;
                }
            }
        }
    }
    cells
        .iter()
        .zip(sums)
        .zip(medians)
        .map(|((cell, sum), values)| {
            if cell.variable.uses_median() {
                median_f64(&values)
            } else {
                Some(sum / count_as_f64(cell.count)?)
            }
        })
        .collect()
}
