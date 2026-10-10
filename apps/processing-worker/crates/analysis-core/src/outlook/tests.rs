use super::*;
use crate::{
    compute::{ComputedResourceKind, compute_all},
    model::{AnalysisInput, IncidentCounts},
    payload::{PayloadSetValidator, validate_computed},
};

fn input(count: i32) -> AnalysisInput {
    AnalysisInput {
        game_title_id: "title-outlook".into(),
        input_revision: 3,
        player_matches: (0..count)
            .flat_map(|i| {
                (0..4).map(move |p| PlayerMatchInput {
                    match_id: format!("match-{i:05}"),
                    match_revision: 1,
                    played_at: format!("2026-01-01T00:00:00.{i:06}Z"),
                    held_event_id: format!("event-{i:05}"),
                    match_no_in_event: 1,
                    season_master_id: if i < count - 2 {
                        "season-1"
                    } else {
                        "season-2"
                    }
                    .into(),
                    map_master_id: "map-1".into(),
                    owner_member_id: "member-0".into(),
                    member_id: format!("member-{p}"),
                    play_order: p + 1,
                    rank: 1 + (i / 7 + p) % 4,
                    total_assets_man_yen: 100,
                    revenue_man_yen: 10,
                    incidents: IncidentCounts::default(),
                })
            })
            .collect(),
    }
}

#[test]
fn best_windows_match_naive_enumeration_and_latest_ties() {
    let normalized = input(111).normalized();
    let facts = TitleFacts::new(&normalized);
    for reference in &facts.references {
        let rows = normalized
            .player_matches()
            .iter()
            .filter(|r| r.member_id == reference.member_id)
            .collect::<Vec<_>>();
        for window in &reference.best_windows {
            let expected = rows
                .windows(window.size)
                .enumerate()
                .map(|(start, rows)| {
                    (
                        rows.iter().map(|r| rank_index(r.rank) + 1).sum::<usize>(),
                        start + rows.len(),
                    )
                })
                .min_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
            assert_eq!(
                expected,
                Some((window.rank_sum, window.period.end_sequence))
            );
        }
        assert!(
            reference
                .examples
                .types
                .iter()
                .any(|example| example.rank_counts.contains(&0)),
            "zero-frequency ranks must be preserved"
        );
    }
}

#[test]
#[expect(
    clippy::panic,
    reason = "a missing fixture resource aborts this test with its identity"
)]
fn complete_set_rejects_missing_reference_and_inconsistent_joint() {
    let resources = compute_all(&input(21));
    let mut valid = PayloadSetValidator::new();
    let mut missing = PayloadSetValidator::new();
    for resource in &resources {
        assert!(
            valid.add_computed(resource).is_ok(),
            "valid outlook resources must pass"
        );
        if !matches!(resource.kind, ComputedResourceKind::OutlookReference { .. }) {
            assert!(
                missing.add_computed(resource).is_ok(),
                "remaining resources are individually valid"
            );
        }
    }
    assert!(valid.finish().is_ok(), "complete resources must pass");
    assert!(
        missing.finish().is_err(),
        "mandatory references must not be optional"
    );
    let Some(mut corrupted) = resources
        .into_iter()
        .find(|r| r.kind == ComputedResourceKind::OutlookSummary)
    else {
        panic!("summary missing");
    };
    if let Some(cell) = corrupted
        .payload
        .pointer_mut("/recent/jointRanks/0/rankCounts/0/0")
    {
        *cell = serde_json::json!(1);
    }
    assert!(
        validate_computed(&corrupted).is_err(),
        "same-rank joint probability is impossible"
    );
}

#[test]
fn bounded_references_and_zero_target_have_explicit_shapes() {
    let normalized = input(0).normalized();
    let facts = TitleFacts::new(&normalized);
    assert!(
        facts.references.is_empty(),
        "no fabricated members for empty title"
    );
    let summary = facts.summary(&ScopeRef::Overall, &[], &BTreeMap::new());
    assert_eq!(summary.quality_status, "no_target");
    let short = input(2).normalized();
    let short_facts = TitleFacts::new(&short);
    assert_eq!(short_facts.recent.quality_status, "reference");
    for reference in short_facts.references {
        assert_eq!(reference.best_windows.len(), 2);
        assert_eq!(reference.examples.status, "insufficient");
        assert!(
            reference.examples.types.is_empty(),
            "less than 20 is genuine insufficiency"
        );
    }
}

#[test]
fn scope_quality_and_recent_quality_use_their_own_denominators() {
    let normalized = input(32).normalized();
    let facts = TitleFacts::new(&normalized);
    let rows = normalized
        .player_matches()
        .iter()
        .filter(|r| r.season_master_id == "season-2")
        .collect::<Vec<_>>();
    let by_member = player_matches_by_member(&rows, &ordered_member_ids(&rows));
    let summary = facts.summary(
        &ScopeRef::Season {
            season_master_id: "season-2".into(),
        },
        &rows,
        &by_member,
    );
    assert_eq!(summary.scope.match_count, 2);
    assert_eq!(summary.quality_status, "reference");
    assert_eq!(summary.recent.match_count, 20);
    assert_eq!(summary.recent.quality_status, "ok");
}

#[test]
#[expect(
    clippy::panic,
    reason = "required fixture facts must exist before mutation testing"
)]
fn reference_rejects_missing_windows_false_insufficiency_duplicates_and_order_drift() {
    let normalized = input(60).normalized();
    let facts = TitleFacts::new(&normalized);
    let reference = facts
        .references
        .first()
        .unwrap_or_else(|| panic!("reference missing"));
    for mutation in 0..5 {
        let mut invalid = reference.clone();
        match mutation {
            0 => {
                invalid.best_windows.remove(3);
            }
            1 => {
                invalid.examples.types.clear();
                invalid.examples.status = "insufficient".into();
            }
            2 => {
                if let Some(first) = invalid.examples.types.first().cloned() {
                    invalid.examples.types.push(first);
                }
            }
            3 => invalid.examples.types.reverse(),
            _ => {
                if let Some(window) = invalid.best_windows.first_mut() {
                    window.average_rank = 4.0 - window.average_rank;
                }
            }
        }
        let resource = crate::compute::ComputedResource {
            scope: ScopeRef::Overall,
            kind: ComputedResourceKind::OutlookReference {
                member_id: invalid.member_id.clone(),
            },
            item_count: invalid.best_windows.len() + invalid.examples.types.len(),
            payload: serde_json::json!(invalid),
            source_match_revision: None,
        };
        assert!(
            validate_computed(&resource).is_err(),
            "semantic mutation {mutation} must fail independently of item_count"
        );
    }
}

#[test]
#[ignore = "explicit maximum-input resource measurement"]
#[expect(
    clippy::panic,
    reason = "explicit resource measurements write their report or fail"
)]
fn maximum_input_title_facts_are_bounded() {
    let normalized = input(25_000).normalized();
    let started = std::time::Instant::now();
    let facts = TitleFacts::new(&normalized);
    let elapsed = started.elapsed().as_millis();
    assert_eq!(facts.references.len(), 4);
    assert!(
        facts
            .references
            .iter()
            .all(|r| r.best_windows.len() == 1000 && r.examples.types.len() <= 1771),
        "saved references have a history-independent bound"
    );
    if let Some(path) = std::env::var_os("MOMO_OUTLOOK_BOUND_REPORT") {
        std::fs::write(path,serde_json::json!({"titleMatchCount":25_000,"elapsedMilliseconds":elapsed,"bestWindowCount":facts.references.iter().map(|r| r.best_windows.len()).sum::<usize>(),"exampleCount":facts.references.iter().map(|r| r.examples.types.len()).sum::<usize>()}).to_string()).unwrap_or_else(|e| panic!("bound report: {e}"));
    }
}

#[test]
#[expect(
    clippy::panic,
    reason = "owner fixture generation reports the precise filesystem or serialization error"
)]
fn checked_in_outlook_payload_fixtures_match_owner() {
    let normalized = input(32).normalized();
    let facts = TitleFacts::new(&normalized);
    let rows = normalized.player_matches().iter().collect::<Vec<_>>();
    let by_member = player_matches_by_member(&rows, &ordered_member_ids(&rows));
    let empty = input(0).normalized();
    let empty_facts = TitleFacts::new(&empty);
    let reference = facts
        .references
        .first()
        .unwrap_or_else(|| panic!("reference missing"));
    let fixtures = [
        (
            "outlook-summary-payload-v1.json",
            serde_json::json!(facts.summary(&ScopeRef::Overall, &rows, &by_member)),
        ),
        (
            "outlook-reference-payload-v1.json",
            serde_json::json!(reference),
        ),
        (
            "outlook-summary-empty-payload-v1.json",
            serde_json::json!(empty_facts.summary(&ScopeRef::Overall, &[], &BTreeMap::new())),
        ),
    ];
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../docs/schemas/fixtures/series-analysis");
    for (name, value) in fixtures {
        let path = directory.join(name);
        let encoded = format!(
            "{}\n",
            serde_json::to_string_pretty(&value).unwrap_or_else(|e| panic!("fixture encode: {e}"))
        );
        if std::env::var_os("UPDATE_SERIES_ANALYSIS_RESOURCE_SCHEMAS").is_some() {
            std::fs::write(&path, &encoded).unwrap_or_else(|e| panic!("fixture write: {e}"));
        }
        assert_eq!(
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("fixture read: {e}")),
            encoded
        );
    }
}

#[test]
#[expect(
    clippy::panic,
    reason = "bounded owner resource fixtures abort on serialization or measurement output failure"
)]
fn maximum_reference_shape_stays_within_reader_envelope() {
    let source = input(20).normalized();
    let facts = TitleFacts::new(&source);
    let mut reference = facts
        .references
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("reference missing"));
    reference.source.game_title_id = "t".repeat(128);
    reference.source.title_match_count = 25_000;
    reference.scope.match_count = 25_000;
    reference.member_id = "m".repeat(128);
    let window = |h: usize, sum: usize, end: usize| Window {
        size: h,
        rank_sum: sum,
        average_rank: average(sum, h),
        period: Period {
            start_match_id: format!("s{:0127}", end - h + 1),
            end_match_id: if h == 1 {
                format!("s{end:0127}")
            } else {
                format!("e{end:0127}")
            },
            started_at: "2026-01-01T00:00:00.000000Z".into(),
            ended_at: "2026-01-01T00:00:00.000000Z".into(),
            start_sequence: end - h + 1,
            end_sequence: end,
        },
    };
    reference.best_windows = (1..=1000).map(|h| window(h, h * 3 - 1, 25_000)).collect();
    let mut types = Vec::new();
    for first in 0..=20 {
        for second in 0..=20 - first {
            for third in 0..=20 - first - second {
                let counts = [first, second, third, 20 - first - second - third];
                types.push(Example {
                    rank_counts: counts,
                    window: window(20, rank_sum(&counts), 25_000 - types.len()),
                });
            }
        }
    }
    assert_eq!(types.len(), 1771);
    types.sort_by(|a, b| {
        example_distance(&a.rank_counts, &reference.recent_rank_counts)
            .cmp(&example_distance(
                &b.rank_counts,
                &reference.recent_rank_counts,
            ))
            .then_with(|| {
                b.window
                    .period
                    .end_sequence
                    .cmp(&a.window.period.end_sequence)
            })
    });
    reference.examples.types = types;
    let resource = crate::compute::ComputedResource {
        scope: ScopeRef::Overall,
        kind: ComputedResourceKind::OutlookReference {
            member_id: reference.member_id.clone(),
        },
        payload: serde_json::json!(reference),
        item_count: 2771,
        source_match_revision: None,
    };
    assert!(
        validate_computed(&resource).is_ok(),
        "largest finite shape must satisfy owner validation"
    );
    let bytes = crate::canonical::canonicalize_value(&resource.payload)
        .unwrap_or_else(|e| panic!("canonical encoding: {e}"));
    let (nodes, depth) = json_shape(&resource.payload);
    assert!(
        bytes.len() <= 8 * 1024 * 1024 && nodes <= 100_000 && depth <= 64,
        "reference must fit the existing reader envelope"
    );
    if let Some(path) = std::env::var_os("MOMO_OUTLOOK_BOUND_REPORT") {
        std::fs::write(path,serde_json::json!({"encodedBytes":bytes.len(),"decodedBytes":bytes.len(),"jsonNodesIncludingKeys":nodes,"nestingDepth":depth,"itemCount":2771}).to_string()).unwrap_or_else(|e| panic!("bound report: {e}"));
    }
}

fn json_shape(value: &serde_json::Value) -> (usize, usize) {
    let children = match value {
        serde_json::Value::Object(fields) => fields.values().map(json_shape).collect::<Vec<_>>(),
        serde_json::Value::Array(values) => values.iter().map(json_shape).collect(),
        serde_json::Value::Null
        | serde_json::Value::Bool(_)
        | serde_json::Value::Number(_)
        | serde_json::Value::String(_) => Vec::new(),
    };
    let keys = value.as_object().map_or(0, serde_json::Map::len);
    (
        1 + keys + children.iter().map(|(nodes, _)| nodes).sum::<usize>(),
        1 + children.iter().map(|(_, depth)| depth).max().unwrap_or(&0),
    )
}
