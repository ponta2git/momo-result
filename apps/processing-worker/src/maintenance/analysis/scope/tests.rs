use super::*;

const TITLE: &str = "maintenance-scope-test-title";
const OPERATION: &str = "maintenance-scope-test-operation";
const CAMPAIGN: &str = "maintenance-scope-test-campaign";

fn request() -> Request {
    Request {
        cutover_id: String::from("maintenance-scope-test"),
        stop_epoch: 1,
        operation_id: String::from(OPERATION),
        campaign_id: String::from(CAMPAIGN),
    }
}

#[tokio::test]
#[ignore = "requires explicitly isolated MAINTENANCE_ANALYSIS_SMOKE_DATABASE_URL with the current publication contract"]
async fn real_postgres_scoped_plan_preserves_binding_and_refuses_unrelated_work()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = std::env::var("MAINTENANCE_ANALYSIS_SMOKE_DATABASE_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    create_fixture(&mut client).await?;
    let verified = exercise(&mut client).await;
    // Only the named fixture's own rows are removed. An interrupted test never resets a database.
    let cleanup = client.batch_execute(
        "DELETE FROM series_analysis_campaign_targets WHERE campaign_id='maintenance-scope-test-campaign';
         DELETE FROM series_analysis_job_requests WHERE campaign_id='maintenance-scope-test-campaign';
         DELETE FROM series_analysis_jobs WHERE game_title_id='maintenance-scope-test-title';
         DELETE FROM series_analysis_campaigns WHERE id='maintenance-scope-test-campaign';
         DELETE FROM series_analysis_operation_requests WHERE id='maintenance-scope-test-operation';
         DELETE FROM game_titles WHERE id='maintenance-scope-test-title';"
    ).await;
    verified?;
    cleanup?;
    Ok(())
}

async fn create_fixture(client: &mut Client) -> Result<(), tokio_postgres::Error> {
    let transaction = client.transaction().await?;
    transaction.execute("INSERT INTO game_titles (id,name,layout_family,display_order) VALUES ($1,'Scoped maintenance fixture','momotetsu_2',9998)", &[&TITLE]).await?;
    transaction.execute(
        "INSERT INTO series_analysis_operation_requests (id,scope,idempotency_key_hash,endpoint,target_count) VALUES ($1,'all_titles',repeat('1',64),'release:initial_backfill',1)", &[&OPERATION]
    ).await?;
    transaction.execute(
        "INSERT INTO series_analysis_campaigns (id,operation_request_id,trigger,algorithm_version,artifact_schema_version,validation_contract_id,target_count) SELECT $1,$2,'initial_backfill',algorithm_version,artifact_schema_version,validation_contract_id,1 FROM series_analysis_release_state WHERE singleton_key='current'", &[&CAMPAIGN,&OPERATION]
    ).await?;
    transaction.execute(
        "INSERT INTO series_analysis_campaign_targets (campaign_id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id) SELECT $1,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id FROM series_analysis_title_states WHERE game_title_id=$2", &[&CAMPAIGN,&TITLE]
    ).await?;
    transaction.commit().await
}

async fn exercise(client: &mut Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let request = request();
    let initial = inspect(client, &request).await?;
    assert_eq!(initial.status, "planned");
    assert_eq!(initial.target_count, 1);
    let scope = BoundScope {
        request: request.clone(),
        plan_digest: initial.plan_digest.clone(),
        process_id: 1,
    };
    let wrong = BoundScope {
        plan_digest: String::from("sha256:unapproved"),
        ..scope.clone()
    };
    assert!(
        crate::series_analysis::materialization::expand_scoped_campaign_target(
            client, &wrong, TITLE
        )
        .await
        .is_err(),
        "wrong plan must not materialize a target"
    );
    assert_eq!(
        inspect(client, &request)
            .await?
            .next_pending_title
            .as_deref(),
        Some(TITLE)
    );
    crate::series_analysis::materialization::expand_scoped_campaign_target(client, &scope, TITLE)
        .await?;
    let expanded = inspect(client, &request).await?;
    assert_eq!(expanded.plan_digest, initial.plan_digest);
    assert!(
        expanded.next_pending_title.is_none(),
        "only the approved target was materialized"
    );
    assert!(
        expanded.next_job.is_some(),
        "the approved target owns its queued job"
    );
    let mut different_operation = request.clone();
    different_operation.operation_id = String::from("not-the-approved-operation");
    assert!(
        matches!(
            inspect(client, &different_operation).await,
            Err(ScopeError::Scope)
        ),
        "campaign identity must bind the operation"
    );
    verify_generation_fence(client, &scope).await?;
    verify_radar_binding(client, &scope).await?;
    verify_foreign_request_fence(client, &scope).await?;
    verify_slot_fence(client, &scope).await?;
    assert_eq!(
        inspect(client, &request).await?.plan_digest,
        initial.plan_digest
    );
    Ok(())
}

async fn verify_radar_binding(
    client: &mut Client,
    scope: &BoundScope,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let transaction = client.transaction().await?;
    transaction
        .execute(
            "INSERT INTO series_radar_title_states (game_title_id) VALUES ($1)",
            &[&TITLE],
        )
        .await?;
    scope.accept(&inspect_in(&transaction, &scope.request).await?)?;
    transaction
        .execute(
            "UPDATE series_radar_title_states SET generation=generation+1 WHERE game_title_id=$1",
            &[&TITLE],
        )
        .await?;
    assert!(
        scope
            .accept(&inspect_in(&transaction, &scope.request).await?)
            .is_err(),
        "publication may initialize the default state but cannot change the approved radar generation"
    );
    transaction.rollback().await?;
    Ok(())
}

async fn verify_generation_fence(
    client: &mut Client,
    scope: &BoundScope,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let transaction = client.transaction().await?;
    transaction.execute("UPDATE series_analysis_release_state SET updated_at=updated_at+interval '1 second' WHERE singleton_key='current'", &[]).await?;
    assert!(
        scope
            .accept(&inspect_in(&transaction, &scope.request).await?)
            .is_err(),
        "a different release generation must invalidate approval"
    );
    transaction.rollback().await?;
    Ok(())
}

async fn verify_foreign_request_fence(
    client: &mut Client,
    scope: &BoundScope,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let transaction = client.transaction().await?;
    transaction.execute(
        "INSERT INTO series_analysis_job_requests (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,trigger) SELECT 'maintenance-foreign-request',game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,'manual' FROM series_analysis_title_states WHERE game_title_id=$1", &[&TITLE]
    ).await?;
    assert_eq!(
        inspect_in(&transaction, &scope.request).await?.status,
        "attention_required"
    );
    transaction.rollback().await?;
    Ok(())
}

async fn verify_slot_fence(
    client: &mut Client,
    scope: &BoundScope,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let transaction = client.transaction().await?;
    transaction.execute("UPDATE worker_execution_slots SET preempt_requested_by='maintenance-foreign-worker',preempt_requested_at=clock_timestamp() WHERE slot_key='shared-heavy-work'", &[]).await?;
    assert_eq!(
        inspect_in(&transaction, &scope.request).await?.status,
        "attention_required"
    );
    transaction.rollback().await?;
    Ok(())
}
