#![expect(
    clippy::panic_in_result_fn,
    reason = "fixture errors propagate while assertions identify the violated comparison contract"
)]

use super::*;
use crate::notifications::analysis::artifacts::decode_ranks;
use crate::notifications::analysis::types::AnalysisIdentity;

fn artifact(artifact_id: &str, entries: &[(&str, &str, &str, &str)]) -> Artifact {
    Artifact {
        identity: AnalysisIdentity {
            artifact_id: artifact_id.to_owned(),
            input_revision: "1".to_owned(),
            algorithm_version: "v4".to_owned(),
            artifact_schema_version: 3,
            validation_contract_id: Some("validated-v3".to_owned()),
        },
        scopes: std::iter::once((None, BTreeMap::new()))
            .chain(
                entries
                    .iter()
                    .map(|(_, _, season, _)| (Some((*season).to_owned()), BTreeMap::new())),
            )
            .collect(),
        matches: entries
            .iter()
            .map(|(id, revision, season, map)| {
                (
                    (*id).to_owned(),
                    MatchIdentity {
                        source_revision: (*revision).to_owned(),
                        season_id: (*season).to_owned(),
                        map_id: (*map).to_owned(),
                    },
                )
            })
            .collect(),
    }
}

#[test]
fn changed_revisions_moves_additions_and_deletions_select_affected_seasons()
-> Result<(), SkipReason> {
    let before = artifact(
        "old",
        &[
            ("untouched", "1", "quiet", "map"),
            ("edited", "1", "a", "map"),
            ("moved", "1", "old-season", "map"),
            ("deleted", "1", "deleted-season", "map"),
        ],
    );
    let after = artifact(
        "new",
        &[
            ("untouched", "1", "quiet", "map"),
            ("edited", "2", "a", "map"),
            ("moved", "2", "new-season", "other-map"),
            ("backdated", "1", "b", "map"),
        ],
    );
    let diff = changes(Some(&before), &after)?;
    assert_eq!(
        diff.matches.keys().map(String::as_str).collect::<Vec<_>>(),
        ["backdated", "edited", "moved"]
    );
    assert_eq!(
        diff.seasons.iter().map(String::as_str).collect::<Vec<_>>(),
        ["a", "b", "deleted-season", "new-season", "old-season"]
    );
    let deletion = changes(
        Some(&before),
        &artifact("new", &[("untouched", "1", "quiet", "map")]),
    )?;
    assert!(
        deletion.matches.is_empty(),
        "deleted matches cannot be listed or counted as zero ginji"
    );
    assert!(
        !deletion.seasons.contains("quiet"),
        "deletion-only is not an unchanged recalculation"
    );
    let unchanged = changes(Some(&after), &after)?;
    assert!(
        unchanged.matches.is_empty(),
        "manual reuse has no added/changed matches"
    );
    assert_eq!(unchanged.seasons.len(), 4);
    assert_eq!(changes(None, &after)?.matches.len(), 4);
    Ok(())
}

#[test]
fn rank_comparisons_use_unrounded_artifact_values_and_typed_absence() {
    let before = Some(RankSample {
        match_count: 2,
        average_rank: Some(2.0),
    });
    let after = RankSample {
        match_count: 3,
        average_rank: Some(7.0 / 3.0),
    };
    let (state, delta) = compare(before, after, true, false);
    assert_eq!(state, "comparable");
    assert!(
        delta.is_some_and(|value| (value - 1.0 / 3.0).abs() < 1e-12),
        "hand-computed average difference"
    );
    assert_eq!(compare(None, after, true, false), ("initial", None));
    assert_eq!(
        compare(before, RankSample::EMPTY, true, false),
        ("empty", None)
    );
    assert_eq!(compare(before, after, false, false), ("incomparable", None));
    assert_eq!(
        compare(Some(after), after, true, true),
        ("reused", Some(0.0))
    );
    assert_eq!(
        compare(Some(RankSample::EMPTY), RankSample::EMPTY, true, true),
        ("reused", None)
    );
    assert_eq!(
        compare(Some(after), after, true, false),
        ("comparable", Some(0.0))
    );
    assert!(
        compare(
            before,
            RankSample {
                match_count: 10_000,
                average_rank: Some(1.9999)
            },
            true,
            false
        )
        .1
        .is_some_and(|small_delta| small_delta < 0.0 && small_delta.abs() < 0.01),
        "small improvement must not become maintenance"
    );
}

#[test]
fn oversized_changes_skip_the_whole_listing_but_unchanged_history_is_allowed()
-> Result<(), SkipReason> {
    let mut after = artifact("current", &[]);
    for index in 0..MAXIMUM_LISTED_MATCHES {
        after.matches.insert(
            format!("m{index}"),
            MatchIdentity {
                source_revision: "1".to_owned(),
                season_id: "season".to_owned(),
                map_id: "map".to_owned(),
            },
        );
    }
    after
        .scopes
        .insert(Some("season".to_owned()), BTreeMap::new());
    assert_eq!(changes(None, &after)?.matches.len(), MAXIMUM_LISTED_MATCHES);
    after.matches.insert(
        "overflow".to_owned(),
        MatchIdentity {
            source_revision: "1".to_owned(),
            season_id: "season".to_owned(),
            map_id: "map".to_owned(),
        },
    );
    assert!(
        matches!(changes(None, &after), Err(SkipReason::PayloadBound)),
        "an over-capacity initial publication must not yield a truncated listing"
    );
    let unchanged = changes(Some(&after), &after)?;
    assert!(unchanged.matches.is_empty());
    assert_eq!(unchanged.seasons, BTreeSet::from(["season".to_owned()]));
    Ok(())
}

#[test]
fn empty_artifacts_keep_four_members_without_inventing_zero_averages() -> Result<(), String> {
    let members = (1..=4)
        .map(|id| (format!("m{id}"), format!("Player {id}")))
        .collect();
    let empty = artifact("empty", &[]);
    let comparisons =
        ranks(&members, None, &empty, None, false).map_err(|reason| format!("{reason:?}"))?;
    assert!(
        comparisons.iter().all(|rank| rank.before.is_none()
            && rank.after == RankSample::EMPTY
            && rank.delta.is_none()),
        "an empty result is not four zero ranks"
    );
    assert!(
        decode_ranks(
            br#"{"metricsByPlayer":[{"memberId":"m1","denominator":0,"rank":{"average":0}}]}"#
        )
        .is_err(),
        "malformed extraction cannot be treated as a zero sample"
    );
    Ok(())
}

#[test]
fn aggregate_projection_keeps_hand_computed_means_and_rejects_cross_version_deltas()
-> Result<(), String> {
    let members: BTreeMap<_, _> = (1..=4)
        .map(|id| (format!("m{id}"), format!("Player {id}")))
        .collect();
    let samples = |count, averages: [f64; 4]| {
        let value = serde_json::json!({ "metricsByPlayer": averages.into_iter().enumerate().map(|(index, average)|
            serde_json::json!({"memberId": format!("m{}", index + 1), "denominator": count, "rank": {"average": average}})
        ).collect::<Vec<_>>() });
        decode_ranks(value.to_string().as_bytes()).map_err(|reason| format!("{reason:?}"))
    };
    // Two matches [1,2,3,4], [3,1,4,2]. Change the second to [2,1,4,3], then add [4,2,1,3].
    let mut previous = artifact("before", &[]);
    previous
        .scopes
        .insert(None, samples(2, [2.0, 1.5, 3.5, 3.0])?);
    let mut current = artifact("after", &[]);
    current.scopes.insert(
        None,
        samples(3, [7.0 / 3.0, 5.0 / 3.0, 8.0 / 3.0, 10.0 / 3.0])?,
    );
    let compared = ranks(&members, Some(&previous), &current, None, false)
        .map_err(|reason| format!("{reason:?}"))?;
    let first = compared.first().ok_or("four comparisons")?;
    assert_eq!(first.before.map(|sample| sample.match_count), Some(2));
    assert_eq!(first.after.match_count, 3);
    assert_eq!(first.after.average_rank, Some(7.0 / 3.0));
    assert!(
        first
            .delta
            .is_some_and(|delta| (delta - 1.0 / 3.0).abs() < 1e-12),
        "preserve the unrounded hand-computed delta"
    );
    previous.identity.validation_contract_id = None;
    let incomparable = ranks(&members, Some(&previous), &current, None, false)
        .map_err(|reason| format!("{reason:?}"))?;
    assert!(
        incomparable
            .iter()
            .all(|rank| rank.comparison == "incomparable"
                && rank.delta.is_none()
                && rank.before.is_some()),
        "a previous incompatible artifact is distinct from the initial publication"
    );
    Ok(())
}
