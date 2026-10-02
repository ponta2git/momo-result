use super::*;

const MATCH_PREFIX: &str = "analysis-notification-limit-match-";

#[tokio::test]
#[expect(
    clippy::significant_drop_tightening,
    reason = "finish consumes the harness and asynchronously drains and cleans its resources"
)]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_maximum_standard_notification_exports_consumer_fixture() -> SmokeResult {
    let mut harness = Harness::start().await?;
    let names = harness
        .client
        .query("SELECT id, display_name FROM members ORDER BY id", &[])
        .await?
        .into_iter()
        .map(|row| Ok((row.try_get::<_, String>(0)?, row.try_get::<_, String>(1)?)))
        .collect::<Result<Vec<_>, tokio_postgres::Error>>()?;
    let result = maximum_snapshot(&mut harness).await;
    for (id, name) in names {
        harness
            .client
            .execute(
                "UPDATE members SET display_name=$2 WHERE id=$1",
                &[&id, &name],
            )
            .await?;
    }
    harness.finish().await?;
    result
}

async fn maximum_snapshot(harness: &mut Harness) -> SmokeResult {
    seed_matches(&harness.client, 50, 16).await?;
    for (table, id, index) in [("game_titles", TITLE_ID, 0), ("map_masters", MAP_ID, 1)] {
        harness
            .client
            .execute(
                &format!("UPDATE {table} SET name=$2 WHERE id=$1"),
                &[&id, &boundary_text(256, index)?],
            )
            .await?;
    }
    let seasons = harness
        .client
        .query(
            "SELECT id FROM season_masters WHERE game_title_id=$1 ORDER BY id",
            &[&TITLE_ID],
        )
        .await?;
    for (index, season) in seasons.into_iter().enumerate() {
        harness
            .client
            .execute(
                "UPDATE season_masters SET name=$2 WHERE id=$1",
                &[
                    &season.try_get::<_, String>(0)?,
                    &boundary_text(256, index)?,
                ],
            )
            .await?;
    }
    for (index, id) in MEMBER_IDS.into_iter().enumerate() {
        harness
            .client
            .execute(
                "UPDATE members SET display_name=$2 WHERE id=$1",
                &[&id, &boundary_text(32, index)?],
            )
            .await?;
    }
    harness.client.execute(
        "UPDATE matches SET note_body=$2, note_version=1, note_updated_by_account_id='account_ponta', \
         note_updated_at=clock_timestamp() WHERE game_title_id=$1",
        &[&TITLE_ID, &boundary_text(150, 0)?],
    ).await?;
    let first = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    harness.publish(&first, &["match_mutation"]).await?;
    assert_business_success(&harness.client, &first).await?;
    let ids: Vec<_> = std::iter::once(MATCH_ID.to_owned())
        .chain((1..50).map(|index| format!("{MATCH_PREFIX}{index}")))
        .collect();
    let expected: Vec<_> = ids.iter().map(String::as_str).collect();
    let payload = harness.expect_matches(&first, &expected).await?;
    assert_eq!(
        payload
            .pointer("/data/seasons")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(16)
    );
    let body = serde_json::to_string(&payload)?;
    let jsonb_bytes: i32 = harness
        .client
        .query_one("SELECT octet_length($1::text::jsonb::text)", &[&body])
        .await?
        .try_get(0)?;
    assert!(
        body.len() <= 512 * 1024 && jsonb_bytes <= 256 * 1024,
        "the complete producer envelope must fit HTTP and canonical JSONB admission"
    );
    assert!(
        usize::try_from(jsonb_bytes)? > body.len(),
        "the consumer byte oracle includes JSONB formatting, not only compact serialization"
    );
    if let Ok(path) = std::env::var("ANALYSIS_NOTIFICATION_LIMIT_FIXTURE_PATH") {
        fs::write(
            path,
            serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "body": body,
                "wireBytes": body.len(),
                "jsonbBytes": jsonb_bytes
            }))?,
        )?;
    }
    Ok(())
}

#[tokio::test]
#[expect(
    clippy::significant_drop_tightening,
    reason = "finish consumes the harness and asynchronously drains and cleans its resources"
)]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_notification_limits_preserve_success_and_baseline() -> SmokeResult {
    for (matches, seasons, label) in [(51, 16, "over-matches"), (17, 17, "over-seasons")] {
        let mut harness = Harness::start().await?;
        seed_matches(&harness.client, matches, seasons).await?;
        let first = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
        harness.publish(&first, &["match_mutation"]).await?;
        assert_business_success(&harness.client, &first).await?;

        // A skipped whole notification still consumes its baseline. The next small edit
        // must read all 17+ historical scopes/matches but notify only the one changed row.
        edit_match(&harness.client, MATCH_ID).await?;
        let changed = next_revision(&harness.client, &first, label).await?;
        harness.publish(&changed, &["match_mutation"]).await?;
        assert_business_success(&harness.client, &changed).await?;
        let payload = harness.expect_matches(&changed, &[MATCH_ID]).await?;
        assert_eq!(
            payload
                .pointer("/data/seasons")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        for (pointer, count) in [
            ("/data/overall", matches),
            ("/data/seasons/0/ranks", (matches - 1) / seasons + 1),
        ] {
            let ranks = payload
                .pointer(pointer)
                .and_then(Value::as_array)
                .ok_or("rank samples")?;
            assert_eq!(ranks.len(), 4);
            for rank in ranks {
                assert_eq!(rank.pointer("/before/matchCount"), Some(&json!(count)));
                assert_eq!(rank.pointer("/after/matchCount"), Some(&json!(count)));
            }
        }
        harness.finish().await?;
    }
    Ok(())
}

async fn assert_business_success(client: &Client, claim: &ClaimedJob) -> SmokeResult {
    let row = client
        .query_one(
            "SELECT j.status, a.status, a.outcome FROM series_analysis_jobs j \
         JOIN series_analysis_job_attempts a ON a.id=$2 WHERE j.id=$1",
            &[&claim.job_id, &claim.attempt_id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "succeeded");
    assert_eq!(row.try_get::<_, String>(1)?, "terminal");
    assert_eq!(row.try_get::<_, String>(2)?, "succeeded");
    assert_baseline(client, &artifact_id_for_attempt(&claim.attempt_id)).await
}

async fn seed_matches(client: &Client, match_count: i32, season_count: i32) -> SmokeResult {
    client
        .execute(
            "INSERT INTO season_masters (id, game_title_id, name, display_order) \
         SELECT 'analysis-notification-limit-season-' || n, $1, 'Limit season ' || n, 10000+n \
         FROM generate_series(1,$2::integer-1) n",
            &[&TITLE_ID, &season_count],
        )
        .await?;
    client.execute(
        "INSERT INTO matches (id,held_event_id,match_no_in_event,game_title_id,layout_family, \
         season_master_id,owner_member_id,map_master_id,played_at,created_by_account_id,created_by_member_id,analysis_revision) \
         SELECT 'analysis-notification-limit-match-' || n, m.held_event_id, n+1, m.game_title_id, m.layout_family, \
         CASE WHEN n % $3::integer = 0 THEN m.season_master_id ELSE 'analysis-notification-limit-season-' || (n % $3::integer) END, \
         m.owner_member_id,m.map_master_id,m.played_at + n * interval '1 day',m.created_by_account_id,m.created_by_member_id,1 \
         FROM matches m CROSS JOIN generate_series(1,$2::integer-1) n WHERE m.id=$1",
        &[&MATCH_ID, &match_count, &season_count],
    ).await?;
    client.execute(
        "INSERT INTO match_players (match_id,member_id,play_order,rank,total_assets_man_yen,revenue_man_yen) \
         SELECT m.id,p.member_id,p.play_order,p.rank,p.total_assets_man_yen,p.revenue_man_yen \
         FROM matches m CROSS JOIN match_players p WHERE m.game_title_id=$1 AND m.id<>$2 AND p.match_id=$2",
        &[&TITLE_ID, &MATCH_ID],
    ).await?;
    Ok(())
}

fn boundary_text(points: usize, index: usize) -> SmokeResult<String> {
    let last = char::from_u32(0x1f600 + u32::try_from(index)?).ok_or("fixture Unicode point")?;
    // Every point renders to two UTF-16 units: astral Unicode or escaped Markdown.
    // The trailing slash also distinguishes JSON string escaping from SQL JSONB spacing.
    Ok(format!("{}{last}\\", "😀*".repeat((points - 2) / 2)))
}
