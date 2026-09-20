use super::{
    BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED, CrownCertainty, EncodedEvent, PLAY_ORDER_COUNT,
    SIGNAL_COUNT, TIE_TOLERANCE, encoding::pair_records, evaluation::bounded_count, solver::fit,
};

pub(super) fn crown_certainty(
    events: &[EncodedEvent],
    players: &[String],
) -> Result<CrownCertainty, ()> {
    // Bootstrap resamples events, not features: encode each event's observations once and
    // retain only what fitting consumes. Draw order and the solver's total order stay unchanged.
    let observations_by_event = events
        .iter()
        .map(|event| {
            pair_records([event])
                .map(|pair| pair.full)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let mut observations = Vec::new();
    let mut iterations = Vec::with_capacity(BOOTSTRAP_ITERATIONS);
    for iteration in 0..BOOTSTRAP_ITERATIONS {
        observations.clear();
        for draw in 0..events.len() {
            observations.extend_from_slice(
                observations_by_event
                    .get(draw_index(iteration, draw, events.len())?)
                    .ok_or(())?,
            );
        }
        if let Ok(fit) = fit(&mut observations)
            && let Ok(iteration_leaders) = leaders(&fit.coefficients, players.len())
        {
            iterations.push(iteration_leaders);
        }
    }
    if iterations.len() < (BOOTSTRAP_ITERATIONS * 9 / 10).max(1) {
        return Err(());
    }
    let mut totals = vec![0.0; players.len()];
    for leaders in &iterations {
        if leaders.is_empty() {
            return Err(());
        }
        let contribution = 1.0 / bounded_count(leaders.len())?;
        for leader in leaders {
            *totals.get_mut(*leader).ok_or(())? += contribution;
        }
    }
    let primary = iterations
        .iter()
        .map(|leaders| leaders.first().copied().ok_or(()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CrownCertainty {
        bootstrap_iterations: BOOTSTRAP_ITERATIONS,
        successful_iterations: iterations.len(),
        leader_change_count: primary
            .windows(2)
            .filter(|leaders| matches!(leaders, [left, right] if left != right))
            .count(),
        shares: players
            .iter()
            .zip(totals)
            .map(|(member_id, total)| {
                bounded_count(iterations.len())
                    .map(|iteration_count| (member_id.clone(), total / iteration_count))
            })
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn leaders(coefficients: &[f64], player_count: usize) -> Result<Vec<usize>, ()> {
    let start = SIGNAL_COUNT + PLAY_ORDER_COUNT;
    let end = start.checked_add(player_count).ok_or(())?;
    let player_coefficients = coefficients.get(start..end).ok_or(())?;
    let maximum = player_coefficients
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let leaders = player_coefficients
        .iter()
        .enumerate()
        .filter(|(_, coefficient)| (**coefficient - maximum).abs() <= TIE_TOLERANCE)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if leaders.is_empty() {
        Err(())
    } else {
        Ok(leaders)
    }
}

fn draw_index(iteration: usize, draw: usize, bound: usize) -> Result<usize, ()> {
    let bound = u64::try_from(bound).map_err(|_conversion_error| ())?;
    if bound == 0 {
        return Err(());
    }
    let iteration = u64::try_from(iteration).map_err(|_conversion_error| ())?;
    let draw = u64::try_from(draw).map_err(|_conversion_error| ())?;
    let mixed = mix64(
        BOOTSTRAP_SEED ^ iteration.wrapping_mul(0x9e37_79b9) ^ draw.wrapping_mul(0x85eb_ca6b),
    );
    usize::try_from(mixed % bound).map_err(|_conversion_error| ())
}

const fn mix64(input: u64) -> u64 {
    let first = (input ^ (input >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    let second = (first ^ (first >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    second ^ (second >> 31)
}
