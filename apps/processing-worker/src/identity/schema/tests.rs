use super::*;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "the isolated schema test asserts each fail-closed transition and rolls it back"
)]
async fn real_postgres_requires_complete_canonical_columns_and_relationships()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if std::env::var("ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED").as_deref() != Ok("true") {
        return Err("explicit isolated fixture is required".into());
    }
    let url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let client = crate::identity::fixtures::connect(&url).await?;
    require(&client).await?;
    let blocker = crate::postgres::connect_frozen(&url).await?;
    blocker
        .batch_execute("BEGIN; LOCK TABLE matches IN ACCESS EXCLUSIVE MODE")
        .await?;
    let checked = tokio::time::timeout(std::time::Duration::from_secs(3), require(&client)).await;
    blocker.batch_execute("ROLLBACK").await?;
    checked??;
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../docs/schemas/fixtures/identity/canonical-identities-v1.json"
    ))?;
    for case in fixture
        .get("cases")
        .and_then(serde_json::Value::as_array)
        .ok_or("missing identity vectors")?
    {
        let entity = case
            .get("entity")
            .and_then(serde_json::Value::as_str)
            .ok_or("missing entity")?;
        let legacy = case
            .get("legacy")
            .and_then(serde_json::Value::as_str)
            .ok_or("missing legacy")?;
        let expected = case
            .get("canonical")
            .and_then(serde_json::Value::as_str)
            .ok_or("missing canonical")?
            .parse::<uuid::Uuid>()?;
        let actual = client
            .query_one("SELECT pg_temp.fixture_uuid($1,$2)", &[&entity, &legacy])
            .await?
            .try_get::<_, uuid::Uuid>(0)?;
        assert_eq!(actual, expected);
    }
    for change in [
        "ALTER TABLE ocr_jobs RENAME COLUMN legacy_draft_id TO incomplete_legacy_draft_id",
        "ALTER TABLE series_analysis_artifact_identities DROP CONSTRAINT series_analysis_artifact_identities_source_fk",
        "ALTER TABLE series_analysis_jobs DROP CONSTRAINT series_analysis_jobs_lease_attempt_legacy_null_check",
    ] {
        client.batch_execute("BEGIN").await?;
        client.batch_execute(change).await?;
        let incompatible = require(&client).await;
        client.batch_execute("ROLLBACK").await?;
        assert!(matches!(
            incompatible,
            Err(PostgresError::IncompatibleIdentitySchema)
        ));
        require(&client).await?;
    }
    Ok(())
}
