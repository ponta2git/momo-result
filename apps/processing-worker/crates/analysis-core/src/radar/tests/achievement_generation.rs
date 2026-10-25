use super::*;
use crate::achievements::{
    AchievementCurve, AchievementUnavailableReason, Claim, ClaimKind, ClaimState, Definition,
    RuleKind,
};

fn points_input(points: [usize; 4], total: usize) -> NormalizedAnalysisInput {
    let input = normalized(input(40));
    let mut achievements = input.achievements().clone();
    achievements.definitions = (0..total)
        .map(|n| Definition {
            achievement_id: format!("achievement-{n}"),
            stars: 1,
            rule_kind: RuleKind::Manual,
            threshold: None,
            common: true,
            map_master_ids: vec![],
            applies_from: None,
            retired: false,
            fixed_key: None,
        })
        .collect();
    achievements.claims = points
        .into_iter()
        .enumerate()
        .flat_map(|(member, points)| {
            (0..points).map(move |n| Claim {
                claim_id: format!("claim-{member}-{n}"),
                achievement_id: format!("achievement-{n}"),
                member_id: format!("member-{}", member + 1),
                source_kind: ClaimKind::Direct,
                state: ClaimState::Achieved,
                generation_id: "generation".into(),
                achieved_at: None,
                match_id: None,
            })
        })
        .collect();
    input
        .with_achievements(achievements)
        .unwrap_or_else(|error| panic!("achievement input: {error}"))
}

#[test]
fn lifetime_points_generate_bounded_thresholds_and_block_only_degenerate_targets() {
    let candidate = generate_candidate(&points_input([0, 1, 3, 6], 6))
        .unwrap_or_else(|e| panic!("generate: {e}"));
    let basis = candidate
        .basis
        .as_ref()
        .unwrap_or_else(|| panic!("valid basis"));
    let expected = AchievementCurve::Points {
        point_thresholds: [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0],
    };
    assert_eq!(basis.achievement_curve, Some(expected));
    assert_eq!(
        [0, 1, 3, 6].map(|points| expected.score(points, 6)),
        [Some(2.0), Some(4.0), Some(7.0), Some(10.0)]
    );
    assert!(validate_basis(basis).is_ok());
    let wire = serde_json::to_value(candidate.summary()).unwrap_or_else(|e| panic!("json: {e}"));
    assert!(crate::payload::radar_candidate_from_payload(&wire).is_ok());
    for points in [[0, 0, 0, 0], [2, 2, 2, 2], [0, 0, 0, 6]] {
        let unavailable = generate_candidate(&points_input(points, 6))
            .unwrap_or_else(|e| panic!("generate: {e}"));
        assert!(unavailable.basis.is_none());
        assert!(
            unavailable
                .axes
                .iter()
                .all(|axis| axis.thresholds.is_some())
        );
        let generation = unavailable
            .achievement_generation
            .as_ref()
            .unwrap_or_else(|| panic!("source retained"));
        assert_eq!(
            generation.unavailable_reason,
            Some(AchievementUnavailableReason::DegenerateDistribution)
        );
        let unavailable_wire =
            serde_json::to_value(unavailable.summary()).unwrap_or_else(|e| panic!("json: {e}"));
        assert!(crate::payload::radar_candidate_from_payload(&unavailable_wire).is_ok());
    }
    let empty =
        generate_candidate(&points_input([0; 4], 0)).unwrap_or_else(|e| panic!("generate: {e}"));
    assert_eq!(
        empty
            .basis
            .map(|empty_basis| empty_basis.effective_achievement_curve()),
        Some(AchievementCurve::Unavailable {
            unavailable_reason: AchievementUnavailableReason::NoTarget
        })
    );
    assert_eq!(AchievementCurve::default().score(6, 6), None);
}

#[test]
fn point_source_tracks_semantic_points_and_preserves_legacy_source_identity() {
    let input = points_input([0, 1, 3, 6], 6);
    let candidate = generate_candidate(&input).unwrap_or_else(|e| panic!("generate: {e}"));
    let saved = candidate.source;
    let legacy = snapshot(&input).unwrap_or_else(|e| panic!("snapshot: {e}"));
    assert_ne!(saved.summary().ok(), legacy.summary().ok());
    let mut renamed_proof = input.achievements().clone();
    for claim in &mut renamed_proof.claims {
        claim.generation_id = "new-proof-generation".into();
    }
    let same_points = points_input([0, 1, 3, 6], 6)
        .with_achievements(renamed_proof)
        .unwrap_or_else(|e| panic!("input: {e}"));
    assert_eq!(source_is_current(&saved, &same_points).ok(), Some(true));
    let changed = points_input([0, 1, 4, 6], 6);
    assert_eq!(source_is_current(&saved, &changed).ok(), Some(false));
    assert_eq!(source_is_current(&legacy, &changed).ok(), Some(true));
    let mut tampered = candidate.basis.unwrap_or_else(|| panic!("basis"));
    if let Some(source) = &mut tampered.achievement_generation_source {
        source
            .players
            .get_mut(2)
            .unwrap_or_else(|| panic!("third player"))
            .earned_points = 4;
    }
    assert!(validate_basis(&tampered).is_err());
}
