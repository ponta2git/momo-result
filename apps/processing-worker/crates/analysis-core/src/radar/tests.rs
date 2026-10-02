use crate::{
    contract::ScopeRef,
    model::{AnalysisInput, IncidentCounts, NormalizedAnalysisInput, PlayerMatchInput},
};

use super::{calculation::thresholds, *};

fn input(match_count: i32) -> AnalysisInput {
    let rows = (0..match_count)
        .flat_map(|index| {
            (1..=4).map(move |player| PlayerMatchInput {
                match_id: format!("match-{index:04}"),
                match_revision: 1,
                played_at: format!("2026-01-01T00:{:02}:{:02}.000000Z", index / 60, index % 60),
                held_event_id: format!("event-{:04}", index / 5),
                match_no_in_event: index % 5 + 1,
                season_master_id: if index < 20 { "winter" } else { "summer" }.to_owned(),
                map_master_id: if index % 2 == 0 { "east" } else { "west" }.to_owned(),
                owner_member_id: "member-1".to_owned(),
                member_id: format!("member-{player}"),
                play_order: player,
                rank: player,
                total_assets_man_yen: index * 10 + (player - 1) * 100 - 10,
                revenue_man_yen: index * 10 + (player - 1) * 100,
                incidents: IncidentCounts::default(),
            })
        })
        .collect();
    AnalysisInput {
        game_title_id: "title".to_owned(),
        input_revision: 1,
        player_matches: rows,
    }
}

fn normalized(input: AnalysisInput) -> NormalizedAnalysisInput {
    input
        .try_into_normalized()
        .unwrap_or_else(|error| panic!("invalid fixture: {error}"))
}

fn hand_basis() -> RadarBasis {
    let source =
        snapshot(&normalized(input(40))).unwrap_or_else(|error| panic!("snapshot: {error}"));
    let axes = RadarAxis::ALL.map(|axis_id| {
        let (q10, median, q90) = if axis_id == RadarAxis::AverageRank {
            (4.0, 2.5, 1.0)
        } else {
            (100.0, 200.0, 300.0)
        };
        RadarAxisBasis {
            axis_id,
            q10,
            median,
            q90,
            thresholds: thresholds(axis_id, q10, median, q90)
                .unwrap_or_else(|| panic!("valid hand basis")),
        }
    });
    RadarBasis {
        definition_version: RADAR_DEFINITION_VERSION.to_owned(),
        method_version: RADAR_METHOD_VERSION.to_owned(),
        window_size: 20,
        window_stride: 1,
        source: source
            .summary()
            .unwrap_or_else(|error| panic!("source summary: {error}")),
        axes,
    }
}

fn evaluate(input: AnalysisInput, basis: Option<&RadarBasis>) -> RadarEvaluation {
    evaluate_scope(&normalized(input), &ScopeRef::Overall, basis)
        .unwrap_or_else(|error| panic!("evaluate: {error}"))
}

fn run_monitor(input: AnalysisInput) -> RadarMonitoring {
    let basis = hand_basis();
    let source =
        snapshot(&normalized(self::input(40))).unwrap_or_else(|error| panic!("source: {error}"));
    monitor(&normalized(input), Some(&basis), Some(&source))
        .unwrap_or_else(|error| panic!("monitor: {error}"))
}

fn concentration(result: &RadarMonitoring) -> Option<&RadarReviewReason> {
    result
        .reasons
        .iter()
        .find(|reason| reason.kind == RadarReviewReasonKind::HighScoreConcentration)
}

fn high_results(match_count: i32) -> AnalysisInput {
    let mut result = input(match_count);
    for row in result.player_matches.iter_mut().skip(40 * 4) {
        row.total_assets_man_yen = 10_000;
        row.revenue_man_yen = 10_000;
    }
    result
}

#[test]
fn raw_axes_use_complete_selected_history_and_linear_quantiles() {
    let result = evaluate(input(4), None);
    let player = result
        .players
        .first()
        .unwrap_or_else(|| panic!("first player"));
    let actual = player
        .axes
        .iter()
        .map(|cell| cell.raw_value)
        .collect::<Vec<_>>();
    assert_eq!(
        actual,
        vec![
            Some(1.0),
            Some(27.0),
            Some(15.0),
            Some(-7.0),
            Some(5.0),
            Some(17.0)
        ]
    );
    assert_eq!(
        player
            .axes
            .iter()
            .map(|cell| cell.axis_id)
            .collect::<Vec<_>>(),
        RadarAxis::ALL
    );
    assert_eq!(result.sample.match_count, 4);
    assert_eq!(result.sample.held_event_count, 1);
    assert_eq!(
        result
            .sample
            .map_counts
            .iter()
            .map(|item| item.match_count)
            .sum::<usize>(),
        4
    );
    assert!(
        player.axes.iter().all(|cell| cell.score.is_none()),
        "a missing basis must never generate scores"
    );
}

#[test]
fn spread_boundaries_match_the_hand_calculated_example_and_include_equality() {
    let basis = hand_basis();
    let expected = [40.0, 80.0, 120.0, 160.0, 200.0, 240.0, 280.0, 320.0, 360.0];
    let axis = basis
        .axes
        .iter()
        .find(|axis| axis.axis_id == RadarAxis::RevenueAverage)
        .unwrap_or_else(|| panic!("revenue axis"));
    assert_eq!(
        axis.thresholds.map(f64::to_bits),
        expected.map(f64::to_bits)
    );
    for (threshold, score) in expected.into_iter().zip(2_u8..=10) {
        assert_eq!(
            score_value(axis.axis_id, threshold.next_down(), &basis).ok(),
            Some(score - 1)
        );
        assert_eq!(
            score_value(axis.axis_id, threshold, &basis).ok(),
            Some(score)
        );
        assert_eq!(
            score_value(axis.axis_id, threshold.next_up(), &basis).ok(),
            Some(score)
        );
    }
    assert_eq!(score_value(axis.axis_id, -10.0, &basis).ok(), Some(1));
    assert_eq!(score_value(axis.axis_id, 0.0, &basis).ok(), Some(1));
    assert_eq!(score_value(axis.axis_id, 300.0, &basis).ok(), Some(8));
    assert_eq!(score_value(axis.axis_id, 1_000.0, &basis).ok(), Some(10));
}

#[test]
fn average_rank_is_reversed_and_ten_remains_theoretically_reachable() {
    let basis = hand_basis();
    assert_eq!(
        score_value(RadarAxis::AverageRank, 1.0, &basis).ok(),
        Some(10)
    );
    assert_eq!(
        score_value(RadarAxis::AverageRank, 2.5, &basis).ok(),
        Some(6)
    );
    for pair in [1.0, 1.5, 2.0, 2.5, 3.0, 4.0].windows(2) {
        let first = pair
            .first()
            .and_then(|value| score_value(RadarAxis::AverageRank, *value, &basis).ok());
        let last = pair
            .last()
            .and_then(|value| score_value(RadarAxis::AverageRank, *value, &basis).ok());
        assert!(first >= last, "better saved ranks must not score lower");
    }
    assert!(
        score_value(RadarAxis::AverageRank, 0.9, &basis).is_err(),
        "invalid ranks are rejected"
    );
    assert!(
        score_value(RadarAxis::RevenueAverage, f64::NAN, &basis).is_err(),
        "non-finite input is rejected"
    );
}

#[test]
fn scoring_and_reference_conditions_are_independent_of_basis_availability() {
    let basis = hand_basis();
    for (count, quality, scores) in [
        (1, RadarSampleQuality::Insufficient, false),
        (2, RadarSampleQuality::Insufficient, false),
        (3, RadarSampleQuality::Reference, true),
        (39, RadarSampleQuality::Reference, true),
        (40, RadarSampleQuality::Standard, true),
    ] {
        let result = evaluate(input(count), Some(&basis));
        assert_eq!(result.sample.quality, quality);
        assert!(
            result
                .players
                .iter()
                .flat_map(|player| &player.axes)
                .all(|cell| cell.score.is_some() == scores),
            "score presence must follow the record count"
        );
    }
    let mut seven_events = input(40);
    for (index, row) in seven_events.player_matches.iter_mut().enumerate() {
        row.held_event_id = format!("event-{}", index / 4 % 7);
    }
    assert_eq!(
        evaluate(seven_events, Some(&basis)).sample.quality,
        RadarSampleQuality::Reference
    );
    let missing = evaluate(input(1), None);
    assert!(
        missing
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|cell| cell.score_unavailable_reasons
                == [
                    RadarScoreUnavailableReason::InsufficientMatches,
                    RadarScoreUnavailableReason::BasisUnavailable
                ]),
        "both sample and basis reasons remain visible"
    );
}

#[test]
fn empty_scope_keeps_known_players_and_does_not_invent_zero_values() {
    let input = normalized(input(40));
    let scope = ScopeRef::SeasonMap {
        season_master_id: "missing".to_owned(),
        map_master_id: "east".to_owned(),
    };
    let result =
        evaluate_scope(&input, &scope, None).unwrap_or_else(|error| panic!("empty scope: {error}"));
    assert_eq!(result.players.len(), 4);
    assert_eq!(result.sample.quality, RadarSampleQuality::NoTarget);
    assert_eq!(result.sample.first_match, None);
    assert!(
        result
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|cell| cell.raw_value.is_none() && cell.score.is_none()),
        "empty axes remain absent rather than zero"
    );
}

#[test]
fn generation_pools_four_players_from_overlapping_windows_across_scope_boundaries() {
    let candidate = generate_candidate(&normalized(input(40)))
        .unwrap_or_else(|error| panic!("candidate: {error}"));
    assert_eq!(candidate.window_count, 21);
    assert_eq!(candidate.values_per_axis, 84);
    assert_eq!(candidate.source_summary.match_count, 40);
    assert_eq!(candidate.source_summary.held_event_count, 8);
    assert!(
        candidate.basis.is_some(),
        "all six distributions are non-degenerate"
    );
    let short = generate_candidate(&normalized(input(39)))
        .unwrap_or_else(|error| panic!("short candidate: {error}"));
    assert_eq!(short.window_count, 0);
    assert!(
        short.basis.is_none(),
        "40 distinct matches are required, not player rows"
    );
    assert!(
        short.axes.iter().all(|axis| axis
            .unavailable_reasons
            .contains(&RadarCandidateUnavailableReason::InsufficientMatches)),
        "shortfall is explicit on every axis"
    );
}

#[test]
fn a_degenerate_axis_blocks_the_whole_candidate_without_filling_a_width() {
    let mut data = input(40);
    for row in &mut data.player_matches {
        row.revenue_man_yen = 0;
    }
    let candidate =
        generate_candidate(&normalized(data)).unwrap_or_else(|error| panic!("candidate: {error}"));
    assert!(
        candidate.basis.is_none(),
        "one invalid distribution must block partial application"
    );
    for axis in candidate.axes.iter().filter(|axis| {
        matches!(
            axis.axis_id,
            RadarAxis::RevenueP90 | RadarAxis::RevenueAverage
        )
    }) {
        assert_eq!(axis.q10, Some(0.0));
        assert_eq!(axis.median, Some(0.0));
        assert_eq!(axis.q90, Some(0.0));
        assert_eq!(axis.thresholds, None);
        assert_eq!(
            axis.unavailable_reasons,
            [RadarCandidateUnavailableReason::DegenerateDistribution]
        );
    }
}

#[test]
fn fixed_basis_is_deterministic_after_input_shuffle_and_json_round_trip() {
    let data = input(40);
    let first = generate_candidate(&normalized(data.clone()))
        .unwrap_or_else(|error| panic!("candidate: {error}"));
    let mut shuffled = data;
    shuffled.player_matches.reverse();
    let second = generate_candidate(&normalized(shuffled))
        .unwrap_or_else(|error| panic!("candidate: {error}"));
    assert_eq!(first, second);
    assert_eq!(
        first
            .basis
            .as_ref()
            .and_then(|basis| basis.candidate_summary().ok()),
        Some(first.summary()),
        "restoring projects the exact saved distribution without regeneration"
    );
    let basis = first.basis.unwrap_or_else(|| panic!("basis"));
    let encoded = serde_json::to_string(&basis).unwrap_or_else(|error| panic!("encode: {error}"));
    let decoded: RadarBasis =
        serde_json::from_str(&encoded).unwrap_or_else(|error| panic!("decode: {error}"));
    assert_eq!(basis, decoded);
    assert!(
        validate_basis(&decoded).is_ok(),
        "saved thresholds must still validate exactly"
    );
    let saved = basis
        .checksum()
        .unwrap_or_else(|error| panic!("checksum: {error}"));
    let _current = evaluate(input(60), Some(&basis));
    assert_eq!(basis.checksum().ok(), Some(saved));
    let mut corrupt = basis;
    corrupt.axes.swap(0, 1);
    assert!(
        validate_basis(&corrupt).is_err(),
        "axis order is part of the semantic contract"
    );
}

#[test]
fn source_validity_ignores_irrelevant_revisions_but_detects_result_membership_and_deletion() {
    let source = snapshot(&normalized(input(40))).unwrap_or_else(|error| panic!("source: {error}"));
    assert_eq!(
        source_is_current(&source, &normalized(input(60))).ok(),
        Some(true)
    );
    let mut unrelated = input(40);
    for row in &mut unrelated.player_matches {
        row.match_revision += 1;
        row.incidents.destination += 1;
    }
    assert_eq!(
        source_is_current(&source, &normalized(unrelated)).ok(),
        Some(true)
    );
    let mut correction = input(40);
    if let Some(row) = correction.player_matches.first_mut() {
        row.revenue_man_yen += 1;
    }
    assert_eq!(
        source_is_current(&source, &normalized(correction)).ok(),
        Some(false)
    );
    let mut moved = input(40);
    for row in moved.player_matches.iter_mut().take(4) {
        row.season_master_id = "other".to_owned();
    }
    assert_eq!(
        source_is_current(&source, &normalized(moved)).ok(),
        Some(false)
    );
    assert_eq!(
        source_is_current(&source, &normalized(input(39))).ok(),
        Some(false)
    );
}

#[test]
fn monitor_uses_two_complete_nonoverlapping_blocks_and_ignores_tail_for_evidence() {
    let single = run_monitor(high_results(60));
    assert_eq!(single.status, RadarMonitoringStatus::InsufficientMatches);
    assert!(
        concentration(&single).is_none(),
        "one high block is not a review reason"
    );
    let result = run_monitor(high_results(80));
    assert_eq!(result.status, RadarMonitoringStatus::Ready);
    assert_eq!(result.evaluated_match_count, 40);
    assert_eq!(result.evaluated_held_event_count, 8);
    let reason = concentration(&result).unwrap_or_else(|| panic!("two high blocks"));
    assert_eq!(reason.axis_ids.len(), 5);
    let tail = run_monitor(high_results(99));
    assert_eq!(tail.pending_match_count, 19);
    assert_eq!(concentration(&tail), Some(reason));
    let next = run_monitor(high_results(100));
    assert_ne!(
        concentration(&next).map(|next_reason| &next_reason.evidence_checksum),
        Some(&reason.evidence_checksum)
    );
    assert!(
        result
            .latest_windows
            .iter()
            .all(|window| window.evaluation.sample.quality == RadarSampleQuality::Reference),
        "monitoring windows never upgrade ordinary quality"
    );
}

#[test]
fn monitor_does_not_combine_different_axes_or_two_players_or_too_few_events() {
    let mut different_axes = input(80);
    for (index, row) in different_axes
        .player_matches
        .iter_mut()
        .enumerate()
        .skip(40 * 4)
    {
        row.revenue_man_yen = if index < 60 * 4 { 10_000 } else { 200 };
        row.total_assets_man_yen = if index < 60 * 4 { 200 } else { 10_000 };
    }
    assert!(
        concentration(&run_monitor(different_axes)).is_none(),
        "high scores must persist on the same axis"
    );
    let mut two_players = high_results(80);
    for row in two_players
        .player_matches
        .iter_mut()
        .skip(40 * 4)
        .filter(|row| row.play_order > 2)
    {
        row.revenue_man_yen = 200;
        row.total_assets_man_yen = 200;
    }
    assert!(
        concentration(&run_monitor(two_players)).is_none(),
        "at least three players are required in each block"
    );
    let mut one_event = high_results(80);
    for row in one_event.player_matches.iter_mut().skip(40 * 4) {
        row.held_event_id = "post-source-event".to_owned();
    }
    let result = run_monitor(one_event);
    assert_eq!(result.status, RadarMonitoringStatus::InsufficientEvents);
    assert!(
        concentration(&result).is_none(),
        "forty matches across one event do not satisfy eight events"
    );
}

#[test]
fn source_correction_and_new_map_are_separate_reasons_while_saved_scores_stay_available() {
    let mut data = input(41);
    if let Some(row) = data.player_matches.first_mut() {
        row.total_assets_man_yen -= 1;
    }
    for row in data.player_matches.iter_mut().skip(40 * 4) {
        row.map_master_id = "new-map".to_owned();
    }
    let result = run_monitor(data.clone());
    assert_eq!(
        result
            .reasons
            .iter()
            .map(|reason| reason.kind)
            .collect::<Vec<_>>(),
        [
            RadarReviewReasonKind::SourceChanged,
            RadarReviewReasonKind::NewMap
        ]
    );
    let evaluation = evaluate(data, Some(&hand_basis()));
    assert!(
        evaluation
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|cell| cell.score.is_some()),
        "an applied source correction must not blank saved-basis scores"
    );
}

#[test]
fn initial_eligibility_does_not_repeat_for_each_added_record() {
    let short = monitor(&normalized(input(39)), None, None)
        .unwrap_or_else(|error| panic!("monitor: {error}"));
    assert!(
        short.reasons.is_empty(),
        "short records do not request initial basis generation"
    );
    let eligible = monitor(&normalized(input(40)), None, None)
        .unwrap_or_else(|error| panic!("monitor: {error}"));
    let later = monitor(&normalized(input(60)), None, None)
        .unwrap_or_else(|error| panic!("monitor: {error}"));
    assert_eq!(eligible.reasons, later.reasons);
}

#[test]
fn public_payload_owner_rejects_mixed_basis_and_invented_scores() {
    let basis = hand_basis();
    let value = serde_json::to_value(evaluate(input(40), Some(&basis)))
        .unwrap_or_else(|error| panic!("encode evaluation: {error}"));
    assert!(
        crate::payload::radar_evaluation_from_payload(&value, Some(&basis)).is_ok(),
        "valid evaluation must pass the full owner"
    );
    assert!(
        crate::payload::radar_evaluation_from_payload(&value, None).is_err(),
        "scores cannot claim no basis"
    );
    let mut invented = value;
    if let Some(score) = invented.pointer_mut("/players/0/axes/0/score") {
        *score = serde_json::json!(1);
    }
    assert!(
        crate::payload::radar_evaluation_from_payload(&invented, Some(&basis)).is_err(),
        "shape-valid but wrong scores must fail"
    );
    let candidate = generate_candidate(&normalized(input(40)))
        .unwrap_or_else(|error| panic!("candidate: {error}"));
    let candidate_value = serde_json::to_value(candidate.summary())
        .unwrap_or_else(|error| panic!("candidate JSON: {error}"));
    assert!(
        crate::payload::radar_candidate_from_payload(&candidate_value).is_ok(),
        "candidate and derived application basis must match"
    );
}

#[test]
fn normalized_input_binds_the_published_identity_and_clears_old_monitoring_on_basis_change() {
    let basis = hand_basis();
    let checksum = basis
        .checksum()
        .unwrap_or_else(|error| panic!("basis checksum: {error}"));
    let published = RadarPublishedBasis {
        basis_id: "basis-a".to_owned(),
        checksum,
        basis,
    };
    let normalized = normalized(input(40))
        .with_radar_basis(Some(published.clone()))
        .unwrap_or_else(|error| panic!("attach basis: {error}"));
    assert_eq!(normalized.radar_basis(), Some(&published));
    assert_eq!(normalized.scope_refs().count(), 9);
    let monitored = normalized.with_radar_monitoring(run_monitor(input(40)));
    assert!(
        monitored.radar_monitoring().is_some(),
        "same-snapshot monitoring is retained"
    );
    let cleared = monitored
        .with_radar_basis(None)
        .unwrap_or_else(|error| panic!("clear basis: {error}"));
    assert!(
        cleared.radar_monitoring().is_none(),
        "derived monitoring cannot survive a different basis"
    );
    let mut corrupt = published;
    corrupt.checksum = "sha256:invalid".to_owned();
    assert!(
        self::normalized(input(40))
            .with_radar_basis(Some(corrupt))
            .is_err(),
        "a database id cannot substitute for content validation"
    );
}

#[test]
fn empty_public_radar_fixture_matches_the_calculator() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../../docs/schemas/fixtures/series-analysis/aggregate-payload-v6.json"
    ))
    .unwrap_or_else(|error| panic!("fixture: {error}"));
    let result = RadarAggregate {
        basis: None,
        monitoring: None,
        evaluation: evaluate(input(0), None),
    };
    assert_eq!(
        fixture.get("playerRadar"),
        serde_json::to_value(result).ok().as_ref()
    );
}

#[test]
fn checked_in_radar_fixtures_match_the_pure_calculator() {
    use std::path::Path;

    let candidate = generate_candidate(&normalized(input(40)))
        .unwrap_or_else(|error| panic!("candidate: {error}"));
    let basis = candidate
        .basis
        .as_ref()
        .unwrap_or_else(|| panic!("synthetic basis must be non-degenerate"));
    let evaluation = evaluate(input(40), Some(basis));
    let monitoring = monitor(
        &normalized(high_results(80)),
        Some(basis),
        Some(&candidate.source),
    )
    .unwrap_or_else(|error| panic!("monitoring: {error}"));
    let fixtures = [
        ("radar-basis-v1.json", serde_json::to_value(basis)),
        (
            "radar-candidate-v1.json",
            serde_json::to_value(candidate.summary()),
        ),
        ("radar-evaluation-v1.json", serde_json::to_value(evaluation)),
        ("radar-monitoring-v1.json", serde_json::to_value(monitoring)),
        (
            "radar-source-v1.json",
            serde_json::to_value(&candidate.source),
        ),
    ];
    let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../docs/schemas/fixtures/series-analysis");
    for (name, value) in fixtures {
        let value = value.unwrap_or_else(|error| panic!("{name}: {error}"));
        let mut encoded = serde_json::to_string_pretty(&value)
            .unwrap_or_else(|error| panic!("{name} encoding: {error}"));
        encoded.push('\n');
        let path = directory.join(name);
        if std::env::var_os("UPDATE_SERIES_PLAYER_RADAR_FIXTURES").is_some() {
            std::fs::write(&path, &encoded)
                .unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
        }
        let saved = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        assert_eq!(
            saved, encoded,
            "{name} drifted; regenerate with UPDATE_SERIES_PLAYER_RADAR_FIXTURES=1 cargo test -p momo-analysis-core checked_in_radar_fixtures_match_the_pure_calculator"
        );
    }
}
