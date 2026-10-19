use std::collections::BTreeSet;

use tokio_postgres::types::{Json, Type};

use super::*;

const HISTORY_SEASONS: i32 = 20;
const DESTINATION_SEASON: &str = "analysis-notification-limit-season-1";
const DESTINATION_MATCH: &str = "analysis-notification-limit-match-1";

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_notification_reader_preserves_history_and_selects_affected_ranks()
-> SmokeResult {
    let _logging = tracing_subscriber::fmt().with_test_writer().try_init();
    let mut harness = Harness::start().await?;
    limits::seed_matches(&harness.client, HISTORY_SEASONS, HISTORY_SEASONS).await?;
    let first = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    harness.publish(&first, &["match_mutation"]).await?;
    limits::assert_business_success(&harness.client, &first).await?;

    // The initial notification exceeds the affected-season bound, but advances its baseline.
    // A single edit reads the full history and only the overall/affected-season rank payloads.
    edit_match(&harness.client, MATCH_ID).await?;
    let changed = next_revision(&harness.client, &first, "reader-edited").await?;
    harness.publish(&changed, &["match_mutation"]).await?;
    let payload = harness.expect_matches(&changed, &[MATCH_ID]).await?;
    assert_season_counts(&payload, SEASON_ID, 1, 1)?;
    assert_overall_counts(&payload, HISTORY_SEASONS, HISTORY_SEASONS)?;
    verify_read_volume(&harness.client, &first, &changed).await?;

    let noop = next_revision(&harness.client, &changed, "reader-noop").await?;
    harness.publish(&noop, &["match_mutation"]).await?;
    limits::assert_business_success(&harness.client, &noop).await?;

    // Moving the only match out of a season removes that new aggregate. Both old and new
    // season IDs must still be selected, with an empty result for the removed season.
    harness.client.execute(
        "UPDATE matches SET season_master_id=$2, analysis_revision=analysis_revision+1 WHERE id=$1",
        &[&MATCH_ID, &DESTINATION_SEASON],
    ).await?;
    let moved = next_revision(&harness.client, &noop, "reader-moved").await?;
    harness.publish(&moved, &["match_mutation"]).await?;
    let payload = harness.expect_matches(&moved, &[MATCH_ID]).await?;
    assert_eq!(
        payload
            .pointer("/data/seasons")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(2)
    );
    assert_season_counts(&payload, SEASON_ID, 1, 0)?;
    assert_season_counts(&payload, DESTINATION_SEASON, 1, 2)?;
    assert_overall_counts(&payload, HISTORY_SEASONS, HISTORY_SEASONS)?;

    harness
        .client
        .execute(
            "DELETE FROM matches WHERE id=ANY($1::text[])",
            &[&vec![MATCH_ID, DESTINATION_MATCH]],
        )
        .await?;
    let deleted = next_revision(&harness.client, &moved, "reader-deleted").await?;
    harness.publish(&deleted, &["match_mutation"]).await?;
    let payload = harness.expect_matches(&deleted, &[]).await?;
    assert_eq!(
        payload
            .pointer("/data/seasons")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(1)
    );
    assert_season_counts(&payload, DESTINATION_SEASON, 2, 0)?;
    assert_overall_counts(&payload, HISTORY_SEASONS, HISTORY_SEASONS - 2)?;
    limits::assert_business_success(&harness.client, &deleted).await?;
    harness.finish().await
}

async fn verify_read_volume(
    client: &Client,
    previous: &ClaimedJob,
    current: &ClaimedJob,
) -> SmokeResult {
    let ids = vec![
        artifact_id_for_attempt(&previous.attempt_id),
        artifact_id_for_attempt(&current.attempt_id),
    ];
    // Execute the production SQL against real published artifacts. Counts are structural
    // evidence of transferred/decoded data; this fixture makes no wall-clock speed claim.
    let headers = client
        .query_typed(
            include_str!("../../../../../notifications/analysis/artifacts/header.sql"),
            &[
                (&ids, Type::TEXT_ARRAY),
                (&TITLE_ID, Type::TEXT),
                (&129_i64, Type::INT8),
            ],
        )
        .await?;
    assert_eq!(headers.len(), 2);
    let mut all_seasons = BTreeSet::new();
    for header in headers {
        assert_eq!(
            header.try_get::<_, i64>("scope_count")?,
            i64::from(HISTORY_SEASONS + 1)
        );
        let metadata: Json<Vec<(Option<String>, i32)>> = header.try_get("scope_metadata")?;
        all_seasons.extend(metadata.0.into_iter().filter_map(|(season, _count)| season));
    }
    let match_sql = include_str!("../../../../../notifications/analysis/artifacts/matches.sql");
    for limit in [25_001_i64, 2] {
        let matches = client
            .query_typed(match_sql, &[(&ids, Type::TEXT_ARRAY), (&limit, Type::INT8)])
            .await?;
        for id in &ids {
            assert_eq!(
                matches
                    .iter()
                    .filter(|row| row.get::<_, &str>(0) == id)
                    .count(),
                usize::try_from(limit.min(i64::from(HISTORY_SEASONS)))?,
                "identity limits apply to each artifact, not to the combined history"
            );
        }
    }
    let rank_sql = include_str!("../../../../../notifications/analysis/artifacts/scopes.sql");
    let all_seasons: Vec<_> = all_seasons.into_iter().collect();
    let historical = client
        .query_typed(
            rank_sql,
            &[(&ids, Type::TEXT_ARRAY), (&all_seasons, Type::TEXT_ARRAY)],
        )
        .await?;
    let selected = client
        .query_typed(
            rank_sql,
            &[
                (&ids, Type::TEXT_ARRAY),
                (&vec![SEASON_ID], Type::TEXT_ARRAY),
            ],
        )
        .await?;
    assert_eq!(
        historical.len(),
        usize::try_from((HISTORY_SEASONS + 1) * 2)?
    );
    assert_eq!(
        selected.len(),
        4,
        "before/after each read overall and one season"
    );
    let bytes = |rows: &[tokio_postgres::Row]| {
        rows.iter()
            .map(|row| row.try_get::<_, &[u8]>(2).map(<[u8]>::len))
            .sum::<Result<usize, _>>()
    };
    let historical_bytes = bytes(&historical)?;
    let selected_bytes = bytes(&selected)?;
    assert!(
        selected_bytes < historical_bytes,
        "unaffected rank payloads must not be transferred"
    );
    tracing::info!(
        event = "notification_fixture_scope_read_volume",
        historical_scope_rows = historical.len(),
        selected_scope_rows = selected.len(),
        historical_bytes,
        selected_bytes,
    );
    Ok(())
}

fn assert_season_counts(body: &Value, id: &str, before: i32, after: i32) -> SmokeResult {
    let season = body
        .pointer("/data/seasons")
        .and_then(Value::as_array)
        .ok_or("season aggregates")?
        .iter()
        .find(|season| season.get("seasonId").and_then(Value::as_str) == Some(id))
        .ok_or("affected season aggregate")?;
    assert_samples(season.get("ranks").ok_or("season ranks")?, before, after)
}

fn assert_overall_counts(body: &Value, before: i32, after: i32) -> SmokeResult {
    assert_samples(
        body.pointer("/data/overall").ok_or("overall ranks")?,
        before,
        after,
    )
}

fn assert_samples(ranks: &Value, before: i32, after: i32) -> SmokeResult {
    let ranks = ranks.as_array().ok_or("four rank samples")?;
    assert_eq!(ranks.len(), 4);
    for rank in ranks {
        assert_eq!(rank.pointer("/before/matchCount"), Some(&json!(before)));
        assert_eq!(rank.pointer("/after/matchCount"), Some(&json!(after)));
        if after == 0 {
            assert_eq!(rank.get("comparison"), Some(&json!("empty")));
            assert_eq!(rank.pointer("/after/averageRank"), Some(&Value::Null));
        }
    }
    Ok(())
}
