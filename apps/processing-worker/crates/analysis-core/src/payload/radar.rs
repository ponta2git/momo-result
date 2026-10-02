use std::collections::BTreeSet;

use serde_json::Value;

use crate::radar::{
    RADAR_DEFINITION_VERSION, RADAR_METHOD_VERSION, RADAR_MINIMUM_EVENTS, RADAR_MINIMUM_MATCHES,
    RADAR_MINIMUM_SCORING_MATCHES, RadarAggregate, RadarAxis, RadarBasis, RadarCandidateSummary,
    RadarEvaluation, RadarMapCount, RadarMonitoring, RadarMonitoringStatus, RadarSampleQuality,
    RadarScoreUnavailableReason, score_value, validate_basis,
};

use super::{PayloadError, schema};

/// Decodes the bounded shape and verifies the versioned, derived threshold contract.
///
/// # Errors
///
/// Rejects malformed, incompatible, or non-derived stored criteria.
pub fn radar_basis_from_payload(value: &Value) -> Result<RadarBasis, PayloadError> {
    schema::validate_radar_basis(value)?;
    let basis: RadarBasis = serde_json::from_value(value.clone())?;
    validate_basis(&basis).map_err(|_invalid_basis| PayloadError::InvalidSchema)?;
    validate_map_counts(&basis.source.map_counts, basis.source.match_count)?;
    if basis.source.map_master_ids
        != basis
            .source
            .map_counts
            .iter()
            .map(|item| item.map_master_id.clone())
            .collect::<Vec<_>>()
    {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(basis)
}

/// Decodes evaluation cells and checks scores against the supplied immutable basis.
///
/// # Errors
///
/// Rejects mixed criteria, invented missing values, inconsistent quality, and invalid points.
pub fn radar_evaluation_from_payload(
    value: &Value,
    basis: Option<&RadarBasis>,
) -> Result<RadarEvaluation, PayloadError> {
    schema::validate_radar_evaluation(value)?;
    let evaluation: RadarEvaluation = serde_json::from_value(value.clone())?;
    validate_evaluation(&evaluation, basis)?;
    Ok(evaluation)
}

/// Decodes the admin-visible candidate without exposing its complete source snapshot.
///
/// # Errors
///
/// Rejects a candidate whose application basis differs from its displayed distributions.
pub fn radar_candidate_from_payload(value: &Value) -> Result<RadarCandidateSummary, PayloadError> {
    schema::validate_radar_candidate(value)?;
    let candidate: RadarCandidateSummary = serde_json::from_value(value.clone())?;
    validate_map_counts(
        &candidate.source_summary.map_counts,
        candidate.source_summary.match_count,
    )?;
    let eligible = candidate.source_summary.match_count >= RADAR_MINIMUM_MATCHES
        && candidate.source_summary.held_event_count >= RADAR_MINIMUM_EVENTS;
    let expected_windows = if eligible {
        candidate.source_summary.match_count.saturating_sub(19)
    } else {
        0
    };
    if candidate.window_count != expected_windows
        || candidate.values_per_axis != expected_windows * 4
    {
        return Err(PayloadError::InvalidSchema);
    }
    if candidate
        .axes
        .iter()
        .map(|axis| axis.axis_id)
        .ne(RadarAxis::ALL)
    {
        return Err(PayloadError::InvalidSchema);
    }
    if let Some(basis) = &candidate.basis {
        validate_basis(basis).map_err(|_invalid_basis| PayloadError::InvalidSchema)?;
        if basis.source != candidate.source_summary
            || candidate
                .axes
                .iter()
                .zip(&basis.axes)
                .any(|(candidate_axis, basis_axis)| {
                    !candidate_axis.unavailable_reasons.is_empty()
                        || candidate_axis
                            .thresholds
                            .map(|values| values.map(f64::to_bits))
                            != Some(basis_axis.thresholds.map(f64::to_bits))
                        || candidate_axis.q10.map(f64::to_bits) != Some(basis_axis.q10.to_bits())
                        || candidate_axis.median.map(f64::to_bits)
                            != Some(basis_axis.median.to_bits())
                        || candidate_axis.q90.map(f64::to_bits) != Some(basis_axis.q90.to_bits())
                })
        {
            return Err(PayloadError::InvalidSchema);
        }
    } else if candidate
        .axes
        .iter()
        .all(|axis| axis.unavailable_reasons.is_empty() || axis.thresholds.is_some())
    {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(candidate)
}

/// Decodes bounded monitoring output. Acknowledgement and notification state are runtime-owned.
///
/// # Errors
///
/// Rejects inconsistent block sizes and duplicate reasons or evidence identities.
pub fn radar_monitoring_from_payload(value: &Value) -> Result<RadarMonitoring, PayloadError> {
    schema::validate_radar_monitoring(value)?;
    let monitoring: RadarMonitoring = serde_json::from_value(value.clone())?;
    if monitoring.post_source_match_count
        != monitoring.completed_window_count * 20 + monitoring.pending_match_count
        || monitoring.evaluated_held_event_count > monitoring.evaluated_match_count
        || monitoring
            .reasons
            .iter()
            .map(|reason| reason.evidence_checksum.as_str())
            .collect::<BTreeSet<_>>()
            .len()
            != monitoring.reasons.len()
    {
        return Err(PayloadError::InvalidSchema);
    }
    match monitoring.status {
        RadarMonitoringStatus::BasisUnavailable => {
            if !monitoring.latest_windows.is_empty() || monitoring.post_source_match_count != 0 {
                return Err(PayloadError::InvalidSchema);
            }
        }
        RadarMonitoringStatus::InsufficientMatches => {
            if monitoring.completed_window_count >= 2
                || !monitoring.latest_windows.is_empty()
                || monitoring.evaluated_match_count != 0
            {
                return Err(PayloadError::InvalidSchema);
            }
        }
        RadarMonitoringStatus::InsufficientEvents | RadarMonitoringStatus::Ready => {
            if monitoring.latest_windows.len() != 2
                || monitoring.completed_window_count < 2
                || monitoring.evaluated_match_count != 40
                || (monitoring.evaluated_held_event_count >= 8)
                    != (monitoring.status == RadarMonitoringStatus::Ready)
            {
                return Err(PayloadError::InvalidSchema);
            }
        }
    }
    Ok(monitoring)
}

pub(super) fn validate_aggregate(
    value: &Value,
    member_ids: &[&str],
    match_count: u64,
    is_overall: bool,
) -> Result<Option<(String, String)>, PayloadError> {
    let aggregate: RadarAggregate = serde_json::from_value(value.clone())?;
    if let Some(published) = &aggregate.basis
        && (published.basis_id.is_empty()
            || published.checksum
                != published
                    .basis
                    .checksum()
                    .map_err(|_canonical| PayloadError::InvalidSchema)?)
    {
        return Err(PayloadError::InvalidSchema);
    }
    validate_evaluation(
        &aggregate.evaluation,
        aggregate.basis.as_ref().map(|published| &published.basis),
    )?;
    if let Some(monitoring) = &aggregate.monitoring {
        if !is_overall
            || (monitoring.status == RadarMonitoringStatus::BasisUnavailable)
                != aggregate.basis.is_none()
        {
            return Err(PayloadError::InvalidSchema);
        }
        let monitoring_value = serde_json::to_value(monitoring)?;
        radar_monitoring_from_payload(&monitoring_value)?;
        for window in &monitoring.latest_windows {
            validate_evaluation(
                &window.evaluation,
                aggregate.basis.as_ref().map(|published| &published.basis),
            )?;
        }
    }
    if u64::try_from(aggregate.evaluation.sample.match_count)? != match_count
        || aggregate
            .evaluation
            .players
            .iter()
            .map(|player| player.member_id.as_str())
            .ne(member_ids.iter().copied())
    {
        return Err(PayloadError::IdentityMismatch);
    }
    Ok(aggregate
        .basis
        .map(|published| (published.basis_id, published.checksum)))
}

fn validate_evaluation(
    evaluation: &RadarEvaluation,
    basis: Option<&RadarBasis>,
) -> Result<(), PayloadError> {
    if let Some(basis) = basis {
        validate_basis(basis).map_err(|_invalid_basis| PayloadError::InvalidSchema)?;
    }
    let expected_checksum = basis
        .map(RadarBasis::checksum)
        .transpose()
        .map_err(|_canonical| PayloadError::InvalidSchema)?;
    let sample = &evaluation.sample;
    let quality = if sample.match_count == 0 {
        RadarSampleQuality::NoTarget
    } else if sample.match_count < RADAR_MINIMUM_SCORING_MATCHES {
        RadarSampleQuality::Insufficient
    } else if sample.match_count < RADAR_MINIMUM_MATCHES
        || sample.held_event_count < RADAR_MINIMUM_EVENTS
    {
        RadarSampleQuality::Reference
    } else {
        RadarSampleQuality::Standard
    };
    if evaluation.definition_version != RADAR_DEFINITION_VERSION
        || evaluation.method_version != RADAR_METHOD_VERSION
        || evaluation.basis_checksum != expected_checksum
        || sample.quality != quality
        || sample.held_event_count > sample.match_count
        || (sample.match_count == 0) != sample.first_match.is_none()
        || (sample.match_count == 0) != sample.last_match.is_none()
        || sample.first_match > sample.last_match
        || (sample.match_count > 0 && sample.held_event_count == 0)
    {
        return Err(PayloadError::InvalidSchema);
    }
    validate_map_counts(&sample.map_counts, sample.match_count)?;
    let mut expected_reasons = match quality {
        RadarSampleQuality::NoTarget => vec![RadarScoreUnavailableReason::NoTarget],
        RadarSampleQuality::Insufficient => vec![RadarScoreUnavailableReason::InsufficientMatches],
        RadarSampleQuality::Reference | RadarSampleQuality::Standard => Vec::new(),
    };
    if basis.is_none() {
        expected_reasons.push(RadarScoreUnavailableReason::BasisUnavailable);
    }
    let player_ids = evaluation
        .players
        .iter()
        .map(|player| &player.member_id)
        .collect::<BTreeSet<_>>();
    if player_ids.len() != evaluation.players.len()
        || (!player_ids.is_empty() && player_ids.len() != 4)
        || (sample.match_count > 0 && player_ids.is_empty())
    {
        return Err(PayloadError::InvalidSchema);
    }
    for player in &evaluation.players {
        for (cell, axis_id) in player.axes.iter().zip(RadarAxis::ALL) {
            if cell.axis_id != axis_id
                || cell.sample_quality != quality
                || cell.score_unavailable_reasons != expected_reasons
                || cell.raw_value.is_none() != (sample.match_count == 0)
                || cell.raw_value.is_some_and(|value| {
                    !value.is_finite()
                        || (axis_id == RadarAxis::AverageRank && !(1.0..=4.0).contains(&value))
                })
            {
                return Err(PayloadError::InvalidSchema);
            }
            let expected_score = if expected_reasons.is_empty() {
                cell.raw_value
                    .zip(basis)
                    .map(|(raw, basis)| score_value(axis_id, raw, basis))
                    .transpose()
                    .map_err(|_invalid_metric| PayloadError::InvalidSchema)?
            } else {
                None
            };
            if cell.score != expected_score {
                return Err(PayloadError::InvalidSchema);
            }
        }
    }
    Ok(())
}

fn validate_map_counts(counts: &[RadarMapCount], match_count: usize) -> Result<(), PayloadError> {
    let total = counts
        .iter()
        .try_fold(0_usize, |total, map| total.checked_add(map.match_count))
        .ok_or(PayloadError::InvalidSchema)?;
    if total != match_count
        || counts
            .iter()
            .any(|map| map.match_count == 0 || map.map_master_id.is_empty())
        || counts.windows(2).any(|pair| {
            pair.first()
                .zip(pair.last())
                .is_none_or(|(first, last)| first.map_master_id >= last.map_master_id)
        })
    {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(())
}
