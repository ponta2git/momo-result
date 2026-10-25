#![expect(
    clippy::panic_in_result_fn,
    reason = "fixtures return setup failures and assert independently specified achievement outcomes"
)]

use super::*;
use crate::model::{AnalysisInput, IncidentCounts};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn definition(id: &str, rule: RuleKind, threshold: Option<&str>) -> Definition {
    Definition {
        achievement_id: id.into(),
        stars: 2,
        rule_kind: rule,
        threshold: threshold.map(String::from),
        common: true,
        map_master_ids: vec![],
        applies_from: None,
        retired: false,
        fixed_key: None,
    }
}

fn input(definitions: Vec<Definition>) -> AchievementInput {
    AchievementInput {
        member_ids: ["a", "b", "c", "d"].map(String::from).to_vec(),
        map_master_ids: ["east", "west"].map(String::from).to_vec(),
        definitions,
        ..AchievementInput::default()
    }
}

fn claim(item: &str, kind: ClaimKind) -> Claim {
    let achieved_at = (kind == ClaimKind::Direct).then(|| "2026-01-01T00:00:00.000000Z".into());
    Claim {
        claim_id: format!("claim-{item}"),
        achievement_id: item.into(),
        member_id: "a".into(),
        source_kind: kind,
        state: ClaimState::Achieved,
        generation_id: "generation-first".into(),
        achieved_at,
        match_id: None,
    }
}

fn rows(times: &[&str]) -> Vec<PlayerMatchInput> {
    times
        .iter()
        .zip(1_i32..)
        .flat_map(|(time, number)| {
            ["a", "b", "c", "d"]
                .into_iter()
                .zip(1_i32..)
                .map(move |(member, rank)| PlayerMatchInput {
                    match_id: format!("match-{number}"),
                    match_revision: 0,
                    played_at: (*time).into(),
                    held_event_id: "event".into(),
                    match_no_in_event: number,
                    season_master_id: "season".into(),
                    map_master_id: if number % 2 == 0 { "west" } else { "east" }.into(),
                    owner_member_id: "a".into(),
                    member_id: member.into(),
                    play_order: rank,
                    rank,
                    total_assets_man_yen: 400_000,
                    revenue_man_yen: 0,
                    incidents: IncidentCounts {
                        destination: 6,
                        ..IncidentCounts::default()
                    },
                })
        })
        .collect()
}

fn calculated(
    input: AchievementInput,
    rows: Vec<PlayerMatchInput>,
) -> Result<AchievementPayload, AnalysisInputError> {
    let normalized = AnalysisInput {
        game_title_id: "title".into(),
        input_revision: 1,
        player_matches: rows,
    }
    .try_into_normalized()?
    .with_achievements(input)?;
    Ok(calculate(
        normalized.game_title_id(),
        normalized.achievements(),
        normalized.player_matches(),
        AchievementCurve::default(),
    ))
}

fn player<'a>(
    payload: &'a AchievementPayload,
    item: &str,
    member: &str,
) -> Result<&'a PlayerAchievement, &'static str> {
    payload
        .items
        .iter()
        .find(|entry| entry.achievement_id == item)
        .and_then(|entry| {
            entry
                .players
                .iter()
                .find(|player| player.member_id == member)
        })
        .ok_or("player missing")
}

#[test]
fn zero_matches_still_scores_the_fixed_roster_and_future_maps() -> TestResult {
    let mut source = input(vec![definition("manual", RuleKind::Manual, None)]);
    source.claims.push(claim("manual", ClaimKind::Import));
    let payload = calculated(source, vec![])?;
    assert!(valid_payload(&payload));
    assert_eq!(payload.summaries.len(), 3);
    for summary in &payload.summaries {
        assert_eq!(summary.total_points, 4);
        assert_eq!(
            summary.players.first().ok_or("missing points")?.score,
            Some(10.0)
        );
        assert_eq!(
            summary.players.get(1).ok_or("missing points")?.score,
            Some(1.0)
        );
    }
    assert!(player(&payload, "manual", "a")?.date_unknown);
    let empty = calculated(input(vec![]), vec![])?;
    assert_eq!(
        empty
            .summaries
            .first()
            .ok_or("missing summary")?
            .players
            .first()
            .ok_or("missing player")?
            .score,
        None
    );
    Ok(())
}

#[test]
fn corrected_manual_history_can_have_an_unknown_date_only_after_unlinking() -> TestResult {
    for retired in [false, true] {
        let mut item = definition("manual", RuleKind::Manual, None);
        item.retired = retired;
        let mut source = input(vec![item]);
        let mut root = claim("manual", ClaimKind::Direct);
        root.achieved_at = None;
        source.claims.push(root);
        let payload = calculated(source.clone(), vec![])?;
        assert!(valid_payload(&payload));
        let achieved = player(&payload, "manual", "a")?;
        assert_eq!(achieved.status, AchievementStatus::Achieved);
        assert_eq!(achieved.first_achieved_at, None);
        assert!(achieved.date_unknown);
        assert_eq!(
            achieved.proofs.first().ok_or("manual proof missing")?.kind,
            ProofKind::Manual
        );

        let mut linked = source.clone();
        linked
            .claims
            .first_mut()
            .ok_or("manual claim missing")?
            .match_id = Some("match-1".into());
        assert_eq!(
            calculated(linked, vec![]),
            Err(AnalysisInputError::InvalidAchievements)
        );
        let mut invalid_player = achieved.clone();
        invalid_player
            .proofs
            .first_mut()
            .ok_or("manual proof missing")?
            .match_id = Some("match-1".into());
        assert!(!valid_player(&invalid_player));

        source
            .claims
            .first_mut()
            .ok_or("manual claim missing")?
            .state = ClaimState::Cancelled;
        let cancelled = calculated(source, vec![])?;
        assert!(valid_payload(&cancelled));
        assert_eq!(
            player(&cancelled, "manual", "a")?.status,
            AchievementStatus::NotRecorded
        );
    }
    Ok(())
}

#[test]
fn additions_evaluate_all_history_without_truncating_first_attainment() -> TestResult {
    let mut item = definition("assets", RuleKind::TotalAssets, Some("400000"));
    item.applies_from = Some("2026-01-01".into());
    let payload = calculated(
        input(vec![item]),
        rows(&[
            "2025-12-31T14:59:59.999999Z",
            "2025-12-31T15:00:00.000001Z",
            "2026-01-01T12:00:00.000000Z",
        ]),
    )?;
    assert_eq!(
        player(&payload, "assets", "a")?
            .first_achieved_at
            .as_deref(),
        Some("2025-12-31T14:59:59.999999Z")
    );
    assert_eq!(
        payload.items.first().ok_or("item missing")?.applies_from,
        None
    );
    assert!(valid_payload(&payload));
    Ok(())
}

#[test]
fn event_average_requires_the_whole_event_to_have_four_same_title_matches() -> TestResult {
    let mut item = definition("average", RuleKind::EventAverageRank, Some("1.5"));
    item.applies_from = Some("2026-10-24".into());
    let mut source = input(vec![item]);
    source.event_compositions.push(EventComposition {
        held_event_id: "event".into(),
        match_count: 4,
        title_count: 1,
    });
    let matches = rows(&[
        "2026-01-01T00:00:00.000000Z",
        "2026-01-02T00:00:00.000000Z",
        "2026-01-03T00:00:00.000000Z",
        "2026-01-04T00:00:00.000000Z",
    ]);
    let payload = calculated(source.clone(), matches.clone())?;
    assert_eq!(
        player(&payload, "average", "a")?
            .first_achieved_at
            .as_deref(),
        Some("2026-01-04T00:00:00.000000Z")
    );
    assert_eq!(
        player(&payload, "average", "b")?.status,
        AchievementStatus::NotRecorded
    );
    for (count, titles) in [(3, 1), (5, 1), (4, 2)] {
        let composition = source
            .event_compositions
            .first_mut()
            .ok_or("missing event")?;
        composition.match_count = count;
        composition.title_count = titles;
        assert_eq!(
            player(
                &calculated(source.clone(), matches.clone())?,
                "average",
                "a"
            )?
            .status,
            AchievementStatus::NotRecorded
        );
    }
    Ok(())
}

#[test]
fn automatic_records_ignore_legacy_claims_and_follow_match_corrections() -> TestResult {
    let mut upper = definition("upper", RuleKind::TotalAssets, Some("400000"));
    upper.fixed_key = Some("initial-upper".into());
    let mut lower = definition("lower", RuleKind::TotalAssets, Some("200000"));
    lower.fixed_key = Some("initial-lower".into());
    let mut source = input(vec![upper, lower]);
    let mut old_claim = claim("upper", ClaimKind::Import);
    old_claim.achieved_at = Some("2020-01-01T00:00:00.000000Z".into());
    source.claims.push(old_claim);
    let mut unconfirmed = claim("lower", ClaimKind::Import);
    unconfirmed.state = ClaimState::Unconfirmed;
    source.claims.push(unconfirmed);

    let empty = calculated(source.clone(), vec![])?;
    for item in ["upper", "lower"] {
        let record = player(&empty, item, "a")?;
        assert_eq!(record.status, AchievementStatus::NotRecorded);
        assert!(record.proofs.is_empty());
    }
    assert_eq!(
        empty
            .summaries
            .first()
            .ok_or("summary missing")?
            .players
            .first()
            .ok_or("points missing")?
            .earned_points,
        0
    );

    let mut matches = rows(&["2026-01-01T00:00:00.000000Z", "2026-02-01T00:00:00.000000Z"]);
    let first = calculated(source.clone(), matches.clone())?;
    let achieved = player(&first, "upper", "a")?;
    assert_eq!(achieved.proofs.len(), 1);
    assert_eq!(
        achieved.proofs.first().ok_or("proof missing")?.kind,
        ProofKind::Automatic
    );
    assert_eq!(
        achieved.first_achieved_at.as_deref(),
        Some("2026-01-01T00:00:00.000000Z")
    );
    assert!(!achieved.date_unknown);
    assert_eq!(
        first
            .summaries
            .first()
            .ok_or("summary missing")?
            .players
            .first()
            .ok_or("points missing")?
            .earned_points,
        8
    );

    for row in &mut matches {
        if row.match_id == "match-1" {
            row.total_assets_man_yen = 100_000;
        }
    }
    let corrected = calculated(source.clone(), matches.clone())?;
    assert_eq!(
        player(&corrected, "upper", "a")?
            .first_achieved_at
            .as_deref(),
        Some("2026-02-01T00:00:00.000000Z")
    );
    for row in &mut matches {
        row.total_assets_man_yen = 100_000;
    }
    let removed = calculated(source, matches)?;
    for item in ["upper", "lower"] {
        assert_eq!(
            player(&removed, item, "a")?.status,
            AchievementStatus::NotRecorded
        );
    }
    assert_eq!(
        removed
            .summaries
            .first()
            .ok_or("summary missing")?
            .players
            .first()
            .ok_or("points missing")?
            .earned_points,
        0
    );
    assert!(valid_payload(&first) && valid_payload(&corrected) && valid_payload(&removed));
    Ok(())
}

#[test]
fn validation_rejects_active_automatic_imports_but_preserves_retired_snapshots() -> TestResult {
    let mut manual_source = input(vec![definition("legacy", RuleKind::Manual, None)]);
    manual_source
        .claims
        .push(claim("legacy", ClaimKind::Import));
    let mut legacy = calculated(manual_source, vec![])?;
    let item = legacy.items.first_mut().ok_or("legacy item missing")?;
    item.rule_kind = RuleKind::TotalAssets;
    item.threshold = Some("400000".into());
    let historical_players = item.players.clone();
    assert!(!valid_payload(&legacy));

    let mut retired = definition("legacy", RuleKind::TotalAssets, Some("400000"));
    retired.retired = true;
    let mut source = input(vec![retired]);
    source.retired_achievements.push(RetiredAchievement {
        achievement_id: "legacy".into(),
        players: historical_players,
    });
    let preserved = calculated(source, vec![])?;
    assert!(valid_payload(&preserved));
    assert_eq!(
        player(&preserved, "legacy", "a")?.status,
        AchievementStatus::Achieved
    );
    assert!(player(&preserved, "legacy", "a")?.date_unknown);
    assert_eq!(
        preserved
            .summaries
            .first()
            .ok_or("summary missing")?
            .total_points,
        0
    );
    Ok(())
}

#[test]
fn retired_manual_lower_tracks_only_the_original_claim_generation() -> TestResult {
    let mut upper = definition("upper", RuleKind::Manual, None);
    upper.fixed_key = Some("momotetsu2-patrol-four".into());
    let mut lower = definition("lower", RuleKind::Manual, None);
    lower.fixed_key = Some("momotetsu2-patrol-dubbing-four".into());
    lower.retired = true;
    let mut source = input(vec![upper, lower]);
    source.claims.push(claim("upper", ClaimKind::Direct));
    source.retired_manual_sources.push(ManualRetirementSource {
        achievement_id: "lower".into(),
        claim_id: "claim-upper".into(),
        generation_id: "generation-first".into(),
    });
    assert_eq!(
        player(&calculated(source.clone(), vec![])?, "lower", "a")?.status,
        AchievementStatus::Achieved
    );
    source.claims.first_mut().ok_or("claim missing")?.state = ClaimState::Cancelled;
    assert_eq!(
        player(&calculated(source.clone(), vec![])?, "lower", "a")?.status,
        AchievementStatus::NotRecorded
    );
    let root = source.claims.first_mut().ok_or("claim missing")?;
    root.state = ClaimState::Achieved;
    root.generation_id = "generation-new-trial".into();
    assert_eq!(
        player(&calculated(source.clone(), vec![])?, "lower", "a")?.status,
        AchievementStatus::NotRecorded
    );
    source.claims.push(claim("lower", ClaimKind::Direct));
    assert_eq!(
        player(&calculated(source, vec![])?, "lower", "a")?.status,
        AchievementStatus::Achieved
    );
    Ok(())
}

#[test]
fn full_validation_rejects_inconsistent_totals_and_status() -> TestResult {
    let mut source = input(vec![definition("manual", RuleKind::Manual, None)]);
    source.claims.push(claim("manual", ClaimKind::Direct));
    let mut payload = calculated(source, vec![])?;
    assert!(valid_payload(&payload));
    payload
        .summaries
        .first_mut()
        .ok_or("summary missing")?
        .total_points += 1;
    assert!(!valid_payload(&payload));
    payload
        .summaries
        .first_mut()
        .ok_or("summary missing")?
        .total_points -= 1;
    payload
        .items
        .first_mut()
        .ok_or("item missing")?
        .players
        .first_mut()
        .ok_or("player missing")?
        .date_unknown = true;
    assert!(!valid_payload(&payload));
    Ok(())
}

#[test]
fn full_validation_rejects_wrong_proof_kinds_and_unsorted_rosters() -> TestResult {
    let mut source = input(vec![definition("manual", RuleKind::Manual, None)]);
    source.claims.push(claim("manual", ClaimKind::Direct));
    let payload = calculated(source, vec![])?;
    let mut wrong_kind = payload.clone();
    let proof = wrong_kind
        .items
        .first_mut()
        .and_then(|item| item.players.first_mut())
        .and_then(|player| player.proofs.first_mut())
        .ok_or("manual proof missing")?;
    proof.kind = ProofKind::Automatic;
    proof.claim_id = None;
    proof.generation_id = None;
    proof.match_id = Some("invented-match".into());
    assert!(!valid_payload(&wrong_kind));
    let mut unsorted = payload;
    for item in &mut unsorted.items {
        item.players.reverse();
    }
    for summary in &mut unsorted.summaries {
        summary.players.reverse();
    }
    assert!(!valid_payload(&unsorted));
    Ok(())
}

#[test]
fn average_thresholds_keep_exact_decimal_quarter_boundaries() -> TestResult {
    let mut source = input(vec![definition(
        "average",
        RuleKind::EventAverageRank,
        Some("1.2499999999999999999999"),
    )]);
    source.event_compositions.push(EventComposition {
        held_event_id: "event".into(),
        match_count: 4,
        title_count: 1,
    });
    let mut matches = rows(&[
        "2026-01-01T00:00:00.000000Z",
        "2026-01-02T00:00:00.000000Z",
        "2026-01-03T00:00:00.000000Z",
        "2026-01-04T00:00:00.000000Z",
    ]);
    for row in &mut matches {
        if row.match_no_in_event == 4 {
            if row.member_id == "a" {
                row.rank = 2;
            }
            if row.member_id == "b" {
                row.rank = 1;
            }
        }
    }
    assert_eq!(
        player(
            &calculated(source.clone(), matches.clone())?,
            "average",
            "a"
        )?
        .status,
        AchievementStatus::NotRecorded
    );
    source
        .definitions
        .first_mut()
        .ok_or("item missing")?
        .threshold = Some("1.2500000000000000000000".into());
    assert_eq!(
        player(&calculated(source, matches)?, "average", "a")?.status,
        AchievementStatus::Achieved
    );
    assert!(
        input(vec![definition(
            "count",
            RuleKind::Destination,
            Some("6.00000000000000000001")
        )])
        .normalize()
        .is_err()
    );
    Ok(())
}

#[test]
fn retired_automatic_history_does_not_supply_an_active_lower_condition() -> TestResult {
    let lower = definition("lower", RuleKind::TotalAssets, Some("200000"));
    let upper = definition("upper", RuleKind::TotalAssets, Some("400000"));
    let initial = calculated(
        input(vec![lower.clone(), upper.clone()]),
        rows(&["2026-01-01T00:00:00.000000Z"]),
    )?;
    let saved = initial
        .items
        .iter()
        .find(|item| item.achievement_id == "upper")
        .ok_or("upper missing")?
        .players
        .clone();
    let mut retired = upper;
    retired.retired = true;
    let mut source = input(vec![lower, retired]);
    source.retired_achievements.push(RetiredAchievement {
        achievement_id: "upper".into(),
        players: saved,
    });
    let mut corrected = rows(&["2026-01-01T00:00:00.000000Z"]);
    for row in &mut corrected {
        row.total_assets_man_yen = 100_000;
    }
    let payload = calculated(source, corrected)?;
    assert_eq!(
        player(&payload, "upper", "a")?.status,
        AchievementStatus::Achieved
    );
    assert_eq!(
        player(&payload, "lower", "a")?.status,
        AchievementStatus::NotRecorded
    );
    assert_eq!(
        payload
            .summaries
            .first()
            .ok_or("summary missing")?
            .total_points,
        4
    );
    assert!(valid_payload(&payload));
    Ok(())
}

#[test]
fn manual_inference_preserves_independent_imports_and_rescores_after_cancellation() -> TestResult {
    let mut source = input(vec![
        definition("lower", RuleKind::Manual, None),
        definition("upper", RuleKind::Manual, None),
    ]);
    for definition in &mut source.definitions {
        definition.fixed_key = Some(if definition.achievement_id == "upper" {
            "momotetsu2-patrol-four".into()
        } else {
            "momotetsu2-patrol-dubbing-four".into()
        });
    }
    source.claims.push(claim("upper", ClaimKind::Import));
    source.claims.push(claim("lower", ClaimKind::Import));
    let payload = calculated(source.clone(), vec![])?;
    assert_eq!(player(&payload, "lower", "a")?.proofs.len(), 2);
    source
        .claims
        .iter_mut()
        .find(|claim| claim.achievement_id == "upper")
        .ok_or("upper missing")?
        .state = ClaimState::Cancelled;
    let corrected = calculated(source, vec![])?;
    assert_eq!(player(&corrected, "lower", "a")?.proofs.len(), 1);
    assert_eq!(
        corrected
            .summaries
            .first()
            .ok_or("summary missing")?
            .players
            .first()
            .ok_or("points missing")?
            .score,
        Some(7.0)
    );
    Ok(())
}

#[test]
fn checked_in_achievement_payload_fixtures_match_owner() -> TestResult {
    let mut source = input(vec![
        definition("manual", RuleKind::Manual, None),
        definition("destination", RuleKind::Destination, Some("6")),
    ]);
    source.claims.push(claim("manual", ClaimKind::Import));
    let fixtures = [
        (
            "achievements-payload-v2.json",
            calculated(source, rows(&["2026-01-01T00:00:00.000000Z"]))?,
        ),
        (
            "achievements-empty-payload-v2.json",
            calculated(input(vec![]), vec![])?,
        ),
    ];
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../docs/schemas/fixtures/series-analysis");
    for (name, payload) in fixtures {
        assert!(valid_payload(&payload));
        let encoded = format!("{}\n", serde_json::to_string_pretty(&payload)?);
        let path = directory.join(name);
        if std::env::var_os("UPDATE_SERIES_ANALYSIS_RESOURCE_SCHEMAS").is_some() {
            std::fs::write(&path, &encoded)?;
        }
        assert_eq!(std::fs::read_to_string(path)?, encoded);
    }
    Ok(())
}
