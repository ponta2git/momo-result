use super::*;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_radar_application_restore_and_failure_keep_artifact_and_basis_atomic()
-> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    seed(&client).await?;
    let runtime = TempDir::new()?;
    let config = notifications::config(&database_url, NotificationSink::default(), runtime.path())?;

    let preview_a = prepare_candidate(&mut client, &config, "radar-basis-a").await?;
    assert_current(&client, None).await?;
    reserve_apply(
        &client,
        "radar-apply-a",
        "radar-basis-a",
        "radar-basis-a",
        &preview_a,
    )
    .await?;
    let apply_a = claim_next(&mut client, &config).await?;
    assert_eq!(apply_a.radar_basis_id.as_deref(), Some("radar-basis-a"));
    assert_eq!(apply_a.radar_generation, 1);

    // A perfectly well-formed artifact for the wrong scoring basis is rejected before storage.
    let (wrong, _) = artifact(&mut client, &apply_a, true).await?;
    assert!(matches!(
        control::publication::validated_artifact(&config.execution_limits, &apply_a, wrong.path())
            .await,
        Err(ControlError::InvalidMetadata)
    ));
    assert_current(&client, None).await?;
    publish(&mut client, &apply_a, &config).await?;
    let first_artifact = current(&client, "radar-basis-a").await?;

    // Preparation alone preserves the currently readable publication. Even equal numeric bases
    // have distinct immutable identities so an application cannot reuse a differently labelled one.
    let preview_b = prepare_candidate(&mut client, &config, "radar-basis-b").await?;
    assert_eq!(current(&client, "radar-basis-a").await?, first_artifact);
    reserve_apply(
        &client,
        "radar-apply-b",
        "radar-basis-b",
        "radar-basis-b",
        &preview_b,
    )
    .await?;
    let apply_b = claim_next(&mut client, &config).await?;
    publish(&mut client, &apply_b, &config).await?;
    let second_artifact = current(&client, "radar-basis-b").await?;
    assert_ne!(first_artifact, second_artifact);

    // Restoring uses the saved basis, publishes a ready candidate result, and requires its own
    // reviewed comparison before an ordinary fenced application.
    let restore_preview = restore(&mut client, &config, "radar-restore-a", "radar-basis-a").await?;
    assert_eq!(current(&client, "radar-basis-b").await?, second_artifact);
    reserve_apply(
        &client,
        "radar-reapply-a",
        "radar-restore-a",
        "radar-basis-a",
        &restore_preview,
    )
    .await?;
    let apply_restored = claim_next(&mut client, &config).await?;
    publish(&mut client, &apply_restored, &config).await?;
    let restored_artifact = current(&client, "radar-basis-a").await?;
    assert_ne!(restored_artifact, second_artifact);
    let checksums = client.query_one("SELECT a.source_input_checksum = b.source_input_checksum FROM series_analysis_artifacts a,series_analysis_artifacts b WHERE a.id=$1 AND b.id=$2", &[&first_artifact,&restored_artifact]).await?;
    assert!(
        checksums.try_get::<_, bool>(0)?,
        "the same saved basis reproduces the same semantic input"
    );

    let previous_preview =
        restore(&mut client, &config, "radar-restore-b", "radar-basis-b").await?;
    reserve_apply(
        &client,
        "radar-failed-apply-b",
        "radar-restore-b",
        "radar-basis-b",
        &previous_preview,
    )
    .await?;
    let failed_apply = claim_next(&mut client, &config).await?;
    let failed = control::finish_failure(
        &mut client,
        &failed_apply,
        &config,
        control::AttemptFailure::failed(SafeFailureCode::CalculationFailed),
        &AttemptMetrics::default(),
    )
    .await?;
    assert_eq!(failed.value, ());
    assert_eq!(current(&client, "radar-basis-a").await?, restored_artifact);
    let state = client.query_one("SELECT desired_basis_id,generation,active_operation_id FROM series_radar_title_states WHERE game_title_id=$1", &[&TITLE_ID]).await?;
    assert_eq!(state.try_get::<_, String>(0)?, "radar-basis-a");
    assert_eq!(
        state.try_get::<_, i64>(1)?,
        failed_apply.radar_generation + 1
    );
    assert!(state.try_get::<_, Option<String>>(2)?.is_none());
    let recovery = claim_next(&mut client, &config).await?;
    assert_eq!(recovery.radar_basis_id.as_deref(), Some("radar-basis-a"));
    assert!(recovery.radar_operation_id.is_none());
    publish(&mut client, &recovery, &config).await?;
    current(&client, "radar-basis-a").await?;
    // The administrator dismisses the failed application candidate before requesting another.
    client
        .execute(
            "UPDATE series_radar_candidates SET status='withdrawn' WHERE id='radar-restore-b'",
            &[],
        )
        .await?;
    assert_changed_source_cannot_be_newly_applied(&mut client, &config).await?;
    drop(config);
    clean(&client).await
}

async fn assert_changed_source_cannot_be_newly_applied(
    client: &mut Client,
    config: &AnalysisConsumerConfig,
) -> SmokeResult {
    let preview = prepare_candidate(client, config, "radar-outdated-c").await?;
    reserve_apply(
        client,
        "radar-outdated-apply",
        "radar-outdated-c",
        "radar-outdated-c",
        &preview,
    )
    .await?;
    // Revision and child records both include the correction: only the saved candidate-source
    // check can prevent this from silently applying thresholds based on superseded source facts.
    client.execute("UPDATE match_players SET revenue_man_yen=revenue_man_yen+17 WHERE match_id='analysis-radar-smoke-match-0' AND member_id='member_ponta'", &[]).await?;
    client
        .execute(
            "UPDATE series_analysis_title_states SET input_revision=2 WHERE game_title_id=$1",
            &[&TITLE_ID],
        )
        .await?;
    let outdated = claim_next(client, config).await?;
    let (directory, mut metrics) = artifact(client, &outdated, false).await?;
    let result = control::publish(
        client,
        &outdated,
        config,
        directory.path(),
        &mut metrics,
        tokio::time::Instant::now() + config.execution_limits.finalization_timeout,
    )
    .await?;
    assert_eq!(
        result.value,
        PublicationResult::IntegrityFailure(SafeFailureCode::InputContractInvalid)
    );
    assert_eq!(
        candidate_state(client, "radar-outdated-c").await?,
        ("invalid".to_owned(), "stale".to_owned())
    );
    current(client, "radar-basis-a").await?;
    // A correction to an already applied basis source is a review hint, not a scoring outage.
    let recovery = claim_next(client, config).await?;
    assert_eq!(recovery.radar_basis_id.as_deref(), Some("radar-basis-a"));
    publish(client, &recovery, config).await?;
    current(client, "radar-basis-a").await?;
    let reason: bool = client.query_one("SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(monitor->'reasons') r WHERE r->>'kind'='source_changed') FROM series_radar_title_states WHERE game_title_id=$1", &[&TITLE_ID]).await?.try_get(0)?;
    assert!(
        reason,
        "the normal publication keeps scores and reports corrected source facts"
    );
    Ok(())
}

async fn reserve_apply(
    client: &Client,
    id: &str,
    candidate: &str,
    basis: &str,
    preview: &str,
) -> SmokeResult {
    operation(client, id, "apply", candidate, Some(basis), Some(preview)).await?;
    client.execute("UPDATE series_radar_title_states SET desired_basis_id=$2,generation=generation+1,active_operation_id=$3 WHERE game_title_id=$1", &[&TITLE_ID,&basis,&id]).await?;
    Ok(())
}

async fn restore(
    client: &mut Client,
    config: &AnalysisConsumerConfig,
    candidate: &str,
    basis: &str,
) -> SmokeResult<String> {
    operation(
        client,
        &format!("{candidate}-prepare"),
        "restore",
        candidate,
        Some(basis),
        None,
    )
    .await?;
    let claim = claim_next(client, config).await?;
    let (directory, prepared) = prepare(client, &claim).await?;
    assert!(
        prepared.candidate.is_none(),
        "restore does not regenerate thresholds"
    );
    finish_preparation(client, &claim, config, &directory).await?;
    assert_eq!(
        candidate_state(client, candidate).await?,
        ("ready".to_owned(), "ready".to_owned())
    );
    let row = client.query_one("SELECT c.basis_id,c.source_input_revision,c.result->'basis'=b.payload,p.id FROM series_radar_candidates c JOIN series_radar_bases b ON b.id=c.basis_id JOIN series_radar_previews p ON p.candidate_id=c.id WHERE c.id=$1", &[&candidate]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, basis);
    assert_eq!(row.try_get::<_, i64>(1)?, 1);
    assert!(
        row.try_get::<_, bool>(2)?,
        "restored administration result preserves saved basis content"
    );
    row.try_get(3).map_err(Into::into)
}

async fn artifact(
    client: &mut Client,
    claim: &ClaimedJob,
    omit_basis: bool,
) -> SmokeResult<(TempDir, AttemptMetrics)> {
    let loaded = input_repository::load_job_input(client, &identity(claim)).await?;
    let context = loaded.context.ok_or("normal radar context")?;
    let input = if omit_basis {
        loaded.input.with_radar_basis(None)?
    } else {
        let monitor = calculator::monitor(
            &loaded.input,
            context.basis.as_ref(),
            context.source.as_ref(),
        )?;
        loaded.input.with_radar_monitoring(monitor)
    };
    let directory = TempDir::new()?;
    let built = build_artifact(
        &input,
        &ArtifactBuildRequest {
            artifact_id: artifact_id_for_attempt(&claim.attempt_id),
            algorithm_version: claim.algorithm_version.clone(),
            maximum_chunk_bytes: 16 * 1024 * 1024,
            maximum_chunk_count: 1_000,
            maximum_total_bytes: 64 * 1024 * 1024,
            maximum_file_count: 1_001,
        },
        directory.path(),
    )?;
    let metrics = AttemptMetrics {
        artifact_chunk_count: Some(i64::try_from(built.manifest.resources.len())?),
        artifact_encoded_bytes: Some(i64::try_from(built.chunk_bytes)?),
        ..AttemptMetrics::default()
    };
    Ok((directory, metrics))
}

async fn publish(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
) -> SmokeResult {
    let (directory, mut metrics) = artifact(client, claim, false).await?;
    let result = control::publish(
        client,
        claim,
        config,
        directory.path(),
        &mut metrics,
        tokio::time::Instant::now() + config.execution_limits.finalization_timeout,
    )
    .await?;
    assert_eq!(result.value, PublicationResult::Published);
    Ok(())
}

async fn current(client: &Client, basis: &str) -> SmokeResult<String> {
    let row = client.query_one("SELECT s.current_artifact_id,r.current_basis_id,a.radar_basis_id,a.radar_applied_at=r.current_applied_at,(convert_from(c.payload,'UTF8')::jsonb #>> '{playerRadar,basis,basisId}'),r.monitor=(convert_from(c.payload,'UTF8')::jsonb #> '{playerRadar,monitoring}'),a.radar_generation=r.generation FROM series_analysis_title_states s JOIN series_radar_title_states r USING(game_title_id) JOIN series_analysis_artifacts a ON a.id=s.current_artifact_id JOIN series_analysis_scope_aggregate_artifacts c ON c.artifact_id=a.id AND c.scope_key='overall' WHERE s.game_title_id=$1", &[&TITLE_ID]).await?;
    assert_eq!(row.try_get::<_, String>(1)?, basis);
    assert_eq!(row.try_get::<_, String>(2)?, basis);
    assert!(
        row.try_get::<_, bool>(3)?,
        "application timestamp is tied to the readable artifact"
    );
    assert_eq!(row.try_get::<_, String>(4)?, basis);
    assert!(
        row.try_get::<_, bool>(5)?,
        "monitoring is copied from that validated aggregate"
    );
    // A failed/new desired generation can exist while the previously published artifact stays
    // readable; source and current-basis identity remain the publication authority in that state.
    row.try_get(0).map_err(Into::into)
}
