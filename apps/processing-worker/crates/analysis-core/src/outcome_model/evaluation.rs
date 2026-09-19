use crate::{model::PlayerMatchInput, numeric::count_as_f64};

use super::{
    CrownCertainty, EncodedEvent, FOLD_COUNT, FULL_FEATURE_COUNT, FoldEvaluation, FoldScore,
    MINIMUM_EVENT_COUNT, MINIMUM_IMPORTANCE, MINIMUM_IMPROVED_FOLDS, MINIMUM_MATCH_COUNT,
    OK_EVENT_COUNT, Observation, OutcomeModelAnalysis, OutcomeModelFailure, PLAYER_COUNT,
    PairRecord, PlayerSignals, PlayerUnexpectedWins, Quality, Signal, SignalKind,
    bootstrap::crown_certainty,
    encoding::{distinct_matches, encode, pair_records},
    outcomes::{build_unexpected_wins, expected_ranks},
    solver::{brier_score, fit, log_loss},
};

#[must_use]
pub(super) fn analyze(rows: &[&PlayerMatchInput], players: &[String]) -> OutcomeModelAnalysis {
    let match_count = distinct_matches(rows).len();
    let held_event_count = rows
        .iter()
        .map(|row| row.held_event_id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let (initial_quality, initial_reasons) = assess(held_event_count, match_count, 0, false);
    if initial_quality == Quality::NoTarget || players.len() != PLAYER_COUNT {
        let reasons = if players.len() == PLAYER_COUNT {
            initial_reasons
        } else {
            vec!["invalid_dataset"]
        };
        return empty_result(rows, players, held_event_count, match_count, reasons);
    }

    let result = encode(rows, players)
        .map_err(|_error| OutcomeModelFailure::Calculation)
        .and_then(|events| {
            let evaluations = evaluate_folds(&events)?;
            let signals = rank_signals(&evaluations, players)
                .map_err(|_error| OutcomeModelFailure::Calculation)?;
            let expected =
                expected_ranks(&evaluations).map_err(|_error| OutcomeModelFailure::Calculation)?;
            let unexpected_wins = build_unexpected_wins(rows, players, &expected)
                .map_err(|_error| OutcomeModelFailure::Calculation)?;
            let crown = crown_certainty(&events, players)
                .map_err(|_error| OutcomeModelFailure::ModelNotConverged)?;
            Ok((
                evaluations
                    .into_iter()
                    .map(|entry| entry.score)
                    .collect::<Vec<_>>(),
                signals,
                unexpected_wins,
                crown,
            ))
        });
    match result {
        Ok((fold_scores, signals, unexpected_wins, crown)) => {
            let improved_fold_count = fold_scores.iter().filter(|score| score.improved()).count();
            let has_stable = signals
                .iter()
                .any(|player| player.signals.iter().any(|signal| signal.stable));
            let (quality, reasons) = assess(
                held_event_count,
                match_count,
                improved_fold_count,
                has_stable,
            );
            OutcomeModelAnalysis {
                quality,
                reason_codes: reasons,
                held_event_count,
                match_count,
                improved_fold_count,
                fold_scores,
                player_signals: signals,
                unexpected_wins,
                crown,
            }
        }
        Err(failure) => empty_result(
            rows,
            players,
            held_event_count,
            match_count,
            vec![failure.reason_code()],
        ),
    }
}

fn assess(
    held_event_count: usize,
    match_count: usize,
    improved_fold_count: usize,
    has_stable_signal: bool,
) -> (Quality, Vec<&'static str>) {
    let mut no_target = Vec::new();
    if match_count < MINIMUM_MATCH_COUNT {
        no_target.push("insufficient_matches");
    }
    if held_event_count < MINIMUM_EVENT_COUNT {
        no_target.push("insufficient_events");
    }
    if !no_target.is_empty() {
        return (Quality::NoTarget, no_target);
    }
    let mut reasons = Vec::new();
    if held_event_count < OK_EVENT_COUNT {
        reasons.push("insufficient_events");
    }
    if improved_fold_count < MINIMUM_IMPROVED_FOLDS {
        reasons.push("model_not_better");
    }
    if !has_stable_signal {
        reasons.push("unstable_signals");
    }
    if reasons.is_empty() {
        (Quality::Ok, reasons)
    } else {
        (Quality::Reference, reasons)
    }
}

fn empty_result(
    rows: &[&PlayerMatchInput],
    players: &[String],
    held_event_count: usize,
    match_count: usize,
    reasons: Vec<&'static str>,
) -> OutcomeModelAnalysis {
    OutcomeModelAnalysis {
        quality: Quality::NoTarget,
        reason_codes: reasons,
        held_event_count,
        match_count,
        improved_fold_count: 0,
        fold_scores: Vec::new(),
        player_signals: players
            .iter()
            .map(|member_id| PlayerSignals {
                member_id: member_id.clone(),
                signals: Vec::new(),
            })
            .collect(),
        unexpected_wins: players
            .iter()
            .map(|member_id| PlayerUnexpectedWins {
                member_id: member_id.clone(),
                total_win_count: rows
                    .iter()
                    .filter(|row| row.member_id == *member_id && row.rank == 1)
                    .count(),
                wins: Vec::new(),
            })
            .collect(),
        crown: CrownCertainty {
            bootstrap_iterations: 0,
            successful_iterations: 0,
            leader_change_count: 0,
            shares: players
                .iter()
                .map(|member_id| (member_id.clone(), 0.0))
                .collect(),
        },
    }
}

pub(super) fn bounded_count(value: usize) -> Result<f64, ()> {
    count_as_f64(value).ok_or(())
}

fn evaluate_folds(events: &[EncodedEvent]) -> Result<Vec<FoldEvaluation<'_>>, OutcomeModelFailure> {
    (0..FOLD_COUNT)
        .map(|fold| {
            let test_events = events
                .iter()
                .enumerate()
                .filter(|(index, _)| index % FOLD_COUNT == fold)
                .map(|(_, event)| event)
                .collect::<Vec<_>>();
            let training_events = events
                .iter()
                .enumerate()
                .filter(|(index, _)| index % FOLD_COUNT != fold)
                .map(|(_, event)| event);
            let test_pairs = pair_records(test_events.iter().copied()).collect::<Vec<_>>();
            let mut baseline_training = pair_records(training_events.clone())
                .map(|pair| pair.baseline)
                .collect::<Vec<_>>();
            if baseline_training.is_empty() || test_pairs.is_empty() {
                return Err(OutcomeModelFailure::Calculation);
            }
            let baseline_fit = fit(&mut baseline_training)
                .map_err(|_error| OutcomeModelFailure::ModelNotConverged)?;
            drop(baseline_training);
            let full_fit = fit(&mut pair_records(training_events)
                .map(|pair| pair.full)
                .collect::<Vec<_>>())
            .map_err(|_error| OutcomeModelFailure::ModelNotConverged)?;
            let baseline_observations = test_pairs
                .iter()
                .map(|pair| pair.baseline)
                .collect::<Vec<_>>();
            let full_observations = test_pairs.iter().map(|pair| pair.full).collect::<Vec<_>>();
            Ok(FoldEvaluation {
                score: FoldScore {
                    fold,
                    held_event_count: test_events.len(),
                    comparison_count: test_pairs.len(),
                    baseline_log_loss: log_loss(&baseline_observations, &baseline_fit.coefficients)
                        .map_err(|_error| OutcomeModelFailure::Calculation)?,
                    full_log_loss: log_loss(&full_observations, &full_fit.coefficients)
                        .map_err(|_error| OutcomeModelFailure::Calculation)?,
                    baseline_brier_score: brier_score(
                        &baseline_observations,
                        &baseline_fit.coefficients,
                    )
                    .map_err(|_error| OutcomeModelFailure::Calculation)?,
                    full_brier_score: brier_score(&full_observations, &full_fit.coefficients)
                        .map_err(|_error| OutcomeModelFailure::Calculation)?,
                },
                test_events,
                test_pairs,
                full_fit,
            })
        })
        .collect()
}

fn rank_signals(
    evaluations: &[FoldEvaluation<'_>],
    players: &[String],
) -> Result<Vec<PlayerSignals>, ()> {
    players
        .iter()
        .enumerate()
        .map(|(member_index, member_id)| {
            let original_losses = evaluations
                .iter()
                .map(|evaluation| {
                    member_log_loss(
                        &evaluation.test_pairs,
                        member_index,
                        &evaluation.full_fit.coefficients,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            let mut signals = SignalKind::ALL
                .into_iter()
                .map(|kind| signal_for_player(evaluations, &original_losses, member_index, kind))
                .collect::<Result<Vec<_>, _>>()?;
            signals.retain(|signal| signal.importance > 0.0);
            signals.sort_by(|left, right| {
                right
                    .importance
                    .total_cmp(&left.importance)
                    .then_with(|| left.kind.cmp(&right.kind))
            });
            signals.truncate(3);
            Ok(PlayerSignals {
                member_id: member_id.clone(),
                signals,
            })
        })
        .collect()
}

fn signal_for_player(
    evaluations: &[FoldEvaluation<'_>],
    original_losses: &[f64],
    member_index: usize,
    kind: SignalKind,
) -> Result<Signal, ()> {
    let signal_index = kind.index();
    let mut fold_importances = Vec::with_capacity(evaluations.len());
    for (evaluation, original) in evaluations.iter().zip(original_losses) {
        let permuted = permuted_member_observations(
            &evaluation.test_events,
            &evaluation.test_pairs,
            member_index,
            kind,
        )?;
        let permuted_loss = log_loss(&permuted, &evaluation.full_fit.coefficients)?;
        fold_importances.push(permuted_loss - original);
    }
    let coefficients = evaluations
        .iter()
        .map(|evaluation| {
            evaluation
                .full_fit
                .coefficients
                .get(signal_index)
                .copied()
                .ok_or(())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let positive = coefficients
        .iter()
        .filter(|coefficient| **coefficient > 0.0)
        .count();
    let negative = coefficients
        .iter()
        .filter(|coefficient| **coefficient < 0.0)
        .count();
    let importance = fold_importances.iter().sum::<f64>() / bounded_count(fold_importances.len())?;
    let stable = positive.max(negative) >= 4
        && fold_importances
            .iter()
            .filter(|fold_importance| **fold_importance > 0.0)
            .count()
            >= 3
        && importance >= MINIMUM_IMPORTANCE;
    Ok(Signal {
        kind,
        direction: if positive >= negative {
            "more_is_higher"
        } else {
            "less_is_higher"
        },
        importance,
        fold_importances,
        fold_comparison_counts: evaluations
            .iter()
            .map(|evaluation| {
                evaluation
                    .test_pairs
                    .iter()
                    .filter(|pair| {
                        pair.left_member_index == member_index
                            || pair.right_member_index == member_index
                    })
                    .count()
            })
            .collect(),
        stable,
    })
}

fn permuted_member_observations(
    events: &[&EncodedEvent],
    pairs: &[PairRecord],
    member_index: usize,
    kind: SignalKind,
) -> Result<Vec<Observation<FULL_FEATURE_COUNT>>, ()> {
    if events.len() <= 1 {
        return Ok(member_pairs(pairs, member_index)
            .map(|pair| pair.full)
            .collect());
    }
    let signal_index = kind.index();
    // Permutation changes one signal for one member. Keep the existing pair order and
    // subtract the actual left/right values again (adding a delta would change rounding).
    member_pairs(pairs, member_index)
        .map(|pair| {
            let rank_match = events
                .get(pair.match_key.event_index)
                .and_then(|event| event.matches.get(pair.match_key.match_index))
                .ok_or(())?;
            // Every encoded match contains all four members in the same canonical order.
            // Rotate the donor event and cycle its matches, preserving unequal-event semantics.
            let donor = events
                .get((pair.match_key.event_index + 1) % events.len())
                .ok_or(())?;
            let donor_match_index = pair
                .match_key
                .match_index
                .checked_rem(donor.matches.len())
                .ok_or(())?;
            let replacement = donor
                .matches
                .get(donor_match_index)
                .and_then(|donor_match| donor_match.rows.get(member_index))
                .and_then(|row| row.signals.get(signal_index))
                .copied()
                .ok_or(())?;
            let signal = |index: usize| {
                if index == member_index {
                    Ok(replacement)
                } else {
                    rank_match
                        .rows
                        .get(index)
                        .and_then(|row| row.signals.get(signal_index))
                        .copied()
                        .ok_or(())
                }
            };
            let mut observation = pair.full;
            *observation.features.get_mut(signal_index).ok_or(())? =
                signal(pair.left_member_index)? - signal(pair.right_member_index)?;
            Ok(observation)
        })
        .collect()
}

fn member_pairs(pairs: &[PairRecord], member_index: usize) -> impl Iterator<Item = &PairRecord> {
    pairs.iter().filter(move |pair| {
        pair.left_member_index == member_index || pair.right_member_index == member_index
    })
}

fn member_log_loss(
    pairs: &[PairRecord],
    member_index: usize,
    coefficients: &[f64; FULL_FEATURE_COUNT],
) -> Result<f64, ()> {
    let observations = member_pairs(pairs, member_index)
        .map(|pair| pair.full)
        .collect::<Vec<_>>();
    log_loss(&observations, coefficients)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outcome_model::{
        ADJUSTMENT_COUNT, EncodedMatch, EncodedRow, SIGNAL_COUNT, SourceRow,
    };

    fn event(id: &str, values: &[f64]) -> EncodedEvent {
        EncodedEvent {
            held_event_id: id.into(),
            played_at: "2026-01-01T00:00:00.000000Z".into(),
            matches: values
                .iter()
                .zip(0_i32..)
                .map(|(value, index)| EncodedMatch {
                    match_id: format!("{id}-{index}").into(),
                    match_no_in_event: index + 1,
                    played_at: "2026-01-01T00:00:00.000000Z".into(),
                    rows: [1, 2, 3, 4].map(|rank| {
                        let member_index = usize::try_from(rank - 1).unwrap_or(0);
                        let mut signals = [f64::from(rank); SIGNAL_COUNT];
                        if let Some(revenue) = signals.first_mut() {
                            *revenue = if member_index == 2 { *value } else { 0.0 };
                        }
                        EncodedRow {
                            source: SourceRow { member_index, rank },
                            signals,
                            adjustments: [f64::from(rank); ADJUSTMENT_COUNT],
                        }
                    }),
                })
                .collect(),
        }
    }

    #[test]
    fn permutation_rotates_and_cycles_unequal_events_without_changing_other_features() {
        let events = [
            event("a", &[10.0, 11.0]),
            event("b", &[20.0]),
            event("c", &[30.0, 31.0, 32.0]),
        ];
        let references = events.iter().collect::<Vec<_>>();
        let pairs = pair_records(events.iter()).collect::<Vec<_>>();
        let permuted = permuted_member_observations(&references, &pairs, 2, SignalKind::Revenue)
            .unwrap_or_default();
        let expected = [20.0_f64, 20.0, 30.0, 10.0, 11.0, 10.0]
            .into_iter()
            .flat_map(|value| [-value, -value, value])
            .map(f64::to_bits)
            .collect::<Vec<_>>();
        assert_eq!(
            permuted
                .iter()
                .filter_map(|row| row.features.first())
                .copied()
                .map(f64::to_bits)
                .collect::<Vec<_>>(),
            expected
        );
        for (observation, original) in permuted.iter().zip(member_pairs(&pairs, 2)) {
            assert_eq!(
                observation.outcome.to_bits(),
                original.full.outcome.to_bits()
            );
            assert_eq!(
                observation
                    .features
                    .iter()
                    .skip(1)
                    .copied()
                    .map(f64::to_bits)
                    .collect::<Vec<_>>(),
                original
                    .full
                    .features
                    .iter()
                    .skip(1)
                    .copied()
                    .map(f64::to_bits)
                    .collect::<Vec<_>>()
            );
        }
    }
}
