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
