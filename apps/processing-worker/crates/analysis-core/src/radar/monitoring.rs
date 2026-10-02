use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::json;

use crate::{canonical::FramedSha256, model::NormalizedAnalysisInput};

use super::{
    calculation::{evaluate_matches, sample, validate_basis},
    snapshot::{snapshot, source_is_current},
    types::{
        RADAR_MINIMUM_EVENTS, RADAR_MINIMUM_MATCHES, RADAR_WINDOW_SIZE, RadarAxis, RadarBasis,
        RadarError, RadarMonitoring, RadarMonitoringStatus, RadarMonitoringWindow,
        RadarReviewReason, RadarReviewReasonKind, RadarSourceMatch, RadarSourceSnapshot,
    },
};

/// Computes title-wide review evidence without changing thresholds or acknowledging a reason.
///
/// Each reason has its own semantic checksum. In particular, adding an incomplete tail cannot
/// change high-score evidence and cannot resurrect an acknowledged proposal. An applied source
/// correction is a review reason; its saved thresholds continue to score the current records.
///
/// # Errors
///
/// Rejects incompatible bases, a mismatched saved source, and invalid current rosters.
pub fn monitor(
    input: &NormalizedAnalysisInput,
    basis: Option<&RadarBasis>,
    source: Option<&RadarSourceSnapshot>,
) -> Result<RadarMonitoring, RadarError> {
    let current = snapshot(input)?;
    let Some(basis) = basis else {
        return without_basis(&current);
    };
    validate_basis(basis)?;
    let source = source.ok_or(RadarError::InvalidSource)?;
    if basis.source != source.summary()? || basis.source.game_title_id != input.game_title_id() {
        return Err(RadarError::InvalidSource);
    }
    let basis_checksum = basis.checksum()?;
    let mut reasons = source_reasons(input, &current, source, &basis_checksum)?;
    let source_match_ids = source
        .matches
        .iter()
        .map(|item| &item.order.match_id)
        .collect::<BTreeSet<_>>();
    let last_source = basis
        .source
        .last_match
        .as_ref()
        .ok_or(RadarError::InvalidBasis)?;
    let later_matches = current
        .matches
        .iter()
        .filter(|item| {
            item.order > *last_source && !source_match_ids.contains(&item.order.match_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    let completed_window_count = later_matches.len() / RADAR_WINDOW_SIZE;
    let pending_match_count = later_matches.len() % RADAR_WINDOW_SIZE;
    if completed_window_count < 2 {
        return Ok(RadarMonitoring {
            status: RadarMonitoringStatus::InsufficientMatches,
            post_source_match_count: later_matches.len(),
            completed_window_count,
            pending_match_count,
            evaluated_match_count: 0,
            evaluated_held_event_count: 0,
            latest_windows: Vec::new(),
            reasons,
        });
    }
    let start = (completed_window_count - 2) * RADAR_WINDOW_SIZE;
    let end = completed_window_count * RADAR_WINDOW_SIZE;
    let latest = later_matches
        .get(start..end)
        .ok_or(RadarError::InvalidSource)?;
    let sample = sample(latest);
    let windows = latest
        .as_chunks::<RADAR_WINDOW_SIZE>()
        .0
        .iter()
        .map(|matches| {
            let first = matches.first().ok_or(RadarError::InvalidSource)?;
            let last = matches.last().ok_or(RadarError::InvalidSource)?;
            let member_ids = first
                .players
                .iter()
                .map(|player| player.member_id.clone())
                .collect::<Vec<_>>();
            Ok(RadarMonitoringWindow {
                first_match: first.order.clone(),
                last_match: last.order.clone(),
                evaluation: evaluate_matches(matches, &member_ids, Some(basis))?,
            })
        })
        .collect::<Result<Vec<_>, RadarError>>()?;
    let ready = sample.held_event_count >= RADAR_MINIMUM_EVENTS;
    if ready && let Some(reason) = concentration_reason(&windows, latest, &basis_checksum)? {
        reasons.push(reason);
    }
    Ok(RadarMonitoring {
        status: if ready {
            RadarMonitoringStatus::Ready
        } else {
            RadarMonitoringStatus::InsufficientEvents
        },
        post_source_match_count: later_matches.len(),
        completed_window_count,
        pending_match_count,
        evaluated_match_count: sample.match_count,
        evaluated_held_event_count: sample.held_event_count,
        latest_windows: windows,
        reasons,
    })
}

fn concentration_reason(
    windows: &[RadarMonitoringWindow],
    latest: &[RadarSourceMatch],
    basis_checksum: &str,
) -> Result<Option<RadarReviewReason>, RadarError> {
    let axis_ids = RadarAxis::ALL
        .into_iter()
        .filter(|axis_id| {
            windows.iter().all(|window| {
                window
                    .evaluation
                    .players
                    .iter()
                    .filter(|player| {
                        player.axes.iter().any(|axis| {
                            axis.axis_id == *axis_id && axis.score.is_some_and(|score| score >= 9)
                        })
                    })
                    .count()
                    >= 3
            })
        })
        .collect::<Vec<_>>();
    if axis_ids.is_empty() {
        return Ok(None);
    }
    Ok(Some(RadarReviewReason {
        kind: RadarReviewReasonKind::HighScoreConcentration,
        evidence_checksum: checksum(&json!({
            "kind": "high_score_concentration",
            "basisChecksum": basis_checksum,
            "matches": latest,
            "axisIds": axis_ids,
        }))?,
        axis_ids,
        map_master_ids: Vec::new(),
    }))
}

fn without_basis(current: &RadarSourceSnapshot) -> Result<RadarMonitoring, RadarError> {
    let sample = sample(&current.matches);
    let eligible = sample.match_count >= RADAR_MINIMUM_MATCHES
        && sample.held_event_count >= RADAR_MINIMUM_EVENTS;
    let reasons = if eligible {
        vec![RadarReviewReason {
            kind: RadarReviewReasonKind::InitialBasisEligible,
            axis_ids: Vec::new(),
            map_master_ids: Vec::new(),
            // Further record additions do not make the same initial eligibility a new reason.
            evidence_checksum: checksum(&json!({
                "kind": "initial_basis_eligible",
                "gameTitleId": current.game_title_id,
            }))?,
        }]
    } else {
        Vec::new()
    };
    Ok(RadarMonitoring {
        status: RadarMonitoringStatus::BasisUnavailable,
        post_source_match_count: 0,
        completed_window_count: 0,
        pending_match_count: 0,
        evaluated_match_count: sample.match_count,
        evaluated_held_event_count: sample.held_event_count,
        latest_windows: Vec::new(),
        reasons,
    })
}

fn source_reasons(
    input: &NormalizedAnalysisInput,
    current: &RadarSourceSnapshot,
    source: &RadarSourceSnapshot,
    basis_checksum: &str,
) -> Result<Vec<RadarReviewReason>, RadarError> {
    let mut reasons = Vec::new();
    if !source_is_current(source, input)? {
        let source_ids = source
            .matches
            .iter()
            .map(|item| &item.order.match_id)
            .collect::<BTreeSet<_>>();
        let current_source = current
            .matches
            .iter()
            .filter(|item| source_ids.contains(&item.order.match_id))
            .collect::<Vec<_>>();
        reasons.push(RadarReviewReason {
            kind: RadarReviewReasonKind::SourceChanged,
            axis_ids: Vec::new(),
            map_master_ids: Vec::new(),
            evidence_checksum: checksum(&json!({
                "kind": "source_changed",
                "basisChecksum": basis_checksum,
                "currentSourceMatches": current_source,
            }))?,
        });
    }
    let source_maps = source
        .matches
        .iter()
        .map(|item| &item.map_master_id)
        .collect::<BTreeSet<_>>();
    let new_maps = current
        .matches
        .iter()
        .filter(|item| !source_maps.contains(&item.map_master_id))
        .map(|item| item.map_master_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if !new_maps.is_empty() {
        reasons.push(RadarReviewReason {
            kind: RadarReviewReasonKind::NewMap,
            axis_ids: Vec::new(),
            evidence_checksum: checksum(&json!({
                "kind": "new_map",
                "basisChecksum": basis_checksum,
                "mapMasterIds": new_maps,
            }))?,
            map_master_ids: new_maps,
        });
    }
    Ok(reasons)
}

fn checksum(value: &impl Serialize) -> Result<String, RadarError> {
    let mut digest = FramedSha256::new();
    digest.update_serialized(value, &mut Vec::new())?;
    Ok(digest.finalize())
}
