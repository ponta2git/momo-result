use super::*;

fn request() -> Request {
    Request {
        cutover_id: "frozen-initialization-test".to_owned(),
        stop_epoch: 1,
        operation_id: "frozen-initialization-operation".to_owned(),
        campaign_id: "frozen-initialization-campaign".to_owned(),
    }
}

fn authorization() -> Authorization<'static> {
    Authorization {
        candidate_release: "0123456789abcdef0123456789abcdef01234567",
        readiness_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
}

#[test]
fn initialization_requires_explicit_candidate_readiness_and_valid_plan_arguments() {
    let request = request();
    let mut arguments = Arguments {
        phase: Phase::Initialize,
        cutover_id: request.cutover_id.clone(),
        stop_epoch: request.stop_epoch,
        operation_id: request.operation_id.clone(),
        campaign_id: request.campaign_id.clone(),
        apply: false,
        expected_plan: None,
        candidate_release: Some(authorization().candidate_release.to_owned()),
        readiness_digest: Some(authorization().readiness_digest.to_owned()),
    };
    assert!(super::authorization(&arguments, &request).is_ok());
    arguments.apply = true;
    assert!(super::authorization(&arguments, &request).is_err());
    arguments.expected_plan = Some(authorization().readiness_digest.to_owned());
    assert!(super::authorization(&arguments, &request).is_ok());
    arguments.phase = Phase::Continue;
    assert!(super::authorization(&arguments, &request).is_err());
    arguments.phase = Phase::Initialize;
    arguments.readiness_digest = None;
    assert!(super::authorization(&arguments, &request).is_err());
}

#[test]
fn initialization_binds_phase_candidates_full_targets_and_permitted_changes() {
    let request = request();
    let authorization = authorization();
    let current = json!({"algorithm_version": "previous"});
    let targets = vec![json!(["title", {"input_revision": 1, "current_artifact_id": "pointer"}])];
    let digest = plan_digest(
        &request,
        &authorization,
        &current,
        &targets,
        PromotionTrigger::AlgorithmUpdate,
    );
    assert!(valid_digest(&digest));
    let changed = Request {
        stop_epoch: 2,
        ..request.clone()
    };
    assert_ne!(
        digest,
        plan_digest(
            &changed,
            &authorization,
            &current,
            &targets,
            PromotionTrigger::AlgorithmUpdate
        )
    );
    assert_ne!(
        digest,
        plan_digest(
            &request,
            &authorization,
            &current,
            &[],
            PromotionTrigger::AlgorithmUpdate
        )
    );
    assert_ne!(
        digest,
        plan_digest(
            &request,
            &authorization,
            &current,
            &[json!(["title", {"input_revision": 2}])],
            PromotionTrigger::AlgorithmUpdate
        )
    );
    let different = Authorization {
        candidate_release: "1123456789abcdef0123456789abcdef01234567",
        ..authorization.clone()
    };
    assert_ne!(
        digest,
        plan_digest(
            &request,
            &different,
            &current,
            &targets,
            PromotionTrigger::AlgorithmUpdate
        )
    );
    assert_ne!(
        replay_binding(&request, &authorization, &digest, &targets),
        replay_binding(&request, &different, &digest, &targets)
    );
    for invalid in [
        "",
        "sha256:short",
        "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ] {
        assert!(!valid_digest(invalid));
    }
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    clippy::panic_in_result_fn,
    reason = "one rollback-scoped database scenario verifies the complete initialization and replay boundary"
)]
async fn real_postgres_frozen_initialization_is_atomic_full_and_replay_bound()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    let transaction = client.transaction().await?;
    transaction
        .batch_execute("TRUNCATE game_titles, series_analysis_operation_requests CASCADE")
        .await?;
    transaction
        .batch_execute(include_str!("../promotion_tests/seed.sql"))
        .await?;
    // The initializer must not silently adopt an ordinary queued request.
    let request = request();
    let authorization = authorization();
    assert!(
        initialize_transaction(&transaction, &request, &authorization, false, None)
            .await
            .is_err()
    );
    transaction.batch_execute(
        "DELETE FROM series_analysis_jobs; \
         UPDATE series_analysis_title_states SET pending_work=false, notification_baseline_state='artifact', \
           notification_baseline_artifact_id=current_artifact_id"
    ).await?;
    let before = saved(&transaction, false).await?;
    let immutable = saved(&transaction, true).await?;
    let preview =
        initialize_transaction(&transaction, &request, &authorization, false, None).await?;
    assert_eq!(
        preview.target_count, 3,
        "empty titles belong to the full campaign"
    );
    assert_eq!(preview.status, "planned");
    assert_eq!(
        saved(&transaction, false).await?,
        before,
        "preview does not mutate storage"
    );
    for change in [
        "UPDATE series_analysis_title_states SET input_revision=input_revision+1 WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id='current-title')",
        "UPDATE series_analysis_title_states SET current_artifact_id=NULL WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id='current-title')",
        "INSERT INTO game_titles(id,legacy_id,name,layout_family) VALUES(pg_temp.fixture_uuid('game_titles','new-title'),'new-title','new','momotetsu_2')",
        "UPDATE series_analysis_title_states SET pending_work=true WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id='current-title')",
    ] {
        transaction.batch_execute("SAVEPOINT changed_plan").await?;
        transaction.batch_execute(change).await?;
        assert!(
            initialize_transaction(
                &transaction,
                &request,
                &authorization,
                true,
                Some(&preview.plan_digest)
            )
            .await
            .is_err(),
            "changed inputs must be rejected before promotion"
        );
        transaction
            .batch_execute("ROLLBACK TO SAVEPOINT changed_plan; RELEASE SAVEPOINT changed_plan")
            .await?;
        assert_eq!(saved(&transaction, false).await?, before);
    }
    let applied = initialize_transaction(
        &transaction,
        &request,
        &authorization,
        true,
        Some(&preview.plan_digest),
    )
    .await?;
    assert_eq!(applied.status, "initialized");
    assert_eq!(applied.target_count, 3);
    assert_ne!(
        applied.continuation_plan_digest.as_deref(),
        Some(preview.plan_digest.as_str())
    );
    assert_eq!(
        saved(&transaction, true).await?,
        immutable,
        "inputs, immutable bytes and baseline survive promotion"
    );
    assert!(complete_target_set(&transaction, &request).await?);
    let after = saved(&transaction, false).await?;
    let replay = initialize_transaction(
        &transaction,
        &request,
        &authorization,
        true,
        Some(&preview.plan_digest),
    )
    .await?;
    assert_eq!(
        replay.continuation_plan_digest,
        applied.continuation_plan_digest
    );
    assert_eq!(
        saved(&transaction, false).await?,
        after,
        "replay must not create or rewrite any durable row"
    );
    assert!(
        initialize_transaction(&transaction, &request, &authorization, false, None)
            .await
            .is_err(),
        "replay needs the originally reviewed digest"
    );
    let different = Authorization {
        candidate_release: "1123456789abcdef0123456789abcdef01234567",
        ..authorization.clone()
    };
    assert!(
        initialize_transaction(
            &transaction,
            &request,
            &different,
            true,
            Some(&preview.plan_digest)
        )
        .await
        .is_err()
    );
    for change in [
        "UPDATE series_analysis_operation_requests SET endpoint='release:initial_backfill' WHERE legacy_id='frozen-initialization-operation'",
        "UPDATE series_analysis_campaign_targets SET input_revision=input_revision+1 WHERE campaign_id=(SELECT id FROM series_analysis_campaigns WHERE legacy_id='frozen-initialization-campaign')",
        "DELETE FROM series_analysis_campaigns WHERE legacy_id='frozen-initialization-campaign'",
    ] {
        transaction
            .batch_execute("SAVEPOINT changed_replay")
            .await?;
        transaction.batch_execute(change).await?;
        assert!(
            initialize_transaction(
                &transaction,
                &request,
                &authorization,
                true,
                Some(&preview.plan_digest)
            )
            .await
            .is_err(),
            "a collision or partial creation is not a replay"
        );
        transaction
            .batch_execute("ROLLBACK TO SAVEPOINT changed_replay; RELEASE SAVEPOINT changed_replay")
            .await?;
    }
    assert_eq!(saved(&transaction, false).await?, after);
    transaction.rollback().await?;
    Ok(())
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "the frozen structural oracle must not relax normal capability requirements"
)]
async fn real_postgres_empty_frozen_campaign_retains_the_normal_capability_guard()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    let transaction = client.transaction().await?;
    transaction.batch_execute("TRUNCATE game_titles, series_analysis_operation_requests, series_analysis_reader_capabilities, series_analysis_worker_capabilities CASCADE").await?;
    let request = request();
    let authorization = authorization();
    let preview =
        initialize_transaction(&transaction, &request, &authorization, false, None).await?;
    let applied = initialize_transaction(
        &transaction,
        &request,
        &authorization,
        true,
        Some(&preview.plan_digest),
    )
    .await?;
    assert_eq!(applied.status, "initialized");
    assert_eq!(applied.target_count, 0);
    assert!(super::super::audit_frozen_completion(&transaction).await?);
    let normal = super::super::inspect_completeness(&transaction, true, true).await?;
    assert!(!normal.passed);
    assert!(
        normal
            .violations
            .iter()
            .any(|value| value.code == "reader_not_ready")
    );
    assert!(
        normal
            .violations
            .iter()
            .any(|value| value.code == "worker_not_ready")
    );
    transaction.rollback().await?;
    Ok(())
}

async fn saved(
    transaction: &Transaction<'_>,
    immutable_only: bool,
) -> Result<Value, tokio_postgres::Error> {
    let row = transaction.query_one(
        "SELECT jsonb_build_object( \
         'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM series_analysis_artifacts a), \
         'aggregate',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.artifact_id,a.scope_key) FROM series_analysis_scope_aggregate_artifacts a), \
         'outlook',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.artifact_id,a.scope_key) FROM series_analysis_outlook_summary_artifacts a), \
         'matches',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM matches m), \
         'states',(SELECT jsonb_agg(CASE WHEN $1 THEN jsonb_build_array(s.game_title_id,s.input_revision,s.notification_baseline_state,s.notification_baseline_artifact_id) ELSE to_jsonb(s) END ORDER BY s.game_title_id) FROM series_analysis_title_states s), \
         'release',CASE WHEN $1 THEN NULL ELSE (SELECT to_jsonb(r) FROM series_analysis_release_state r WHERE singleton_key='current') END, \
         'operations',CASE WHEN $1 THEN NULL ELSE (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM series_analysis_operation_requests o) END, \
         'campaigns',CASE WHEN $1 THEN NULL ELSE (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM series_analysis_campaigns c) END, \
         'targets',CASE WHEN $1 THEN NULL ELSE (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.campaign_id,t.game_title_id) FROM series_analysis_campaign_targets t) END, \
         'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM series_analysis_job_requests r), \
         'notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM discord_notifications n))", &[&immutable_only]
    ).await?;
    row.try_get(0)
}
