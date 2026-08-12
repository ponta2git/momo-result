use std::cmp::Ordering;

use super::{
    ARMIJO_FACTOR, Fit, Observation, PIVOT_FLOOR, PROBABILITY_FLOOR, evaluation::bounded_count,
};

#[expect(
    clippy::suboptimal_flops,
    reason = "floating-point operation order is part of the rank-bt-v1 artifact identity"
)]
pub(super) fn fit<const N: usize>(observations: &[Observation<N>]) -> Result<Fit<N>, ()> {
    if N == 0
        || observations.iter().any(|observation| {
            observation.features.iter().any(|value| !value.is_finite())
                || !matches!(observation.outcome, 0.0 | 1.0)
        })
    {
        return Err(());
    }
    let mut ordered = observations.to_vec();
    ordered.sort_by(compare_observations);
    let mut coefficients = [0.0; N];
    for iteration in 0..=100 {
        let derivatives = objective_gradient_hessian(&ordered, &coefficients)?;
        if max_absolute(&derivatives.gradient) <= 1e-8 {
            return Ok(Fit { coefficients });
        }
        if iteration >= 100 {
            return Err(());
        }
        let step = solve(derivatives.hessian, derivatives.gradient)?;
        let directional_decrease = dot(&derivatives.gradient, &step);
        if !directional_decrease.is_finite() || directional_decrease <= 0.0 {
            return Err(());
        }
        let mut scale = 1.0;
        let (next, accepted_scale) = loop {
            if scale < 1e-8 {
                return Err(());
            }
            let mut candidate = coefficients;
            for ((candidate_coefficient, coefficient), step_component) in
                candidate.iter_mut().zip(&coefficients).zip(&step)
            {
                *candidate_coefficient = coefficient - scale * step_component;
            }
            let candidate_objective = objective(&ordered, &candidate)?;
            if candidate_objective
                <= derivatives.objective - ARMIJO_FACTOR * scale * directional_decrease
            {
                break (candidate, scale);
            }
            scale /= 2.0;
        };
        coefficients = next;
        if max_absolute(&step) * accepted_scale <= 1e-8 {
            return Ok(Fit { coefficients });
        }
    }
    Err(())
}

fn compare_observations<const N: usize>(left: &Observation<N>, right: &Observation<N>) -> Ordering {
    left.features
        .iter()
        .zip(&right.features)
        .map(|(left, right)| left.total_cmp(right))
        .find(|ordering| *ordering != Ordering::Equal)
        .unwrap_or_else(|| left.outcome.total_cmp(&right.outcome))
}

struct ObjectiveDerivatives<const N: usize> {
    objective: f64,
    gradient: [f64; N],
    hessian: [[f64; N]; N],
}

#[expect(
    clippy::suboptimal_flops,
    reason = "floating-point operation order is part of the rank-bt-v1 artifact identity"
)]
fn objective_gradient_hessian<const N: usize>(
    observations: &[Observation<N>],
    coefficients: &[f64; N],
) -> Result<ObjectiveDerivatives<N>, ()> {
    let mut gradient = [0.0; N];
    let mut hessian = [[0.0; N]; N];
    let mut loss = 0.0;
    for observation in observations {
        let predicted = sigmoid(dot(&observation.features, coefficients));
        let probability = clamp_probability(predicted);
        let residual = predicted - observation.outcome;
        let curvature = predicted * (1.0 - predicted);
        for ((gradient_value, hessian_row), row_feature) in gradient
            .iter_mut()
            .zip(&mut hessian)
            .zip(&observation.features)
        {
            *gradient_value += residual * row_feature;
            for (hessian_value, column_feature) in hessian_row.iter_mut().zip(&observation.features)
            {
                *hessian_value += curvature * row_feature * column_feature;
            }
        }
        loss -= observation.outcome * probability.ln()
            + (1.0 - observation.outcome) * (1.0 - probability).ln();
    }
    for (index, ((gradient_value, hessian_row), coefficient)) in gradient
        .iter_mut()
        .zip(&mut hessian)
        .zip(coefficients)
        .enumerate()
    {
        *gradient_value += coefficient;
        *hessian_row.get_mut(index).ok_or(())? += 1.0;
    }
    let penalized = loss + 0.5 * coefficients.iter().map(|value| value * value).sum::<f64>();
    if penalized.is_finite()
        && gradient.iter().all(|value| value.is_finite())
        && hessian.iter().flatten().all(|value| value.is_finite())
    {
        Ok(ObjectiveDerivatives {
            objective: penalized,
            gradient,
            hessian,
        })
    } else {
        Err(())
    }
}

#[expect(
    clippy::suboptimal_flops,
    reason = "floating-point operation order is part of the rank-bt-v1 artifact identity"
)]
fn objective<const N: usize>(
    observations: &[Observation<N>],
    coefficients: &[f64; N],
) -> Result<f64, ()> {
    let mut loss = 0.0;
    for observation in observations {
        let probability = clamp_probability(sigmoid(dot(&observation.features, coefficients)));
        loss -= observation.outcome * probability.ln()
            + (1.0 - observation.outcome) * (1.0 - probability).ln();
    }
    let result = loss + 0.5 * coefficients.iter().map(|value| value * value).sum::<f64>();
    if result.is_finite() {
        Ok(result)
    } else {
        Err(())
    }
}

pub(super) fn probability<const N: usize>(
    features: &[f64; N],
    coefficients: &[f64; N],
) -> Result<f64, ()> {
    if features.is_empty()
        || features.iter().any(|value| !value.is_finite())
        || coefficients.iter().any(|value| !value.is_finite())
    {
        return Err(());
    }
    let linear = dot(features, coefficients);
    if linear.is_finite() {
        Ok(sigmoid(linear))
    } else {
        Err(())
    }
}

#[expect(
    clippy::suboptimal_flops,
    reason = "floating-point operation order is part of the rank-bt-v1 artifact identity"
)]
pub(super) fn log_loss<const N: usize>(
    observations: &[Observation<N>],
    coefficients: &[f64; N],
) -> Result<f64, ()> {
    metric(observations, coefficients, |outcome, predicted| {
        let probability = clamp_probability(predicted);
        -(outcome * probability.ln() + (1.0 - outcome) * (1.0 - probability).ln())
    })
}

pub(super) fn brier_score<const N: usize>(
    observations: &[Observation<N>],
    coefficients: &[f64; N],
) -> Result<f64, ()> {
    metric(observations, coefficients, |outcome, predicted| {
        (predicted - outcome).powi(2)
    })
}

fn metric<const N: usize>(
    observations: &[Observation<N>],
    coefficients: &[f64; N],
    score: impl Fn(f64, f64) -> f64,
) -> Result<f64, ()> {
    if observations.is_empty() {
        return Err(());
    }
    let mut total = 0.0;
    for observation in observations {
        total += score(
            observation.outcome,
            probability(&observation.features, coefficients)?,
        );
    }
    let result = total / bounded_count(observations.len())?;
    if result.is_finite() {
        Ok(result)
    } else {
        Err(())
    }
}

#[expect(
    clippy::suboptimal_flops,
    reason = "floating-point operation order is part of the rank-bt-v1 artifact identity"
)]
fn solve<const N: usize>(
    mut matrix: [[f64; N]; N],
    mut right_hand_side: [f64; N],
) -> Result<[f64; N], ()> {
    if N == 0 {
        return Err(());
    }
    for pivot_column in 0..N {
        let mut pivot_row = pivot_column;
        let mut pivot_magnitude = matrix_value(&matrix, pivot_row, pivot_column)?.abs();
        for candidate_row in pivot_column + 1..N {
            let candidate_magnitude = matrix_value(&matrix, candidate_row, pivot_column)?.abs();
            if candidate_magnitude.total_cmp(&pivot_magnitude) == Ordering::Greater {
                pivot_row = candidate_row;
                pivot_magnitude = candidate_magnitude;
            }
        }
        if pivot_magnitude <= PIVOT_FLOOR {
            return Err(());
        }
        matrix.swap(pivot_column, pivot_row);
        right_hand_side.swap(pivot_column, pivot_row);
        let pivot_values = *matrix.get(pivot_column).ok_or(())?;
        let pivot_right_hand_side = *right_hand_side.get(pivot_column).ok_or(())?;
        let pivot = *pivot_values.get(pivot_column).ok_or(())?;
        for (candidate_row, candidate) in matrix.iter_mut().enumerate().skip(pivot_column + 1) {
            let factor = *candidate.get(pivot_column).ok_or(())? / pivot;
            for (candidate_value, pivot_value) in
                candidate.iter_mut().zip(&pivot_values).skip(pivot_column)
            {
                *candidate_value -= factor * pivot_value;
            }
            let candidate_right_hand_side = right_hand_side.get_mut(candidate_row).ok_or(())?;
            *candidate_right_hand_side -= factor * pivot_right_hand_side;
        }
    }
    let mut solution = [0.0; N];
    for row in (0..N).rev() {
        let matrix_row = matrix.get(row).ok_or(())?;
        let following_coefficients = matrix_row.get(row + 1..N).ok_or(())?;
        let solved_values = solution.get(row + 1..N).ok_or(())?;
        let following = following_coefficients
            .iter()
            .zip(solved_values)
            .map(|(coefficient, value)| coefficient * value)
            .sum::<f64>();
        let right_hand_value = *right_hand_side.get(row).ok_or(())?;
        let pivot = *matrix_row.get(row).ok_or(())?;
        *solution.get_mut(row).ok_or(())? = (right_hand_value - following) / pivot;
    }
    if solution.iter().all(|value| value.is_finite()) {
        Ok(solution)
    } else {
        Err(())
    }
}

fn matrix_value<const N: usize>(
    matrix: &[[f64; N]; N],
    row: usize,
    column: usize,
) -> Result<f64, ()> {
    matrix
        .get(row)
        .and_then(|values| values.get(column))
        .copied()
        .ok_or(())
}

fn sigmoid(value: f64) -> f64 {
    if value >= 0.0 {
        let exponential = (-value).exp();
        1.0 / (1.0 + exponential)
    } else {
        let exponential = value.exp();
        exponential / (1.0 + exponential)
    }
}

fn clamp_probability(value: f64) -> f64 {
    value.clamp(PROBABILITY_FLOOR, 1.0 - PROBABILITY_FLOOR)
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum()
}

fn max_absolute(values: &[f64]) -> f64 {
    values.iter().map(|value| value.abs()).fold(0.0, f64::max)
}
