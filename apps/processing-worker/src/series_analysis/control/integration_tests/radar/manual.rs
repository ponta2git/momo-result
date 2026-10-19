use super::{publication::*, *};

fn entered_values() -> SmokeResult<serde_json::Value> {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../../../docs/schemas/fixtures/series-analysis/radar-manual-scoring-v1.json"
    ))?;
    fixture
        .get("input")
        .cloned()
        .ok_or_else(|| "manual scoring input missing".into())
}

async fn manual_candidate(client: &Client, candidate: &str, source_basis: &str) -> SmokeResult {
    // The API replaces the one active shared candidate when a manual save is accepted.
    client.execute(
        "UPDATE series_radar_candidates SET status='withdrawn' WHERE game_title_id=$1 AND status IN ('pending','ready','unavailable','failed')",
        &[&TITLE_ID],
    ).await?;
    client.execute(
        "INSERT INTO series_radar_candidates (id,game_title_id,status,origin_kind,manual_input,source_basis_id,source_candidate_id,saved_by,saved_by_display_name) VALUES ($1,$2,'pending','manual',$3,$4,$4,'account_ponta','Saved Operator')",
        &[&candidate,&TITLE_ID,&entered_values()?,&source_basis],
    ).await?;
    operation(
        client,
        &format!("{candidate}-save"),
        "manual",
        candidate,
        None,
        None,
    )
    .await
}

async fn latest_preview(client: &Client, candidate: &str) -> SmokeResult<String> {
    client.query_one(
        "SELECT id FROM series_radar_previews WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
        &[&candidate],
    ).await?.try_get(0).map_err(Into::into)
}

async fn recompare(
    client: &mut Client,
    config: &AnalysisConsumerConfig,
    candidate: &str,
    operation_id: &str,
) -> SmokeResult<String> {
    operation(client, operation_id, "preview", candidate, None, None).await?;
    let claim = claim_next(client, config).await?;
    let (directory, prepared) = prepare(client, &claim).await?;
    assert!(
        prepared.manual_basis.is_none(),
        "recomparison keeps the existing manual criteria"
    );
    finish_preparation(client, &claim, config, &directory).await?;
    latest_preview(client, candidate).await
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_manual_radar_recomparison_publication_restore_and_history_are_coherent()
-> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    seed(&client).await?;
    let runtime = TempDir::new()?;
    let config = notifications::config(&database_url, NotificationSink::default(), runtime.path())?;
    prepare_candidate(&mut client, &config, "radar-manual-origin").await?;
    client
        .execute(
            "UPDATE series_radar_candidates SET status='withdrawn' WHERE id='radar-manual-origin'",
            &[],
        )
        .await?;
    manual_candidate(&client, "radar-manual", "radar-manual-origin").await?;
    let first = claim_next(&mut client, &config).await?;
    let (directory, prepared) = prepare(&mut client, &first).await?;
    assert!(
        prepared.manual_basis.is_some(),
        "first formal comparison fixes a manual basis"
    );
    let overall = prepared
        .scopes
        .iter()
        .find(|scope| scope.scope.key() == "overall")
        .ok_or("overall comparison")?;
    assert!(
        overall
            .payload
            .before
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|axis| axis.score.is_none()),
        "initial application does not invent before scores"
    );
    assert!(
        overall
            .payload
            .after
            .players
            .iter()
            .flat_map(|player| &player.axes)
            .all(|axis| axis.score.is_some()),
        "initial after can be scored"
    );
    finish_preparation(&mut client, &first, &config, &directory).await?;
    let initial_payload: serde_json::Value = client
        .query_one(
            "SELECT payload FROM series_radar_bases WHERE id='radar-manual'",
            &[],
        )
        .await?
        .try_get(0)?;
    assert_eq!(
        initial_payload
            .pointer("/manual/monitoringSource/matchCount")
            .and_then(serde_json::Value::as_u64),
        Some(40)
    );

    freshness::add_record(&client).await?;
    let reviewed = recompare(
        &mut client,
        &config,
        "radar-manual",
        "radar-manual-recompare-1",
    )
    .await?;
    let refreshed: serde_json::Value = client
        .query_one(
            "SELECT payload FROM series_radar_bases WHERE id='radar-manual'",
            &[],
        )
        .await?
        .try_get(0)?;
    assert_eq!(
        refreshed, initial_payload,
        "added records do not move the established monitoring start"
    );
    reserve_apply(
        &client,
        "radar-manual-apply-corrected",
        "radar-manual",
        "radar-manual",
        &reviewed,
    )
    .await?;
    // This record was absent from the first snapshot and from the generated origin. Only the
    // confirmed comparison can detect the correction after acceptance.
    client.execute("UPDATE match_players SET revenue_man_yen=revenue_man_yen+17 WHERE match_id='analysis-radar-smoke-match-added' AND member_id='member_ponta'", &[]).await?;
    client
        .execute(
            "UPDATE series_analysis_title_states SET input_revision=3 WHERE game_title_id=$1",
            &[&TITLE_ID],
        )
        .await?;
    let corrected = claim_next(&mut client, &config).await?;
    let (directory, mut metrics) = artifact(&mut client, &corrected, false).await?;
    let outcome = control::publish(
        &mut client,
        &corrected,
        &config,
        directory.path(),
        &mut metrics,
        tokio::time::Instant::now() + config.execution_limits.finalization_timeout,
    )
    .await?;
    assert_eq!(
        outcome.value,
        PublicationResult::IntegrityFailure(SafeFailureCode::InputContractInvalid)
    );
    assert_current(&client, None).await?;
    assert_eq!(
        candidate_state(&client, "radar-manual").await?,
        ("ready".to_owned(), "stale".to_owned())
    );
    assert_eq!(
        client
            .query_one(
                "SELECT count(*) FROM series_radar_revisions WHERE game_title_id=$1",
                &[&TITLE_ID]
            )
            .await?
            .try_get::<_, i64>(0)?,
        0,
        "failed publication has no revision"
    );
    let recovery = claim_next(&mut client, &config).await?;
    publish(&mut client, &recovery, &config).await?;

    let reviewed = recompare(
        &mut client,
        &config,
        "radar-manual",
        "radar-manual-recompare-2",
    )
    .await?;
    reserve_apply(
        &client,
        "radar-manual-apply",
        "radar-manual",
        "radar-manual",
        &reviewed,
    )
    .await?;
    let apply = claim_next(&mut client, &config).await?;
    publish(&mut client, &apply, &config).await?;
    current(&client, "radar-manual").await?;
    let revision = client.query_one(
        "SELECT before_basis_id,after_basis_id,change_kind,saved_by_display_name FROM series_radar_revisions WHERE operation_id='radar-manual-apply'", &[],
    ).await?;
    assert!(revision.try_get::<_, Option<String>>(0)?.is_none());
    assert_eq!(revision.try_get::<_, String>(1)?, "radar-manual");
    assert_eq!(revision.try_get::<_, String>(2)?, "manual");
    assert_eq!(revision.try_get::<_, String>(3)?, "Saved Operator");

    // A later generated application can be restored to manual criteria without using the old
    // generated source as an invalidation condition or moving the manual monitoring boundary.
    operation(
        &client,
        "radar-generated-next-create",
        "candidate",
        "radar-generated-next",
        None,
        None,
    )
    .await?;
    let next = claim_next(&mut client, &config).await?;
    let (directory, _) = prepare(&mut client, &next).await?;
    finish_preparation(&mut client, &next, &config, &directory).await?;
    let next_preview = latest_preview(&client, "radar-generated-next").await?;
    reserve_apply(
        &client,
        "radar-generated-next-apply",
        "radar-generated-next",
        "radar-generated-next",
        &next_preview,
    )
    .await?;
    let next_apply = claim_next(&mut client, &config).await?;
    publish(&mut client, &next_apply, &config).await?;
    restore(&mut client, &config, "radar-manual-restore", "radar-manual").await?;
    client.execute(
        "UPDATE series_radar_candidates SET safe_failure_code='evaluation_changed' WHERE id='radar-manual-restore'",
        &[],
    ).await?;
    let restored = recompare(
        &mut client,
        &config,
        "radar-manual-restore",
        "radar-manual-restore-recompare",
    )
    .await?;
    assert!(client.query_one(
        "SELECT safe_failure_code FROM series_radar_candidates WHERE id='radar-manual-restore'",
        &[],
    ).await?.try_get::<_, Option<String>>(0)?.is_none(), "successful restored-manual comparison clears an earlier evaluation failure");
    reserve_apply(
        &client,
        "radar-manual-reapply",
        "radar-manual-restore",
        "radar-manual",
        &restored,
    )
    .await?;
    let reapply = claim_next(&mut client, &config).await?;
    publish(&mut client, &reapply, &config).await?;
    current(&client, "radar-manual").await?;
    let row = client.query_one("SELECT b.payload,r.change_kind FROM series_radar_bases b JOIN series_radar_revisions r ON r.after_basis_id=b.id WHERE r.operation_id='radar-manual-reapply'", &[]).await?;
    assert_eq!(row.try_get::<_, serde_json::Value>(0)?, initial_payload);
    assert_eq!(row.try_get::<_, String>(1)?, "restore");

    control::history::cleanup_history(
        &mut client,
        std::time::SystemTime::now() + Duration::from_hours(1440),
        100,
    )
    .await?;
    let retained = client.query_one(
        "SELECT (SELECT count(*) FROM series_radar_revisions WHERE game_title_id=$1),(SELECT evaluation_snapshot IS NULL FROM series_radar_previews WHERE id=$2),(SELECT payload FROM series_radar_bases WHERE id='radar-manual')",
        &[&TITLE_ID,&reviewed],
    ).await?;
    assert_eq!(
        retained.try_get::<_, i64>(0)?,
        3,
        "only successful applications produce retained revisions"
    );
    assert!(
        retained.try_get::<_, bool>(1)?,
        "obsolete comparison snapshot was cleaned"
    );
    assert_eq!(
        retained.try_get::<_, serde_json::Value>(2)?,
        initial_payload,
        "manual monitoring start and thresholds survive cleanup"
    );
    drop(config);
    clean(&client).await
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_manual_radar_empty_first_comparison_and_withdrawal_never_fix_a_basis()
-> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    seed(&client).await?;
    let runtime = TempDir::new()?;
    let config = notifications::config(&database_url, NotificationSink::default(), runtime.path())?;
    prepare_candidate(&mut client, &config, "radar-empty-origin").await?;
    manual_candidate(&client, "radar-empty-manual", "radar-empty-origin").await?;
    client.batch_execute("CREATE TEMP TABLE radar_manual_matches AS SELECT * FROM matches; CREATE TEMP TABLE radar_manual_players AS SELECT * FROM match_players").await?;
    client
        .execute("DELETE FROM matches WHERE game_title_id=$1", &[&TITLE_ID])
        .await?;
    client
        .execute(
            "UPDATE series_analysis_title_states SET input_revision=2 WHERE game_title_id=$1",
            &[&TITLE_ID],
        )
        .await?;
    let empty = claim_next(&mut client, &config).await?;
    let (directory, prepared) = prepare(&mut client, &empty).await?;
    assert!(prepared.manual_basis.is_none());
    finish_preparation(&mut client, &empty, &config, &directory).await?;
    let saved = client.query_one("SELECT c.manual_input IS NOT NULL,c.basis_id,c.status,c.safe_failure_code,(SELECT count(*) FROM series_radar_bases b WHERE b.id=c.id) FROM series_radar_candidates c WHERE c.id='radar-empty-manual'", &[]).await?;
    assert!(
        saved.try_get::<_, bool>(0)?,
        "the shared entered values survive zero records"
    );
    assert!(saved.try_get::<_, Option<String>>(1)?.is_none());
    assert_eq!(saved.try_get::<_, String>(2)?, "unavailable");
    assert_eq!(saved.try_get::<_, String>(3)?, "no_matches");
    assert_eq!(saved.try_get::<_, i64>(4)?, 0);

    client
        .execute(
            "INSERT INTO matches SELECT * FROM radar_manual_matches WHERE game_title_id=$1",
            &[&TITLE_ID],
        )
        .await?;
    client.execute("INSERT INTO match_players SELECT p.* FROM radar_manual_players p JOIN radar_manual_matches m ON m.id=p.match_id WHERE m.game_title_id=$1", &[&TITLE_ID]).await?;
    client
        .execute(
            "UPDATE series_analysis_title_states SET input_revision=3 WHERE game_title_id=$1",
            &[&TITLE_ID],
        )
        .await?;
    operation(
        &client,
        "radar-empty-manual-retry",
        "preview",
        "radar-empty-manual",
        None,
        None,
    )
    .await?;
    let retry = claim_next(&mut client, &config).await?;
    let (directory, prepared) = prepare(&mut client, &retry).await?;
    assert!(prepared.manual_basis.is_some());
    finish_preparation(&mut client, &retry, &config, &directory).await?;
    assert_eq!(
        candidate_state(&client, "radar-empty-manual").await?,
        ("ready".to_owned(), "ready".to_owned())
    );
    assert_eq!(client.query_one("SELECT source_input_revision FROM series_radar_bases WHERE id='radar-empty-manual'", &[]).await?.try_get::<_, i64>(0)?, 3);

    manual_candidate(&client, "radar-withdrawn-manual", "radar-empty-origin").await?;
    let withdrawn = claim_next(&mut client, &config).await?;
    let (directory, _) = prepare(&mut client, &withdrawn).await?;
    client.execute("UPDATE series_radar_candidates SET status='withdrawn' WHERE id='radar-withdrawn-manual'", &[]).await?;
    client.execute("UPDATE series_radar_operations SET status='withdrawn' WHERE id='radar-withdrawn-manual-save'", &[]).await?;
    finish_preparation(&mut client, &withdrawn, &config, &directory).await?;
    assert_eq!(
        client
            .query_one(
                "SELECT count(*) FROM series_radar_bases WHERE id='radar-withdrawn-manual'",
                &[]
            )
            .await?
            .try_get::<_, i64>(0)?,
        0,
        "withdrawal wins before the first immutable basis is saved"
    );
    drop(config);
    clean(&client).await
}
