use super::*;

#[test]
fn scope_counts_require_complete_seasons_and_exact_denominators() {
    let samples = |count| {
        (1..=4)
            .map(|member| {
                (
                    format!("m{member}"),
                    RankSample {
                        match_count: count,
                        average_rank: Some(f64::from(member)),
                    },
                )
            })
            .collect::<Ranks>()
    };
    let matches = [("first", "a"), ("second", "b"), ("third", "b")]
        .into_iter()
        .map(|(id, season)| {
            (
                id.to_owned(),
                MatchIdentity {
                    source_revision: "1".to_owned(),
                    season_id: season.to_owned(),
                    map_id: "map".to_owned(),
                },
            )
        })
        .collect();
    let mut scopes = BTreeMap::from([
        (None, samples(3)),
        (Some("a".to_owned()), samples(1)),
        (Some("b".to_owned()), samples(2)),
    ]);
    assert!(validate_scope_counts(&scopes, &matches).is_ok());
    scopes.insert(Some("a".to_owned()), samples(3));
    assert!(
        validate_scope_counts(&scopes, &matches).is_err(),
        "a season cannot inherit the overall denominator"
    );
    scopes.insert(Some("a".to_owned()), samples(1));
    scopes.remove(&Some("b".to_owned()));
    assert!(
        validate_scope_counts(&scopes, &matches).is_err(),
        "matches from an absent season aggregate cannot disappear"
    );
    assert!(
        validate_scope_counts(&BTreeMap::from([(None, Ranks::new())]), &BTreeMap::new()).is_ok()
    );
    assert!(
        validate_scope_counts(&BTreeMap::new(), &BTreeMap::new()).is_err(),
        "even an empty artifact requires its overall aggregate"
    );
}

#[test]
fn notification_reader_requires_the_current_attested_format() {
    let mut identity = AnalysisIdentity {
        artifact_id: "artifact".to_owned(),
        input_revision: "1".to_owned(),
        algorithm_version: "series-analysis-v5".to_owned(),
        artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or_default(),
        validation_contract_id: Some(ARTIFACT_VALIDATION_CONTRACT_ID.to_owned()),
    };
    assert!(current_publication(&identity));
    for version in [1, 2, 3, 5] {
        identity.artifact_schema_version = version;
        assert!(!current_publication(&identity));
    }
    identity.artifact_schema_version = i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or_default();
    for contract in [
        None,
        Some("series-analysis-artifact-v3-full-validation-v1"),
        Some("unknown"),
    ] {
        identity.validation_contract_id = contract.map(str::to_owned);
        assert!(!current_publication(&identity));
    }
}

#[test]
fn baseline_pointer_never_interprets_missing_history_as_an_initial_input() {
    assert_eq!(
        BaselinePointer::from_storage("initial", None),
        Ok(BaselinePointer::Initial)
    );
    assert_eq!(
        BaselinePointer::from_storage("unknown", None),
        Ok(BaselinePointer::Unknown)
    );
    assert_eq!(
        BaselinePointer::from_storage("artifact", Some("before".to_owned())),
        Ok(BaselinePointer::Artifact("before".to_owned()))
    );
    for (state, reference) in [
        ("artifact", None),
        ("initial", Some("before".to_owned())),
        ("unknown", Some("before".to_owned())),
        ("unexpected", None),
    ] {
        assert_eq!(
            BaselinePointer::from_storage(state, reference),
            Err(SkipReason::InvalidSnapshot)
        );
    }
}

#[test]
fn input_metadata_is_complete_independently_of_aggregate_json_versions() {
    let matches = [("a", "first"), ("b", "second")]
        .into_iter()
        .map(|(id, season)| {
            (
                id.to_owned(),
                MatchIdentity {
                    source_revision: "1".to_owned(),
                    season_id: season.to_owned(),
                    map_id: "map".to_owned(),
                },
            )
        })
        .collect();
    let complete = BTreeMap::from([
        (None, 8),
        (Some("first".to_owned()), 4),
        (Some("second".to_owned()), 4),
    ]);
    assert!(
        validate_input_counts(&complete, &matches).is_ok(),
        "stable relational counts prove both seasons are represented"
    );
    for scopes in [
        BTreeMap::from([(None, 4)]),
        BTreeMap::from([(None, 8), (Some("first".to_owned()), 8)]),
        BTreeMap::from([
            (Some("first".to_owned()), 4),
            (Some("second".to_owned()), 4),
        ]),
    ] {
        assert_eq!(
            validate_input_counts(&scopes, &matches),
            Err(SkipReason::InvalidSnapshot),
            "missing matches, seasons or overall counts must not be treated as additions"
        );
    }
    assert!(
        validate_input_counts(&BTreeMap::from([(None, 0)]), &BTreeMap::new()).is_ok(),
        "an empty validated input is distinct from missing metadata"
    );
}
