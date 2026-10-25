#![expect(
    clippy::panic,
    reason = "synthetic saved-snapshot fixtures must fail with exact setup errors"
)]

use super::*;

fn context() -> RadarReadContext {
    RadarReadContext {
        work_kind: "radar_prepare".to_owned(),
        operation_id: Some("operation".to_owned()),
        candidate_id: Some("candidate".to_owned()),
        preview_id: None,
        basis_id: None,
        basis: None,
        source: None,
        before_basis_id: None,
        before_basis: None,
        operation_kind: Some("candidate".to_owned()),
        manual: None,
    }
}

fn source() -> RadarSourceSnapshot {
    serde_json::from_str(include_str!(
        "../../../../../docs/schemas/fixtures/series-analysis/radar-source-v1.json"
    ))
    .unwrap_or_else(|error| panic!("source fixture: {error}"))
}

fn manual_context() -> RadarReadContext {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let original = radar::generate_candidate(&input)
        .unwrap_or_else(|error| panic!("candidate: {error}"))
        .basis
        .unwrap_or_else(|| panic!("valid candidate"));
    let entered = RadarManualInput {
        achievement_curve: None,
        axes: original.axes.clone().map(|axis| radar::RadarManualAxis {
            axis_id: axis.axis_id,
            thresholds: axis.thresholds,
        }),
    };
    let mut context = context();
    context.operation_kind = Some("manual".to_owned());
    context.manual = Some(Box::new(ManualCandidateContext {
        input: entered,
        source_basis_id: "original".to_owned(),
        source_candidate_id: Some("original-candidate".to_owned()),
        source_basis: original,
    }));
    context
}

#[test]
fn manual_preparation_binds_entered_values_and_defers_empty_first_basis() {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let context = manual_context();
    let prepared = compute(&input, &context).unwrap_or_else(|error| panic!("prepare: {error}"));
    assert!(
        prepared.manual_basis.is_some(),
        "first nonempty comparison fixes the basis"
    );
    assert!(
        validate(&prepared, &context, None).is_ok(),
        "owner validates manual calculation"
    );
    let mut wrong = prepared;
    if let Some(value) = wrong
        .manual_basis
        .as_mut()
        .and_then(|basis| basis.axes.last_mut())
        .and_then(|axis| axis.thresholds.last_mut())
    {
        *value += 1.0;
    }
    assert!(
        validate(&wrong, &context, None).is_err(),
        "shape-valid manual values must match the entered candidate"
    );

    let empty = RadarSourceSnapshot {
        game_title_id: input.game_title_id().to_owned(),
        matches: Vec::new(),
        achievements: None,
    }
    .normalized_for_validation(2)
    .unwrap_or_else(|error| panic!("empty input: {error}"));
    let empty_prepared =
        compute(&empty, &context).unwrap_or_else(|error| panic!("empty prepare: {error}"));
    assert!(
        empty_prepared.manual_basis.is_none(),
        "empty input has no fabricated monitoring start"
    );
    assert!(
        validate(&empty_prepared, &context, None).is_ok(),
        "empty comparison is a recoverable product state"
    );
}

#[test]
fn manual_recomparison_retains_basis_after_original_source_correction() {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let mut context = manual_context();
    let first = compute(&input, &context).unwrap_or_else(|error| panic!("prepare: {error}"));
    context.basis = first.manual_basis;
    context.basis_id = Some("manual-basis".to_owned());
    context.source = Some(source());
    context.operation_kind = Some("preview".to_owned());
    let mut corrected = source();
    if let Some(player) = corrected
        .matches
        .first_mut()
        .and_then(|game| game.players.first_mut())
    {
        player.revenue_man_yen += 1;
    }
    let corrected = corrected
        .normalized_for_validation(2)
        .unwrap_or_else(|error| panic!("corrected input: {error}"));
    let preview =
        compute(&corrected, &context).unwrap_or_else(|error| panic!("recompare: {error}"));
    assert!(
        preview.manual_basis.is_none(),
        "refresh does not create a new monitoring start"
    );
    assert!(
        preview.candidate_source_valid,
        "manual values survive record corrections"
    );
    assert!(
        validate(&preview, &context, None).is_ok(),
        "same manual basis scores latest records"
    );
}

#[test]
fn preparation_owner_rejects_missing_scopes_wrong_scores_and_non_source_candidates() {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let context = context();
    let prepared = compute(&input, &context).unwrap_or_else(|error| panic!("prepare: {error}"));
    assert!(
        validate(&prepared, &context, None).is_ok(),
        "valid complete preparation passes"
    );
    let mut missing = prepared.clone();
    missing.scopes.pop();
    assert!(
        validate(&missing, &context, None).is_err(),
        "an omitted scope cannot become a ready preview"
    );
    let mut wrong = prepared.clone();
    if let Some(cell) = wrong
        .scopes
        .first_mut()
        .and_then(|scope| scope.payload.after.players.first_mut())
        .and_then(|player| player.axes.first_mut())
    {
        cell.score = Some(1);
    }
    assert!(
        validate(&wrong, &context, None).is_err(),
        "shape-valid scores must agree with source and basis"
    );
    let mut subset = prepared;
    if let Some(candidate) = &mut subset.candidate {
        candidate.source.matches.pop();
    }
    assert!(
        validate(&subset, &context, None).is_err(),
        "candidate generation must use the complete frozen evaluation snapshot"
    );
}

#[test]
fn refreshed_preview_validity_is_bound_to_its_frozen_source_not_an_unchecked_flag() {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let candidate =
        radar::generate_candidate(&input).unwrap_or_else(|error| panic!("candidate: {error}"));
    let mut context = context();
    context.operation_kind = Some("preview".to_owned());
    context.basis = candidate.basis;
    context.basis_id = Some("basis".to_owned());
    context.source = Some(candidate.source);
    let mut prepared = compute(&input, &context).unwrap_or_else(|error| panic!("prepare: {error}"));
    assert!(
        validate(&prepared, &context, None).is_ok(),
        "refresh uses saved fixed thresholds"
    );
    prepared.candidate_source_valid = false;
    assert!(
        validate(&prepared, &context, None).is_err(),
        "a child boolean is verified against saved source facts"
    );
}

#[test]
fn preparation_file_is_bounded_and_rejects_a_symlink() {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let prepared = compute(&input, &context()).unwrap_or_else(|error| panic!("prepare: {error}"));
    let directory =
        tempfile::TempDir::new().unwrap_or_else(|error| panic!("temporary directory: {error}"));
    assert!(
        write(directory.path(), &prepared, 1).is_err(),
        "oversized preparation is not partially written"
    );
    let length = write(directory.path(), &prepared, 1024 * 1024)
        .unwrap_or_else(|error| panic!("write: {error}"));
    assert_eq!(read(directory.path(), length).ok(), Some(prepared));
    assert!(
        read(directory.path(), length - 1).is_err(),
        "a smaller read bound rejects the saved file"
    );
    let linked =
        tempfile::TempDir::new().unwrap_or_else(|error| panic!("temporary directory: {error}"));
    std::os::unix::fs::symlink(
        directory.path().join(PREPARATION_FILE),
        linked.path().join(PREPARATION_FILE),
    )
    .unwrap_or_else(|error| panic!("symlink: {error}"));
    assert!(
        read(linked.path(), length).is_err(),
        "child output cannot link an external file"
    );
}

fn achievement_input() -> NormalizedAnalysisInput {
    let input = source()
        .normalized_for_validation(1)
        .unwrap_or_else(|error| panic!("input fixture: {error}"));
    let mut achievements = input.achievements().clone();
    achievements.definitions = ["achieved", "remaining"]
        .map(|id| achievements::Definition {
            achievement_id: id.to_owned(),
            stars: 1,
            rule_kind: achievements::RuleKind::Manual,
            threshold: None,
            common: true,
            map_master_ids: Vec::new(),
            applies_from: None,
            retired: false,
            fixed_key: None,
        })
        .to_vec();
    achievements.claims.push(achievements::Claim {
        claim_id: "claim".to_owned(),
        achievement_id: "achieved".to_owned(),
        member_id: achievements
            .member_ids
            .first()
            .cloned()
            .unwrap_or_else(|| panic!("member")),
        source_kind: achievements::ClaimKind::Direct,
        state: achievements::ClaimState::Achieved,
        generation_id: "generation".to_owned(),
        achieved_at: None,
        match_id: None,
    });
    input
        .with_achievements(achievements)
        .unwrap_or_else(|error| panic!("achievements: {error}"))
}

#[test]
fn formal_comparison_rescores_the_same_lifetime_points_and_rejects_tampering() {
    let input = achievement_input();
    let mut context = manual_context();
    let curve = AchievementCurve::Points {
        point_thresholds: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
    };
    context
        .manual
        .as_mut()
        .unwrap_or_else(|| panic!("manual context"))
        .input
        .achievement_curve = Some(curve);
    let prepared = compute(&input, &context).unwrap_or_else(|error| panic!("prepare: {error}"));
    assert!(validate(&prepared, &context, None).is_ok());
    for scope in &prepared.scopes {
        let before = scope
            .payload
            .before_achievements
            .summary
            .players
            .first()
            .unwrap_or_else(|| panic!("before player"));
        let after = scope
            .payload
            .after_achievements
            .summary
            .players
            .first()
            .unwrap_or_else(|| panic!("after player"));
        assert_eq!(scope.payload.before_achievements.summary.total_points, 2);
        assert_eq!(scope.payload.after_achievements.summary.total_points, 2);
        assert_eq!((before.earned_points, after.earned_points), (1, 1));
        assert_eq!((before.score, after.score), (Some(1.0), Some(2.0)));
    }
    let mut wrong = prepared.clone();
    wrong
        .scopes
        .first_mut()
        .unwrap_or_else(|| panic!("scope"))
        .payload
        .after_achievements
        .summary
        .players
        .first_mut()
        .unwrap_or_else(|| panic!("player"))
        .score = Some(1.0);
    assert!(validate(&wrong, &context, None).is_err());
    let mut missing = prepared;
    missing.evaluation_snapshot.achievements = None;
    assert!(validate(&missing, &context, None).is_err());
}

#[test]
fn generated_candidates_keep_the_applied_curve_and_saved_comparisons_keep_their_curve() {
    let input = achievement_input();
    let mut context = context();
    let mut before = radar::generate_candidate(&input)
        .unwrap_or_else(|error| panic!("generate: {error}"))
        .basis
        .unwrap_or_else(|| panic!("basis"));
    let curve = AchievementCurve::LegacyPercentage {
        thresholds: [0.0, 20.0, 40.0, 60.0, 90.0],
    };
    before.achievement_curve = Some(curve);
    context.before_basis_id = Some("applied".to_owned());
    context.before_basis = Some(before);
    let prepared = compute(&input, &context).unwrap_or_else(|error| panic!("prepare: {error}"));
    assert!(validate(&prepared, &context, context.before_basis.as_ref()).is_ok());
    let candidate = prepared.candidate.unwrap_or_else(|| panic!("candidate"));
    assert_eq!(
        candidate
            .basis
            .as_ref()
            .map(RadarBasis::effective_achievement_curve),
        Some(curve)
    );
    context.operation_kind = Some("restore".to_owned());
    context.basis = candidate.basis;
    context.source = Some(candidate.source);
    let restored = compute(&input, &context).unwrap_or_else(|error| panic!("restore: {error}"));
    assert!(validate(&restored, &context, context.before_basis.as_ref()).is_ok());
    assert!(
        restored
            .scopes
            .iter()
            .all(|scope| scope.payload.after_achievements.achievement_curve == curve)
    );
}
