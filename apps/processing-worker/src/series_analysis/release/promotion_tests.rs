use super::*;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "rollback-scoped publication pointers are checked against unchanged artifact bytes"
)]
async fn real_postgres_promotion_detaches_obsolete_empty_title_pointers_without_deleting_artifacts()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = connect(&database_url).await?;
    let transaction = client.transaction().await?;
    transaction
        .batch_execute("TRUNCATE game_titles CASCADE")
        .await?;
    transaction
        .batch_execute(include_str!("promotion_tests/seed.sql"))
        .await?;
    let before = artifacts(&transaction).await?;
    lock_release_state(&transaction).await?;
    let titles = lock_targets(&transaction, PromotionTrigger::InitialBackfill).await?;
    assert_eq!(titles.len(), 3);
    assert!(titles.iter().all(|title| !title.eligible));
    apply_promotion(
        &transaction,
        &PromotionRequest {
            trigger: PromotionTrigger::InitialBackfill,
            operation_key: "current-only-pointers",
            apply: true,
        },
        &titles,
        &PromotionIdentity {
            operation_id: "current-only-pointers-operation",
            campaign_id: "current-only-pointers-campaign",
            endpoint: "release:initial_backfill",
            key_hash: "sha256:current-only-pointers",
        },
    )
    .await?;
    assert_eq!(artifacts(&transaction).await?, before);
    let rows = transaction
        .query(
            "SELECT game_title_id, current_artifact_id, previous_artifact_id, pending_work \
         FROM series_analysis_title_states ORDER BY game_title_id",
            &[],
        )
        .await?;
    for row in rows {
        let title: String = row.try_get(0)?;
        let current: Option<String> = row.try_get(1)?;
        let previous: Option<String> = row.try_get(2)?;
        if title == "obsolete-title" {
            assert_eq!(current, None);
            assert_eq!(previous, None);
            assert!(!row.try_get::<_, bool>(3)?);
        } else {
            let kind = title
                .strip_suffix("-title")
                .ok_or("invalid fixture title")?;
            assert_eq!(current, Some(format!("{kind}-current")));
            assert_eq!(previous, Some(format!("{kind}-previous")));
        }
    }
    for row in title_audit_rows(&transaction).await? {
        let mut violations = Vec::new();
        inspect_title(&row, true, true, &mut violations);
        if row.game_title_id == "stale-title" {
            assert_eq!(
                violations
                    .iter()
                    .map(|violation| violation.code)
                    .collect::<Vec<_>>(),
                ["current_version_mismatch"]
            );
        } else {
            assert!(violations.is_empty(), "{violations:?}");
        }
    }
    transaction.rollback().await?;
    Ok(())
}

async fn artifacts(transaction: &Transaction<'_>) -> Result<Value, tokio_postgres::Error> {
    transaction.query_one(
        "SELECT jsonb_build_object(\
           'headers', (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM series_analysis_artifacts a),\
           'chunks', (SELECT jsonb_agg(to_jsonb(c) ORDER BY artifact_id) FROM series_analysis_scope_aggregate_artifacts c))",
        &[],
    ).await?.try_get(0)
}
