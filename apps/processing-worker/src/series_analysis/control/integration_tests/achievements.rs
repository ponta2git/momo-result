use momo_analysis_core::achievements::{AchievementPayload, AchievementStatus};

use super::*;

const ITEM_ID: &str = "10000000-0000-4000-8000-000000000001";

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_authoritative_manifest_consumes_large_match_snapshots() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    cleanup_database(&client).await?;
    prepare_owned_attempt(&client).await?;
    let transaction = client.transaction().await?;
    transaction.batch_execute(&format!(
        "INSERT INTO matches(id,legacy_id,held_event_id,legacy_held_event_id,match_no_in_event,game_title_id,
                             layout_family,season_master_id,owner_member_id,map_master_id,played_at,
                             created_by_account_id,created_by_member_id,analysis_revision)
         SELECT gen_random_uuid(),'{MATCH_ID}-'||sequence,held_event_id,legacy_held_event_id,sequence,game_title_id,
                layout_family,season_master_id,owner_member_id,map_master_id,played_at,
                created_by_account_id,created_by_member_id,analysis_revision
         FROM matches CROSS JOIN generate_series(2,513) AS sequence WHERE legacy_id='{MATCH_ID}';
         INSERT INTO match_players(match_id,member_id,play_order,rank,total_assets_man_yen,revenue_man_yen)
         SELECT m.id,mp.member_id,mp.play_order,mp.rank,mp.total_assets_man_yen,mp.revenue_man_yen
         FROM matches m CROSS JOIN match_players mp
         WHERE m.legacy_id LIKE '{MATCH_ID}-%'
           AND mp.match_id=pg_temp.fixture_uuid('matches','{MATCH_ID}');
         INSERT INTO achievement_items(id,game_title_id,name,stars,rule_kind,scope_kind)
         VALUES ('{ITEM_ID}',pg_temp.fixture_uuid('game_titles','{TITLE_ID}'),'Manual',3,'manual','common');"
    )).await?;
    let input =
        crate::series_analysis::input_repository::load_in_transaction(&transaction, TITLE_ID, 1)
            .await?;
    assert_eq!(input.player_matches().len(), 513 * 4);
    let directory = TempDir::new()?;
    let claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    let artifact = build_artifact(
        &input,
        &ArtifactBuildRequest {
            artifact_id: artifact_id_for_attempt(&claim.attempt_id),
            algorithm_version: claim.algorithm_version.clone(),
            maximum_chunk_bytes: 16 * 1024 * 1024,
            maximum_chunk_count: 4_000,
            maximum_total_bytes: 128 * 1024 * 1024,
            maximum_file_count: 4_001,
        },
        directory.path(),
    )?;
    // Several wire buffers of match rows must drain before another query uses this connection.
    tokio::time::timeout(
        Duration::from_secs(5),
        validate_authoritative_manifest(&transaction, TITLE_ID, &artifact.manifest),
    )
    .await??;
    transaction.rollback().await?;
    cleanup_database(&client).await
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_achievement_input_and_publication_cover_zero_matches_and_global_events()
-> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    cleanup_database(&client).await?;
    prepare_owned_attempt(&client).await?;
    assert_global_event_composition(&mut client).await?;
    let transaction = client.transaction().await?;
    transaction
        .batch_execute(&format!(
            "DELETE FROM matches WHERE legacy_id='{MATCH_ID}';
             INSERT INTO achievement_items(id,game_title_id,name,stars,rule_kind,scope_kind)
             VALUES ('{ITEM_ID}', pg_temp.fixture_uuid('game_titles','{TITLE_ID}'), 'Imported manual',3,'manual','common');
             INSERT INTO achievement_claims(id,item_id,member_id,source_kind,state,generation_id,updated_by_account_id)
             VALUES (gen_random_uuid(),'{ITEM_ID}',pg_temp.fixture_uuid('members','member_ponta'),'import','achieved',
                     gen_random_uuid(),pg_temp.fixture_uuid('momo_login_accounts','account_ponta'));"
        ))
        .await?;
    let input =
        crate::series_analysis::input_repository::load_in_transaction(&transaction, TITLE_ID, 1)
            .await?;
    assert!(input.player_matches().is_empty());
    assert_eq!(input.achievements().member_ids.len(), 4);
    assert_eq!(input.achievements().map_master_ids, [MAP_ID]);
    transaction
        .execute(
            "UPDATE achievement_items SET name='Corrected label',notes='Corrected text',sort_order=42,applies_from=DATE '2026-10-24',version=version+1 WHERE id::text=$1",
            &[&ITEM_ID],
        )
        .await?;
    let renamed =
        crate::series_analysis::input_repository::load_in_transaction(&transaction, TITLE_ID, 1)
            .await?;
    assert_eq!(
        input, renamed,
        "display metadata and the retained start date are outside calculation input"
    );
    let directory = TempDir::new()?;
    let claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    build_artifact(
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
    let artifact = validate_artifact_directory(
        directory.path(),
        1_000,
        16 * 1024 * 1024,
        64 * 1024 * 1024,
        1_001,
    )?;
    validate_authoritative_manifest(&transaction, &claim.game_title_id, artifact.manifest())
        .await?;
    stage_artifact(&transaction, &claim, &artifact, directory.path()).await?;
    validate_staged_artifact(&transaction, &claim, &artifact).await?;
    publish_staged_artifact(&transaction, &claim, &artifact).await?;
    let stored = transaction
        .query_one(
            "SELECT a.scope_keys,a.achievement_chunk_count,c.item_count,c.payload FROM series_analysis_artifacts a
             JOIN series_analysis_achievement_artifacts c ON c.artifact_id=a.id WHERE a.id=$1 AND a.status='published'",
            &[&artifact.manifest().artifact_id],
        )
        .await?;
    assert!(stored.try_get::<_, Vec<String>>(0)?.is_empty());
    assert_eq!(stored.try_get::<_, i32>(1)?, 1);
    assert_eq!(stored.try_get::<_, i32>(2)?, 1);
    let payload: AchievementPayload = serde_json::from_slice(&stored.try_get::<_, Vec<u8>>(3)?)?;
    assert_eq!(payload.summaries.len(), 2);
    for summary in &payload.summaries {
        assert_eq!(summary.total_points, 3);
        assert_eq!(summary.players.len(), 4);
        let player = summary
            .players
            .iter()
            .find(|player| player.member_id == "member_ponta")
            .ok_or("fixed player missing")?;
        assert_eq!(player.earned_points, 3);
        assert_eq!(player.score, None);
    }
    let player = payload
        .items
        .first()
        .and_then(|item| {
            item.players
                .iter()
                .find(|player| player.member_id == "member_ponta")
        })
        .ok_or("imported player missing")?;
    assert_eq!(player.status, AchievementStatus::Achieved);
    assert!(player.date_unknown);
    let mut omitted = artifact.manifest().clone();
    omitted
        .resources
        .retain(|resource| !matches!(resource, ResourceManifest::Achievements { .. }));
    assert!(
        validate_authoritative_manifest(&transaction, &claim.game_title_id, &omitted)
            .await
            .is_err()
    );
    transaction.rollback().await?;
    cleanup_database(&client).await
}

async fn assert_global_event_composition(client: &mut Client) -> SmokeResult {
    let transaction = client.transaction().await?;
    transaction.batch_execute(&format!(
        "INSERT INTO game_titles(id,legacy_id,name,layout_family) VALUES (gen_random_uuid(),'achievement-other-title','Other','momotetsu_2');
         INSERT INTO map_masters(id,legacy_id,game_title_id,name) SELECT gen_random_uuid(),'achievement-other-map',id,'Other map' FROM game_titles WHERE legacy_id='achievement-other-title';
         INSERT INTO season_masters(id,legacy_id,game_title_id,name) SELECT gen_random_uuid(),'achievement-other-season',id,'Other season' FROM game_titles WHERE legacy_id='achievement-other-title';
         INSERT INTO matches(id,legacy_id,held_event_id,legacy_held_event_id,match_no_in_event,game_title_id,layout_family,season_master_id,owner_member_id,map_master_id,played_at,created_by_account_id,created_by_member_id)
         SELECT gen_random_uuid(),'achievement-other-match',held_event_id,legacy_held_event_id,2,
                (SELECT id FROM game_titles WHERE legacy_id='achievement-other-title'),'momotetsu_2',
                (SELECT id FROM season_masters WHERE legacy_id='achievement-other-season'),owner_member_id,
                (SELECT id FROM map_masters WHERE legacy_id='achievement-other-map'),played_at,created_by_account_id,created_by_member_id
         FROM matches WHERE legacy_id='{MATCH_ID}';"
    )).await?;
    let input =
        crate::series_analysis::input_repository::load_in_transaction(&transaction, TITLE_ID, 1)
            .await?;
    let event = input
        .achievements()
        .event_compositions
        .first()
        .ok_or("event composition missing")?;
    assert_eq!(event.match_count, 2);
    assert_eq!(event.title_count, 2);
    transaction.rollback().await?;
    Ok(())
}
