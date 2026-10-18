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
#[ignore = "requires explicitly isolated MAINTENANCE_ANALYSIS_SMOKE_DATABASE_URL"]
async fn real_postgres_scoped_plan_preserves_binding_and_refuses_unrelated_work()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = std::env::var("MAINTENANCE_ANALYSIS_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    create_fixture(&mut client).await?;
    let verified = exercise(&mut client).await;
    // Only the named fixture's own rows are removed. An interrupted test never resets a database.
    let cleanup = client.batch_execute(
        r"
            DELETE FROM series_analysis_campaign_targets
            WHERE (SELECT fixture_parent.legacy_id
                   FROM series_analysis_campaigns AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_campaign_targets.campaign_id) = 'maintenance-scope-test-campaign';
            DELETE FROM series_analysis_job_requests
            WHERE (SELECT fixture_parent.legacy_id
                   FROM series_analysis_campaigns AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_job_requests.campaign_id) = 'maintenance-scope-test-campaign';
            DELETE FROM series_analysis_jobs
            WHERE (SELECT fixture_parent.legacy_id
                   FROM game_titles AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_jobs.game_title_id) = 'maintenance-scope-test-title';
            DELETE FROM series_analysis_campaigns
            WHERE series_analysis_campaigns.legacy_id = 'maintenance-scope-test-campaign';
            DELETE FROM series_analysis_operation_requests
            WHERE series_analysis_operation_requests.legacy_id = 'maintenance-scope-test-operation';
            DELETE FROM game_titles
            WHERE game_titles.legacy_id = 'maintenance-scope-test-title';
            UPDATE series_analysis_release_state r
            SET algorithm_version = saved.algorithm_version,
                artifact_schema_version = saved.artifact_schema_version,
                validation_contract_id = saved.validation_contract_id,
                updated_at = saved.updated_at
            FROM maintenance_scope_original_release saved
            WHERE r.singleton_key = saved.singleton_key;
            DROP TABLE maintenance_scope_original_release;
            "
    ).await;
    verified?;
    cleanup?;
    Ok(())
}

async fn create_fixture(client: &mut Client) -> Result<(), tokio_postgres::Error> {
    let transaction = client.transaction().await?;
    // Fresh migrations retain their historical release tuple. This isolated fixture
    // owns its explicit current-contract setup and restores every singleton column;
    // it must not depend on a previous promotion test's execution order.
    transaction.batch_execute(
        "CREATE TEMPORARY TABLE maintenance_scope_original_release AS SELECT * FROM series_analysis_release_state"
    ).await?;
    transaction.execute(
        "UPDATE series_analysis_release_state SET algorithm_version=$1, artifact_schema_version=$2::bigint::integer, \
         validation_contract_id=$3, updated_at=clock_timestamp() WHERE singleton_key='current'",
        &[&ALGORITHM_VERSION, &i64::from(ARTIFACT_SCHEMA_VERSION), &ARTIFACT_VALIDATION_CONTRACT_ID]
    ).await?;
    transaction.execute(r"
        WITH fixture_titles AS (
               INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
               VALUES (pg_temp.fixture_uuid('game_titles', $1), $1, 'Scoped maintenance fixture', 'momotetsu_2', 9998)
               RETURNING id
             )
          INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
          SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
          FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
          WHERE release.singleton_key = 'current'
          ON CONFLICT (game_title_id) DO NOTHING
        ", &[&TITLE]).await?;
    transaction.execute(
        r"
            INSERT INTO series_analysis_operation_requests (id, legacy_id, scope, idempotency_key_hash, endpoint, target_count)
            VALUES (pg_temp.fixture_uuid('series_analysis_operation_requests', $1), $1, 'all_titles', repeat('1', 64),
                    'release:initial_backfill', 1)
            ", &[&OPERATION]
    ).await?;
    transaction
        .execute(
            r"
            INSERT INTO series_analysis_campaigns (id, legacy_id, operation_request_id, trigger, algorithm_version,
                                                   artifact_schema_version, validation_contract_id, target_count)
            SELECT pg_temp.fixture_uuid('series_analysis_campaigns', $1), $1,
                   pg_temp.fixture_uuid('series_analysis_operation_requests', $2), 'initial_backfill', algorithm_version,
                   artifact_schema_version, validation_contract_id, 1
            FROM series_analysis_release_state
            WHERE singleton_key = 'current'
            ",
            &[&CAMPAIGN, &OPERATION],
        )
        .await?;
    transaction.execute(
        r"
            INSERT INTO series_analysis_campaign_targets (campaign_id, game_title_id, legacy_game_title_id, input_revision,
                                                          algorithm_version, artifact_schema_version, validation_contract_id)
            SELECT pg_temp.fixture_uuid('series_analysis_campaigns', $1), series_analysis_title_states.game_title_id,
                   (SELECT fixture_parent.legacy_id
                    FROM game_titles AS fixture_parent
                    WHERE fixture_parent.id = series_analysis_title_states.game_title_id), input_revision, algorithm_version,
                   artifact_schema_version, validation_contract_id
            FROM series_analysis_title_states
            WHERE (SELECT fixture_parent.legacy_id
                   FROM game_titles AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $2
            ", &[&CAMPAIGN,&TITLE]
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
    verify_running_job_fence(client, &scope).await?;
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
            r"
                INSERT INTO series_radar_title_states (game_title_id)
                VALUES (pg_temp.fixture_uuid('game_titles', $1))
                ",
            &[&TITLE],
        )
        .await?;
    scope.accept(&inspect_in(&transaction, &scope.request).await?)?;
    transaction
        .execute(
            r"
                UPDATE series_radar_title_states
                SET generation = generation + 1
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_radar_title_states.game_title_id) = $1
                ",
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
        r"
            INSERT INTO series_analysis_job_requests (id, legacy_id, game_title_id, legacy_game_title_id, input_revision,
                                                      algorithm_version, artifact_schema_version, validation_contract_id, trigger)
            SELECT pg_temp.fixture_uuid('series_analysis_job_requests', 'maintenance-foreign-request'),
                   'maintenance-foreign-request', series_analysis_title_states.game_title_id, (SELECT fixture_parent.legacy_id
                    FROM game_titles AS fixture_parent
                    WHERE fixture_parent.id = series_analysis_title_states.game_title_id), input_revision, algorithm_version,
                   artifact_schema_version, validation_contract_id, 'manual'
            FROM series_analysis_title_states
            WHERE (SELECT fixture_parent.legacy_id
                   FROM game_titles AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
            ", &[&TITLE]
    ).await?;
    assert_eq!(
        inspect_in(&transaction, &scope.request).await?.status,
        "attention_required"
    );
    transaction.rollback().await?;
    Ok(())
}

async fn verify_running_job_fence(
    client: &mut Client,
    scope: &BoundScope,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let transaction = client.transaction().await?;
    transaction.execute(r"
        UPDATE series_analysis_jobs
        SET status = 'running', started_at = clock_timestamp(), lease_owner = 'maintenance-foreign-worker',
            lease_attempt_id = pg_temp.fixture_uuid('series_analysis_job_attempts', 'maintenance-foreign-attempt'),
            legacy_lease_attempt_id = 'maintenance-foreign-attempt', lease_fencing_token = 1, fencing_counter = 1,
            lease_expires_at = clock_timestamp() + CAST('1 minute' AS interval),
            lease_validation_contract_id = validation_contract_id
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_analysis_jobs.game_title_id) = $1
        ", &[&TITLE]).await?;
    assert_eq!(
        inspect_in(&transaction, &scope.request).await?.status,
        "attention_required"
    );
    transaction.rollback().await?;
    Ok(())
}
