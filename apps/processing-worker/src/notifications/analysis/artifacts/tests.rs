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
