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
    }
}

fn source() -> RadarSourceSnapshot {
    serde_json::from_str(include_str!(
        "../../../../../docs/schemas/fixtures/series-analysis/radar-source-v1.json"
    ))
    .unwrap_or_else(|error| panic!("source fixture: {error}"))
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
