use super::*;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_radar_preparation_checks_current_source_and_preserves_pending_analysis()
-> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    seed(&client).await?;
    let runtime = TempDir::new()?;
    let config = notifications::config(&database_url, NotificationSink::default(), runtime.path())?;

    operation(
        &client,
        "radar-create-a",
        "candidate",
        "radar-candidate-a",
        None,
        None,
    )
    .await?;
    let claim = claim_next(&mut client, &config).await?;
    let (directory, prepared) = prepare(&mut client, &claim).await?;
    assert!(prepared.candidate_source_valid);
    // A new complete match does not alter any generation-source fact, but the frozen comparison
    // must visibly become stale. A waiting normal request is not fulfilled by preparation.
    add_record(&client).await?;
    client.execute(r"
        INSERT INTO series_analysis_job_requests (id, legacy_id, game_title_id, legacy_game_title_id, input_revision,
                                                  algorithm_version, artifact_schema_version, validation_contract_id, trigger, force_run, status)
        SELECT pg_temp.fixture_uuid('series_analysis_job_requests', 'radar-waiting-normal'), 'radar-waiting-normal',
               series_analysis_title_states.game_title_id, (SELECT fixture_parent.legacy_id
                FROM game_titles AS fixture_parent
                WHERE fixture_parent.id = series_analysis_title_states.game_title_id), input_revision, algorithm_version,
               artifact_schema_version, validation_contract_id, 'manual', FALSE, 'pending'
        FROM series_analysis_title_states
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
        ", &[&TITLE_ID]).await?;
    finish_preparation(&mut client, &claim, &config, &directory).await?;
    assert_eq!(
        candidate_state(&client, "radar-candidate-a").await?,
        ("ready".to_owned(), "stale".to_owned())
    );
    assert_current(&client, None).await?;
    let pending = client.query_one(r"
        SELECT r.status, j.work_kind, j.legacy_radar_operation_id AS radar_operation_id, j.input_revision
        FROM series_analysis_job_requests AS r
             INNER JOIN series_analysis_jobs AS j ON j.legacy_id = (SELECT fixture_parent.legacy_id
                                                                    FROM series_analysis_jobs AS fixture_parent
                                                                    WHERE fixture_parent.id = r.assigned_job_id)
        WHERE r.legacy_id = 'radar-waiting-normal'
        ", &[]).await?;
    assert_eq!(pending.try_get::<_, String>(0)?, "pending");
    assert_eq!(pending.try_get::<_, String>(1)?, "analysis");
    assert!(pending.try_get::<_, Option<String>>(2)?.is_none());
    assert_eq!(pending.try_get::<_, i64>(3)?, 2);

    // Finish that actual normal claim, then refresh the candidate. An edit after the child has
    // returned must invalidate the candidate despite its previously true source-valid flag.
    let normal = claim_next(&mut client, &config).await?;
    let failure = control::finish_failure(
        &mut client,
        &normal,
        &config,
        control::AttemptFailure::failed(SafeFailureCode::CalculationFailed),
        &AttemptMetrics::default(),
    )
    .await?;
    assert_eq!(failure.value, ());
    let preview: String = client
        .query_one(
            r"
                SELECT series_radar_previews.legacy_id AS id
                FROM series_radar_previews
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_radar_candidates AS fixture_parent
                       WHERE fixture_parent.id = series_radar_previews.candidate_id) = 'radar-candidate-a'
                ",
            &[],
        )
        .await?
        .try_get(0)?;
    operation(
        &client,
        "radar-refresh-a",
        "preview",
        "radar-candidate-a",
        Some("radar-candidate-a"),
        Some(&preview),
    )
    .await?;
    let refresh = claim_next(&mut client, &config).await?;
    let (directory, prepared) = prepare(&mut client, &refresh).await?;
    assert!(prepared.candidate_source_valid);
    client
        .execute(
            r"
        UPDATE match_players
        SET revenue_man_yen = revenue_man_yen + 1
        WHERE (SELECT fixture_parent.legacy_id
               FROM matches AS fixture_parent
               WHERE fixture_parent.id = match_players.match_id) = 'analysis-radar-smoke-match-0'
          AND (SELECT fixture_parent.legacy_id
               FROM members AS fixture_parent
               WHERE fixture_parent.id = match_players.member_id) = 'member_ponta'
        ",
            &[],
        )
        .await?;
    client
        .execute(
            r"
                UPDATE series_analysis_title_states
                SET input_revision = 3
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                ",
            &[&TITLE_ID],
        )
        .await?;
    finish_preparation(&mut client, &refresh, &config, &directory).await?;
    assert_eq!(
        candidate_state(&client, "radar-candidate-a").await?,
        ("invalid".to_owned(), "stale".to_owned())
    );
    let saved: serde_json::Value = client
        .query_one(
            r"
        SELECT payload
        FROM series_radar_preview_scopes
        WHERE (SELECT fixture_parent.legacy_id
               FROM series_radar_previews AS fixture_parent
               WHERE fixture_parent.id = series_radar_preview_scopes.preview_id) = $1
          AND scope_key = 'overall'
        ",
            &[&preview],
        )
        .await?
        .try_get(0)?;
    assert_eq!(
        saved
            .pointer("/after/sample/matchCount")
            .and_then(serde_json::Value::as_u64),
        Some(41)
    );
    assert_current(&client, None).await?;

    // A cancellation wins over a late preparation result and leaves no publishable preview.
    operation(
        &client,
        "radar-create-withdrawn",
        "candidate",
        "radar-withdrawn",
        None,
        None,
    )
    .await?;
    let withdrawn = claim_next(&mut client, &config).await?;
    let (directory, _) = prepare(&mut client, &withdrawn).await?;
    client
        .execute(
            r"
                UPDATE series_radar_candidates
                SET status = 'withdrawn'
                WHERE series_radar_candidates.legacy_id = 'radar-withdrawn'
                ",
            &[],
        )
        .await?;
    client
        .execute(
            r"
        UPDATE series_radar_operations
        SET status = 'withdrawn'
        WHERE series_radar_operations.legacy_id = 'radar-create-withdrawn'
        ",
            &[],
        )
        .await?;
    finish_preparation(&mut client, &withdrawn, &config, &directory).await?;
    drop(config);
    let row = client
        .query_one(
            r"
        SELECT c.status, (SELECT count(*)
                FROM series_radar_previews AS p
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_radar_candidates AS fixture_parent
                       WHERE fixture_parent.id = p.candidate_id) = c.legacy_id), (SELECT count(*)
                FROM series_radar_bases AS b
                WHERE b.id = c.legacy_id)
        FROM series_radar_candidates AS c
        WHERE c.legacy_id = 'radar-withdrawn'
        ",
            &[],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "withdrawn");
    assert_eq!(row.try_get::<_, i64>(1)?, 0);
    assert_eq!(row.try_get::<_, i64>(2)?, 0);
    clean(&client).await
}

pub(super) async fn add_record(client: &Client) -> SmokeResult {
    client
        .execute(
            r"
        INSERT INTO matches (id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event, game_title_id,
                             layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_account_id,
                             created_by_member_id, analysis_revision)
        SELECT pg_temp.fixture_uuid('matches', 'analysis-radar-smoke-match-added'), 'analysis-radar-smoke-match-added',
               pg_temp.fixture_uuid('held_events', matches.legacy_held_event_id), matches.legacy_held_event_id, 99,
               matches.game_title_id, layout_family, matches.season_master_id, matches.owner_member_id, matches.map_master_id,
               played_at + CAST('1 day' AS interval), matches.created_by_account_id, matches.created_by_member_id, 1
        FROM matches
        WHERE matches.legacy_id = 'analysis-radar-smoke-match-39'
        ",
            &[],
        )
        .await?;
    client.execute(r"
        INSERT INTO match_players (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
        SELECT pg_temp.fixture_uuid('matches', 'analysis-radar-smoke-match-added'), match_players.member_id, play_order,
               rank, total_assets_man_yen, revenue_man_yen
        FROM match_players
        WHERE (SELECT fixture_parent.legacy_id
               FROM matches AS fixture_parent
               WHERE fixture_parent.id = match_players.match_id) = 'analysis-radar-smoke-match-39'
        ", &[]).await?;
    client
        .execute(
            r"
                UPDATE series_analysis_title_states
                SET input_revision = 2
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
                ",
            &[&TITLE_ID],
        )
        .await?;
    Ok(())
}
