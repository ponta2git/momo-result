use super::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScoringCase {
    axis_id: RadarAxis,
    raw_value: f64,
    score: u8,
}

#[derive(serde::Deserialize)]
struct ScoringFixture {
    input: RadarManualInput,
    cases: Vec<ScoringCase>,
}

fn fixture() -> ScoringFixture {
    serde_json::from_str(include_str!(
        "../../../../../../../docs/schemas/fixtures/series-analysis/radar-manual-scoring-v1.json"
    ))
    .unwrap_or_else(|error| panic!("manual fixture: {error}"))
}

fn manual_basis(match_count: i32) -> Option<RadarBasis> {
    create_manual_basis(
        &normalized(input(match_count)),
        &hand_basis(),
        "generated-source",
        Some("generated-candidate"),
        &fixture().input,
    )
    .unwrap_or_else(|error| panic!("manual basis: {error}"))
}

#[test]
fn manual_boundaries_match_the_shared_keyboard_preview_fixture() {
    let basis = manual_basis(40).unwrap_or_else(|| panic!("nonempty comparison"));
    for case in fixture().cases {
        assert_eq!(
            score_value(case.axis_id, case.raw_value, &basis).ok(),
            Some(case.score),
            "boundary {:?} at {:?}",
            case.axis_id,
            case.raw_value,
        );
    }
    assert!(
        basis
            .axes
            .iter()
            .all(|axis| axis.q10.is_none() && axis.median.is_none() && axis.q90.is_none()),
        "manual values do not claim distribution quantiles"
    );
    let encoded = serde_json::to_value(&basis).unwrap_or_else(|error| panic!("encode: {error}"));
    assert_eq!(
        crate::payload::radar_basis_from_payload(&encoded).ok(),
        Some(basis.clone())
    );
    let summary = basis
        .candidate_summary()
        .unwrap_or_else(|error| panic!("summary: {error}"));
    assert_eq!(summary.window_count, 0);
    assert_eq!(summary.values_per_axis, 0);
    let summary_encoded =
        serde_json::to_value(&summary).unwrap_or_else(|error| panic!("encode: {error}"));
    assert_eq!(
        crate::payload::radar_candidate_from_payload(&summary_encoded).ok(),
        Some(summary)
    );
}

#[test]
fn manual_validation_does_not_relax_generated_formula_or_accept_unordered_input() {
    let mut generated = hand_basis();
    if let Some(value) = generated
        .axes
        .last_mut()
        .and_then(|axis| axis.thresholds.last_mut())
    {
        *value += 1.0;
    }
    assert!(
        validate_basis(&generated).is_err(),
        "generated formula remains exact"
    );

    let entered = fixture().input;
    for invalid_thresholds in [
        [1.0; 9],
        [4.2, 3.8, 3.4, 3.0, 2.6, 2.2, 1.8, 1.0, 1.4],
        [4.2, 3.8, 3.4, 3.0, 2.6, 2.2, 1.8, 1.4, 0.9],
        [f64::INFINITY, 3.8, 3.4, 3.0, 2.6, 2.2, 1.8, 1.4, 1.0],
    ] {
        let mut invalid = entered.clone();
        if let Some(axis) = invalid.axes.first_mut() {
            axis.thresholds = invalid_thresholds;
        }
        assert!(
            validate_manual_input(&invalid).is_err(),
            "malformed rank boundaries rejected"
        );
    }
    let mut wrong_order = entered;
    wrong_order.axes.swap(0, 1);
    assert!(
        validate_manual_input(&wrong_order).is_err(),
        "axis order is fixed"
    );
    let mut forged_distribution = manual_basis(3).unwrap_or_else(|| panic!("nonempty comparison"));
    if let Some(axis) = forged_distribution.axes.first_mut() {
        axis.q10 = Some(4.0);
    }
    assert!(
        validate_basis(&forged_distribution).is_err(),
        "manual criteria cannot invent generation quantiles"
    );
}

#[test]
fn manual_monitoring_starts_at_its_first_comparison_and_allows_small_samples() {
    assert!(
        manual_basis(0).is_none(),
        "empty comparisons do not establish a basis"
    );
    let small = manual_basis(3).unwrap_or_else(|| panic!("three-match comparison"));
    assert_eq!(
        small.source.match_count, 40,
        "original generation lineage is retained"
    );
    assert_eq!(
        small.monitoring_source().match_count,
        3,
        "manual criteria do not reapply generation minimums"
    );
    let before = evaluate(input(3), None);
    let after = evaluate(input(3), Some(&small));
    assert!(
        before
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|axis| axis.score.is_none()),
        "initial before stays unscored"
    );
    assert!(
        after
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|axis| axis.score.is_some()),
        "initial after uses manual criteria"
    );

    let basis = manual_basis(45).unwrap_or_else(|| panic!("nonempty comparison"));
    let source = snapshot(&normalized(input(45))).unwrap_or_else(|error| panic!("source: {error}"));
    let checksum = basis
        .checksum()
        .unwrap_or_else(|error| panic!("checksum: {error}"));
    let current = normalized(input(85));
    let result = monitor(&current, Some(&basis), Some(&source))
        .unwrap_or_else(|error| panic!("monitor: {error}"));
    assert_eq!(
        result.post_source_match_count, 40,
        "origin source's first forty matches are not the monitoring boundary"
    );
    assert_eq!(result.completed_window_count, 2);
    evaluate_scopes(&current, Some(&basis)).unwrap_or_else(|error| panic!("recompare: {error}"));
    assert_eq!(
        basis.checksum().ok(),
        Some(checksum),
        "recomparison does not change the monitoring start"
    );
}

#[test]
fn legacy_basis_identity_is_preserved_and_manual_edits_inherit_or_replace_the_curve() {
    use crate::achievements::AchievementCurve;
    let legacy: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../../../docs/schemas/fixtures/series-analysis/radar-basis-v1.json"
    ))
    .unwrap_or_else(|error| panic!("legacy fixture: {error}"));
    let mut basis = crate::payload::radar_basis_from_payload(&legacy)
        .unwrap_or_else(|error| panic!("legacy basis: {error}"));
    let mut digest = crate::canonical::FramedSha256::new();
    digest
        .update_serialized(&legacy, &mut Vec::new())
        .unwrap_or_else(|error| panic!("legacy checksum: {error}"));
    assert_eq!(basis.checksum().ok(), Some(digest.finalize()));
    assert_eq!(basis.achievement_curve, None);
    assert_eq!(
        basis.effective_achievement_curve(),
        AchievementCurve::default()
    );
    let saved_checksum = basis.checksum().ok();
    let six_axes = evaluate(input(40), Some(&basis));
    let curve = AchievementCurve {
        thresholds: [0.0, 20.0, 40.0, 60.0, 90.0],
    };
    basis.achievement_curve = Some(curve);
    assert_ne!(basis.checksum().ok(), saved_checksum);
    let edited_six_axes = evaluate(input(40), Some(&basis));
    assert_eq!(edited_six_axes.players, six_axes.players);
    assert_eq!(edited_six_axes.sample, six_axes.sample);
    let mut entered = fixture().input;
    let inherited = create_manual_basis(&normalized(input(40)), &basis, "source", None, &entered)
        .unwrap_or_else(|error| panic!("inherit: {error}"))
        .unwrap_or_else(|| panic!("nonempty comparison"));
    assert_eq!(inherited.effective_achievement_curve(), curve);
    entered.achievement_curve = Some(AchievementCurve::default());
    let reset = create_manual_basis(&normalized(input(40)), &basis, "source", None, &entered)
        .unwrap_or_else(|error| panic!("replace: {error}"))
        .unwrap_or_else(|| panic!("nonempty comparison"));
    assert_eq!(
        reset.effective_achievement_curve(),
        AchievementCurve::default()
    );
}
