use std::collections::BTreeMap;

use crate::{model::PlayerMatchInput, numeric::count_as_f64};

use super::{
    CrownCertainty, EncodedEvent, EncodedRow, FOLD_COUNT, FULL_FEATURE_COUNT, FoldEvaluation,
    FoldScore, MINIMUM_EVENT_COUNT, MINIMUM_IMPORTANCE, MINIMUM_IMPROVED_FOLDS,
    MINIMUM_MATCH_COUNT, OK_EVENT_COUNT, PLAYER_COUNT, PairRecord, PlayerSignals,
    PlayerUnexpectedWins, Quality, RankAnalysis, RankFailure, Signal, SignalKind,
    bootstrap::crown_certainty,
    encoding::{distinct_matches, encode, pair_records, pair_records_with},
    outcomes::{build_unexpected_wins, expected_ranks},
    solver::{brier_score, fit, log_loss},
};

#[must_use]
pub(super) fn analyze(rows: &[&PlayerMatchInput], players: &[String]) -> RankAnalysis {
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
        .map_err(|_error| RankFailure::Calculation)
        .and_then(|events| {
            let evaluations = evaluate_folds(&events)?;
            let signals =
                rank_signals(&evaluations, players).map_err(|_error| RankFailure::Calculation)?;
            let expected =
                expected_ranks(&evaluations).map_err(|_error| RankFailure::Calculation)?;
            let unexpected_wins = build_unexpected_wins(rows, players, &expected)
                .map_err(|_error| RankFailure::Calculation)?;
            let crown = crown_certainty(&events, players)
                .map_err(|_error| RankFailure::ModelNotConverged)?;
            Ok((evaluations, signals, unexpected_wins, crown))
        });
    match result {
        Ok((evaluations, signals, unexpected_wins, crown)) => {
            let improved_fold_count = evaluations
                .iter()
                .filter(|evaluation| evaluation.score.improved())
                .count();
            let has_stable = signals
                .iter()
                .any(|player| player.signals.iter().any(|signal| signal.stable));
            let (quality, reasons) = assess(
                held_event_count,
                match_count,
                improved_fold_count,
                has_stable,
            );
            RankAnalysis {
                quality,
                reason_codes: reasons,
                held_event_count,
                match_count,
                improved_fold_count,
                fold_scores: evaluations
                    .iter()
                    .map(|entry| entry.score.clone())
                    .collect(),
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
) -> RankAnalysis {
    RankAnalysis {
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

fn evaluate_folds(events: &[EncodedEvent]) -> Result<Vec<FoldEvaluation>, RankFailure> {
    (0..FOLD_COUNT)
        .map(|fold| {
            let test_events = events
                .iter()
                .enumerate()
                .filter(|(index, _)| index % FOLD_COUNT == fold)
                .map(|(_, event)| event.clone())
                .collect::<Vec<_>>();
            let training_pairs = pair_records(
                events
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| index % FOLD_COUNT != fold)
                    .map(|(_, event)| event),
            )
            .map_err(|_error| RankFailure::Calculation)?;
            let test_pairs =
                pair_records(&test_events).map_err(|_error| RankFailure::Calculation)?;
            if training_pairs.is_empty() || test_pairs.is_empty() {
                return Err(RankFailure::Calculation);
            }
            let baseline_fit = fit(&training_pairs
                .iter()
                .map(|pair| pair.baseline)
                .collect::<Vec<_>>())
            .map_err(|_error| RankFailure::ModelNotConverged)?;
            let full_fit = fit(&training_pairs
                .iter()
                .map(|pair| pair.full)
                .collect::<Vec<_>>())
            .map_err(|_error| RankFailure::ModelNotConverged)?;
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
                        .map_err(|_error| RankFailure::Calculation)?,
                    full_log_loss: log_loss(&full_observations, &full_fit.coefficients)
                        .map_err(|_error| RankFailure::Calculation)?,
                    baseline_brier_score: brier_score(
                        &baseline_observations,
                        &baseline_fit.coefficients,
                    )
                    .map_err(|_error| RankFailure::Calculation)?,
                    full_brier_score: brier_score(&full_observations, &full_fit.coefficients)
                        .map_err(|_error| RankFailure::Calculation)?,
                },
                test_events,
                test_pairs,
                full_fit,
            })
        })
        .collect()
}

fn rank_signals(
    evaluations: &[FoldEvaluation],
    players: &[String],
) -> Result<Vec<PlayerSignals>, ()> {
    players
        .iter()
        .enumerate()
        .map(|(member_index, member_id)| {
            let mut signals = SignalKind::ALL
                .into_iter()
                .map(|kind| signal_for_player(evaluations, member_index, kind))
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
    evaluations: &[FoldEvaluation],
    member_index: usize,
    kind: SignalKind,
) -> Result<Signal, ()> {
    let signal_index = kind.index();
    let mut fold_importances = Vec::with_capacity(evaluations.len());
    for evaluation in evaluations {
        let original = member_log_loss(
            &evaluation.test_pairs,
            member_index,
            &evaluation.full_fit.coefficients,
        )?;
        let permuted_pairs =
            pair_records_with_permuted_signal(&evaluation.test_events, member_index, kind)?;
        let permuted_loss = member_log_loss(
            &permuted_pairs,
            member_index,
            &evaluation.full_fit.coefficients,
        )?;
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

fn pair_records_with_permuted_signal(
    events: &[EncodedEvent],
    member_index: usize,
    kind: SignalKind,
) -> Result<Vec<PairRecord>, ()> {
    if events.len() <= 1 {
        return pair_records(events);
    }
    let signal_index = kind.index();
    let donors = events
        .iter()
        .cycle()
        .skip(1)
        .take(events.len())
        .map(|event| {
            rows_for_member(event, member_index)
                .map(|row| row.signals.get(signal_index).copied().ok_or(()))
                .collect::<Result<Vec<_>, _>>()
        })
        .collect::<Result<Vec<_>, _>>()?;
    let replacements = events
        .iter()
        .zip(&donors)
        .map(|(event, donor)| {
            event
                .matches
                .iter()
                .filter_map(|rank_match| {
                    rank_match
                        .rows
                        .iter()
                        .find(|row| row.source.member_index == member_index)
                        .map(|row| (rank_match.match_id.as_ref(), row))
                })
                .enumerate()
                .map(|(index, (match_id, row))| {
                    let value = if donor.is_empty() {
                        row.signals.get(signal_index).copied().ok_or(())?
                    } else {
                        donor.get(index % donor.len()).copied().ok_or(())?
                    };
                    Ok((match_id, value))
                })
                .collect::<Result<BTreeMap<_, _>, ()>>()
        })
        .collect::<Result<Vec<_>, _>>()?;
    pair_records_with(events, |event_index, rank_match, row, current_signal| {
        if row.source.member_index == member_index && current_signal == signal_index {
            replacements
                .get(event_index)
                .and_then(|values| values.get(rank_match.match_id.as_ref()))
                .copied()
                .ok_or(())
        } else {
            row.signals.get(current_signal).copied().ok_or(())
        }
    })
}

fn rows_for_member(event: &EncodedEvent, member_index: usize) -> impl Iterator<Item = &EncodedRow> {
    event
        .matches
        .iter()
        .flat_map(|rank_match| &rank_match.rows)
        .filter(move |row| row.source.member_index == member_index)
}

fn member_log_loss(
    pairs: &[PairRecord],
    member_index: usize,
    coefficients: &[f64; FULL_FEATURE_COUNT],
) -> Result<f64, ()> {
    let observations = pairs
        .iter()
        .filter(|pair| {
            pair.left_member_index == member_index || pair.right_member_index == member_index
        })
        .map(|pair| pair.full)
        .collect::<Vec<_>>();
    log_loss(&observations, coefficients)
}
