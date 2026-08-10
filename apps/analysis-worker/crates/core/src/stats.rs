use std::borrow::Borrow;

use crate::numeric::{ceil_usize, count_as_f64, floor_usize};

pub(super) const MINIMUM_OK_SAMPLE_SIZE: usize = 3;
pub(super) const MOMENTUM_OK_SAMPLE_SIZE: usize = 8;
pub(super) const MATURE_SAMPLE_SIZE: usize = 50;

#[must_use]
pub(super) fn average<I, T>(values: I) -> Option<f64>
where
    I: IntoIterator<Item = T>,
    T: Borrow<f64>,
{
    let (total, count) = values
        .into_iter()
        .try_fold((0.0_f64, 0_usize), |(total, count), value| {
            Some((total + value.borrow(), count.checked_add(1)?))
        })?;
    let count = count_as_f64(count)?;
    (count > 0.0).then_some(total / count)
}

#[must_use]
pub(super) fn median_i32(values: &[i32]) -> Option<f64> {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    if sorted.is_empty() {
        None
    } else if sorted.len() % 2 == 1 {
        sorted.get(sorted.len() / 2).copied().map(f64::from)
    } else {
        let upper = sorted.len() / 2;
        let lower_value = sorted.get(upper.checked_sub(1)?)?;
        let upper_value = sorted.get(upper)?;
        Some(f64::midpoint(
            f64::from(*lower_value),
            f64::from(*upper_value),
        ))
    }
}

#[must_use]
pub(super) fn median_f64(values: &[f64]) -> Option<f64> {
    percentile_f64(values, 0.5)
}

#[must_use]
#[expect(
    clippy::suboptimal_flops,
    reason = "series-analysis-v1 checksums bind the existing interpolation operation order"
)]
pub(super) fn percentile_i32(values: &[i32], probability: f64) -> Option<f64> {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    if sorted.is_empty() {
        return None;
    }
    let rank = probability.clamp(0.0, 1.0) * count_as_f64(sorted.len().checked_sub(1)?)?;
    let lower = floor_usize(rank)?;
    let upper = ceil_usize(rank)?;
    let lower_value = f64::from(*sorted.get(lower)?);
    let upper_value = f64::from(*sorted.get(upper)?);
    let weight = rank - count_as_f64(lower)?;
    Some(lower_value + (upper_value - lower_value) * weight)
}

#[must_use]
#[expect(
    clippy::suboptimal_flops,
    reason = "series-analysis-v1 checksums bind the existing interpolation operation order"
)]
pub(super) fn percentile_f64(values: &[f64], probability: f64) -> Option<f64> {
    let mut sorted = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    sorted.sort_by(f64::total_cmp);
    if sorted.is_empty() {
        return None;
    }
    let rank = probability.clamp(0.0, 1.0) * count_as_f64(sorted.len().checked_sub(1)?)?;
    let lower = floor_usize(rank)?;
    let upper = ceil_usize(rank)?;
    let lower_value = *sorted.get(lower)?;
    let upper_value = *sorted.get(upper)?;
    let weight = rank - count_as_f64(lower)?;
    Some(lower_value + (upper_value - lower_value) * weight)
}

#[must_use]
pub(super) fn population_stddev(values: &[f64]) -> Option<f64> {
    let count = count_as_f64(values.len())?;
    average(values).map(|mean| {
        (values
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f64>()
            / count)
            .sqrt()
    })
}

#[must_use]
pub(super) fn rate(count: usize, denominator: usize) -> Option<f64> {
    let numerator = count_as_f64(count)?;
    let denominator = count_as_f64(denominator)?;
    (denominator > 0.0).then(|| numerator / denominator)
}

#[must_use]
pub(super) const fn quality_status(target_count: usize) -> &'static str {
    if target_count == 0 {
        "no_target"
    } else if target_count < MINIMUM_OK_SAMPLE_SIZE {
        "reference"
    } else {
        "ok"
    }
}

#[must_use]
pub(super) const fn momentum_status(target_count: usize) -> &'static str {
    if target_count == 0 {
        "no_target"
    } else if target_count < MOMENTUM_OK_SAMPLE_SIZE {
        "reference"
    } else {
        "ok"
    }
}

#[must_use]
pub(super) const fn sample_maturity(target_count: usize) -> &'static str {
    if target_count >= MATURE_SAMPLE_SIZE {
        "mature"
    } else {
        "early"
    }
}

#[must_use]
pub(super) fn cliffs_delta(left: &[f64], right: &[f64]) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let mut score = 0.0;
    for a in left {
        for b in right {
            score += if a > b {
                1.0
            } else if a < b {
                -1.0
            } else {
                0.0
            };
        }
    }
    let Some(pair_count) = count_as_f64(left.len())
        .zip(count_as_f64(right.len()))
        .map(|(left_count, right_count)| left_count * right_count)
    else {
        return 0.0;
    };
    score / pair_count
}

#[must_use]
pub(super) fn round(value: f64, digits: i32) -> f64 {
    if value == 0.0 {
        return 0.0;
    }
    let factor = 10_f64.powi(digits);
    (value * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_uses_linear_interpolation() {
        assert_eq!(percentile_i32(&[0, 10, 20, 30], 0.25), Some(7.5));
        assert_eq!(median_i32(&[4, 1, 3, 2]), Some(2.5));
    }

    #[test]
    fn denominator_and_sample_status_boundaries_are_explicit() {
        assert_eq!(rate(1, 0), None);
        assert_eq!(quality_status(0), "no_target");
        assert_eq!(quality_status(MINIMUM_OK_SAMPLE_SIZE - 1), "reference");
        assert_eq!(quality_status(MINIMUM_OK_SAMPLE_SIZE), "ok");
        assert_eq!(momentum_status(0), "no_target");
        assert_eq!(momentum_status(MOMENTUM_OK_SAMPLE_SIZE - 1), "reference");
        assert_eq!(momentum_status(MOMENTUM_OK_SAMPLE_SIZE), "ok");
        assert_eq!(sample_maturity(MATURE_SAMPLE_SIZE - 1), "early");
        assert_eq!(sample_maturity(MATURE_SAMPLE_SIZE), "mature");
    }
}
