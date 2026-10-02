use std::collections::{BTreeMap, BTreeSet};

use crate::{
    contract::ScopeRef,
    model::{NormalizedAnalysisInput, PlayerMatchInput, ordered_member_ids},
    stats::{average, percentile_f64, percentile_i32},
};

use super::{
    snapshot::{map_counts, snapshot, source_matches},
    types::{
        RADAR_DEFINITION_VERSION, RADAR_METHOD_VERSION, RADAR_MINIMUM_EVENTS,
        RADAR_MINIMUM_MATCHES, RADAR_MINIMUM_SCORING_MATCHES, RADAR_WINDOW_SIZE, RadarAxis,
        RadarAxisBasis, RadarBasis, RadarCandidate, RadarCandidateAxis,
        RadarCandidateUnavailableReason, RadarCell, RadarError, RadarEvaluation, RadarPlayer,
        RadarSample, RadarSampleQuality, RadarScoreUnavailableReason, RadarSourceMatch,
    },
};

/// Generates a candidate from all title records, never from the displayed season/map.
///
/// Insufficient records and degenerate distributions are product states, not calculation errors.
/// No previous basis is supplied: a failed axis therefore cannot silently inherit old thresholds.
///
/// # Errors
///
/// Rejects invalid fixed rosters and values that cannot be represented canonically.
pub fn generate_candidate(input: &NormalizedAnalysisInput) -> Result<RadarCandidate, RadarError> {
    let source = snapshot(input)?;
    let source_summary = source.summary()?;
    let mut reasons = Vec::new();
    if source_summary.match_count < RADAR_MINIMUM_MATCHES {
        reasons.push(RadarCandidateUnavailableReason::InsufficientMatches);
    }
    if source_summary.held_event_count < RADAR_MINIMUM_EVENTS {
        reasons.push(RadarCandidateUnavailableReason::InsufficientEvents);
    }
    let window_count = if reasons.is_empty() {
        source.matches.len().saturating_sub(RADAR_WINDOW_SIZE - 1)
    } else {
        0
    };
    let mut distributions: [Vec<f64>; 6] = std::array::from_fn(|_| Vec::new());
    if reasons.is_empty() {
        for window in source.matches.windows(RADAR_WINDOW_SIZE) {
            let metrics = source_metrics(window);
            for values in metrics.values() {
                for (distribution, value) in distributions.iter_mut().zip(values) {
                    if let Some(value) = value {
                        distribution.push(*value);
                    }
                }
            }
        }
    }
    let axes = std::array::from_fn(|index| {
        // Both arrays have exactly the six positions from the public axis contract.
        #[expect(
            clippy::indexing_slicing,
            reason = "from_fn index is bounded by the fixed six-axis output array"
        )]
        candidate_axis(RadarAxis::ALL[index], &distributions[index], &reasons)
    });
    let basis_axes = axes
        .iter()
        .map(|axis| {
            Some(RadarAxisBasis {
                axis_id: axis.axis_id,
                q10: axis.q10?,
                median: axis.median?,
                q90: axis.q90?,
                thresholds: axis.thresholds?,
            })
        })
        .collect::<Option<Vec<_>>>()
        .and_then(|axes| axes.try_into().ok());
    let basis = basis_axes.map(|valid_axes| RadarBasis {
        definition_version: RADAR_DEFINITION_VERSION.to_owned(),
        method_version: RADAR_METHOD_VERSION.to_owned(),
        window_size: RADAR_WINDOW_SIZE,
        window_stride: 1,
        source: source_summary.clone(),
        axes: valid_axes,
    });
    Ok(RadarCandidate {
        source,
        source_summary,
        window_count,
        values_per_axis: window_count * 4,
        axes,
        basis,
    })
}

/// Scores a scope from its complete selected history using the fixed title basis.
///
/// A valid but empty scope produces no-target cells for the known title roster.
///
/// # Errors
///
/// Rejects a basis for a different title or incompatible definition and invalid rosters.
pub fn evaluate_scope(
    input: &NormalizedAnalysisInput,
    scope: &ScopeRef,
    basis: Option<&RadarBasis>,
) -> Result<RadarEvaluation, RadarError> {
    if basis.is_some_and(|basis| basis.source.game_title_id != input.game_title_id()) {
        return Err(RadarError::InvalidBasis);
    }
    let all_rows = input.player_matches().iter().collect::<Vec<_>>();
    let member_ids = ordered_member_ids(&all_rows);
    let rows = all_rows
        .into_iter()
        .filter(|row| matches_scope(row, scope))
        .collect::<Vec<_>>();
    evaluate_rows(&rows, &member_ids, basis)
}

/// Evaluates the existing scope index in a bounded four-way pass over match rows.
///
/// # Errors
///
/// Rejects incompatible bases and invalid fixed-player rosters.
pub fn evaluate_scopes(
    input: &NormalizedAnalysisInput,
    basis: Option<&RadarBasis>,
) -> Result<Vec<(ScopeRef, RadarEvaluation)>, RadarError> {
    if basis.is_some_and(|basis| basis.source.game_title_id != input.game_title_id()) {
        return Err(RadarError::InvalidBasis);
    }
    input
        .scopes()
        .map(|(scope, rows)| {
            let players = ordered_member_ids(&rows);
            Ok((scope.clone(), evaluate_rows(&rows, &players, basis)?))
        })
        .collect()
}

/// Scores already selected normalized rows, retaining the caller's fixed player order.
///
/// The rows must be a complete-match subset of a validated `NormalizedAnalysisInput`. The
/// explicit member list keeps four no-target players available when the subset is empty.
///
/// # Errors
///
/// Rejects incompatible bases and incomplete or changing four-player rosters.
pub fn evaluate_rows(
    rows: &[&PlayerMatchInput],
    member_ids: &[String],
    basis: Option<&RadarBasis>,
) -> Result<RadarEvaluation, RadarError> {
    let matches = source_matches(rows)?;
    evaluate_matches(&matches, member_ids, basis)
}

/// Validates a stored basis before use; deserializing JSON alone does not establish compatibility.
///
/// # Errors
///
/// Rejects any changed method, axis order, numeric domain, or non-derived threshold.
pub fn validate_basis(basis: &RadarBasis) -> Result<(), RadarError> {
    if basis.definition_version != RADAR_DEFINITION_VERSION
        || basis.method_version != RADAR_METHOD_VERSION
        || basis.window_size != RADAR_WINDOW_SIZE
        || basis.window_stride != 1
        || basis.source.match_count < RADAR_MINIMUM_MATCHES
        || basis.source.held_event_count < RADAR_MINIMUM_EVENTS
        || basis.source.held_event_count > basis.source.match_count
        || basis.source.first_match.is_none()
        || basis.source.last_match.is_none()
        || basis.source.first_match > basis.source.last_match
        || basis.source.game_title_id.is_empty()
        || basis.source.map_master_ids.is_empty()
    {
        return Err(RadarError::InvalidBasis);
    }
    for (axis, expected_id) in basis.axes.iter().zip(RadarAxis::ALL) {
        let generated = thresholds(axis.axis_id, axis.q10, axis.median, axis.q90);
        if axis.axis_id != expected_id
            || generated.is_none_or(|generated| {
                generated.map(f64::to_bits) != axis.thresholds.map(f64::to_bits)
            })
        {
            return Err(RadarError::InvalidBasis);
        }
    }
    Ok(())
}

/// Scores a raw value without display rounding. Equality belongs to the higher score.
///
/// # Errors
///
/// Rejects a malformed basis, non-finite value, or an average rank outside 1 through 4.
pub fn score_value(axis_id: RadarAxis, value: f64, basis: &RadarBasis) -> Result<u8, RadarError> {
    validate_basis(basis)?;
    if !value.is_finite() || (axis_id == RadarAxis::AverageRank && !(1.0..=4.0).contains(&value)) {
        return Err(RadarError::InvalidMetric);
    }
    let axis = basis
        .axes
        .iter()
        .find(|axis| axis.axis_id == axis_id)
        .ok_or(RadarError::InvalidBasis)?;
    Ok(score_axis(value, axis))
}

pub(super) fn evaluate_matches(
    matches: &[RadarSourceMatch],
    member_ids: &[String],
    basis: Option<&RadarBasis>,
) -> Result<RadarEvaluation, RadarError> {
    if let Some(basis) = basis {
        validate_basis(basis)?;
    }
    let member_set = member_ids.iter().collect::<BTreeSet<_>>();
    if (!member_ids.is_empty() && member_set.len() != 4)
        || member_set.len() != member_ids.len()
        || matches.iter().any(|item| {
            item.players
                .iter()
                .map(|player| &player.member_id)
                .collect::<BTreeSet<_>>()
                != member_set
        })
    {
        return Err(RadarError::InvalidRoster);
    }
    let sample = sample(matches);
    let metrics = source_metrics(matches);
    let unavailable_reasons = unavailable_reasons(sample.quality, basis.is_some());
    let players = member_ids
        .iter()
        .map(|member_id| {
            let values = metrics.get(member_id).copied().unwrap_or([None; 6]);
            let axes = std::array::from_fn(|index| {
                #[expect(
                    clippy::indexing_slicing,
                    reason = "from_fn index and all participating arrays share the fixed six-axis length"
                )]
                RadarCell {
                    axis_id: RadarAxis::ALL[index],
                    raw_value: values[index],
                    score: if unavailable_reasons.is_empty() {
                        values[index].zip(basis).map(|(value, basis)| score_axis(value, &basis.axes[index]))
                    } else {
                        None
                    },
                    sample_quality: sample.quality,
                    score_unavailable_reasons: unavailable_reasons.clone(),
                }
            });
            RadarPlayer {
                member_id: member_id.clone(),
                axes,
            }
        })
        .collect();
    Ok(RadarEvaluation {
        definition_version: RADAR_DEFINITION_VERSION.to_owned(),
        method_version: RADAR_METHOD_VERSION.to_owned(),
        basis_checksum: basis.map(RadarBasis::checksum).transpose()?,
        sample,
        players,
    })
}

pub(super) fn sample(matches: &[RadarSourceMatch]) -> RadarSample {
    let match_count = matches.len();
    let held_event_count = matches
        .iter()
        .map(|item| &item.order.held_event_id)
        .collect::<BTreeSet<_>>()
        .len();
    let quality = if match_count == 0 {
        RadarSampleQuality::NoTarget
    } else if match_count < RADAR_MINIMUM_SCORING_MATCHES {
        RadarSampleQuality::Insufficient
    } else if match_count < RADAR_MINIMUM_MATCHES || held_event_count < RADAR_MINIMUM_EVENTS {
        RadarSampleQuality::Reference
    } else {
        RadarSampleQuality::Standard
    };
    RadarSample {
        match_count,
        held_event_count,
        quality,
        first_match: matches.first().map(|item| item.order.clone()),
        last_match: matches.last().map(|item| item.order.clone()),
        map_counts: map_counts(matches),
    }
}

fn source_metrics(matches: &[RadarSourceMatch]) -> BTreeMap<String, [Option<f64>; 6]> {
    let mut by_member = BTreeMap::<String, Vec<_>>::new();
    for item in matches {
        for player in &item.players {
            by_member
                .entry(player.member_id.clone())
                .or_default()
                .push(player);
        }
    }
    by_member
        .into_iter()
        .map(|(member_id, rows)| {
            let revenue = rows
                .iter()
                .map(|row| row.revenue_man_yen)
                .collect::<Vec<_>>();
            let assets = rows
                .iter()
                .map(|row| row.total_assets_man_yen)
                .collect::<Vec<_>>();
            let values = [
                average(rows.iter().map(|row| f64::from(row.rank))),
                percentile_i32(&revenue, 0.9),
                average(revenue.iter().copied().map(f64::from)),
                percentile_i32(&assets, 0.1),
                percentile_i32(&assets, 0.5),
                percentile_i32(&assets, 0.9),
            ];
            (member_id, values)
        })
        .collect()
}

fn candidate_axis(
    axis_id: RadarAxis,
    values: &[f64],
    reasons: &[RadarCandidateUnavailableReason],
) -> RadarCandidateAxis {
    if !reasons.is_empty() {
        return RadarCandidateAxis {
            axis_id,
            q10: None,
            median: None,
            q90: None,
            thresholds: None,
            unavailable_reasons: reasons.to_owned(),
        };
    }
    let oriented = values
        .iter()
        .map(|value| axis_id.orient(*value))
        .collect::<Vec<_>>();
    let q10 = percentile_f64(&oriented, 0.1).map(|value| axis_id.orient(value));
    let median = percentile_f64(&oriented, 0.5).map(|value| axis_id.orient(value));
    let q90 = percentile_f64(&oriented, 0.9).map(|value| axis_id.orient(value));
    let thresholds = q10
        .zip(median)
        .zip(q90)
        .and_then(|((q10, median), q90)| thresholds(axis_id, q10, median, q90));
    RadarCandidateAxis {
        axis_id,
        q10,
        median,
        q90,
        thresholds,
        unavailable_reasons: if thresholds.is_some() {
            Vec::new()
        } else {
            vec![RadarCandidateUnavailableReason::DegenerateDistribution]
        },
    }
}

#[expect(
    clippy::suboptimal_flops,
    reason = "the versioned scoring formula keeps its specified subtraction, division, multiplication and addition order"
)]
pub(super) fn thresholds(axis_id: RadarAxis, q10: f64, median: f64, q90: f64) -> Option<[f64; 9]> {
    if ![q10, median, q90].iter().all(|value| value.is_finite())
        || (axis_id == RadarAxis::AverageRank
            && ![q10, median, q90]
                .iter()
                .all(|value| (1.0..=4.0).contains(value)))
    {
        return None;
    }
    let low = axis_id.orient(q10);
    let center = axis_id.orient(median);
    let high = axis_id.orient(q90);
    if !(low < center && center < high) {
        return None;
    }
    let lower_width = center - low;
    let upper_width = if axis_id == RadarAxis::AverageRank {
        (high - center).min((-1.0 - center) / 1.6)
    } else {
        high - center
    };
    let mut result = [0.0; 9];
    for (boundary, score) in result.iter_mut().zip(2_u8..=10) {
        let width = if score < 6 { lower_width } else { upper_width };
        let raw_boundary = axis_id.orient(center + (f64::from(score) - 6.0) / 2.5 * width);
        // The rank cap is mathematically one. Rounding division followed by multiplication
        // must not move it a representable value beyond the attainable rank domain.
        let value = if axis_id == RadarAxis::AverageRank && score == 10 {
            raw_boundary.max(1.0)
        } else {
            raw_boundary
        };
        *boundary = if value == 0.0 { 0.0 } else { value };
    }
    result
        .iter()
        .all(|value| value.is_finite())
        .then_some(result)
}

fn score_axis(value: f64, axis: &RadarAxisBasis) -> u8 {
    let oriented = axis.axis_id.orient(value);
    axis.thresholds.iter().fold(1_u8, |score, threshold| {
        score + u8::from(oriented >= axis.axis_id.orient(*threshold))
    })
}

fn unavailable_reasons(
    quality: RadarSampleQuality,
    has_basis: bool,
) -> Vec<RadarScoreUnavailableReason> {
    let mut reasons = match quality {
        RadarSampleQuality::NoTarget => vec![RadarScoreUnavailableReason::NoTarget],
        RadarSampleQuality::Insufficient => vec![RadarScoreUnavailableReason::InsufficientMatches],
        RadarSampleQuality::Reference | RadarSampleQuality::Standard => Vec::new(),
    };
    if !has_basis {
        reasons.push(RadarScoreUnavailableReason::BasisUnavailable);
    }
    reasons
}

fn matches_scope(row: &PlayerMatchInput, scope: &ScopeRef) -> bool {
    match scope {
        ScopeRef::Overall => true,
        ScopeRef::Season { season_master_id } => row.season_master_id == *season_master_id,
        ScopeRef::Map { map_master_id } => row.map_master_id == *map_master_id,
        ScopeRef::SeasonMap {
            season_master_id,
            map_master_id,
        } => row.season_master_id == *season_master_id && row.map_master_id == *map_master_id,
    }
}
