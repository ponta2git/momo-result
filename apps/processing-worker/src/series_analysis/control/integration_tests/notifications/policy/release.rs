use super::*;
use crate::series_analysis::release::{PromotionRequest, PromotionTrigger, promote};

const LEGACY_ARTIFACT: &str = "analysis-notification-legacy-artifact";
const CAPABILITY_ID: &str = "analysis-notification-release-capability";

#[tokio::test]
#[expect(
    clippy::significant_drop_tightening,
    reason = "finish consumes the harness and drains its sender before the next scenario"
)]
#[ignore = "requires DATABASE_URL equal to explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_release_detachment_preserves_notification_input_history() -> SmokeResult {
    // promote intentionally owns its connection. Never let this test select another database.
    if std::env::var("DATABASE_URL")? != std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")? {
        return Err("release smoke must use the explicitly isolated database".into());
    }
    for mixed in [false, true] {
        let mut harness = Harness::start().await?;
        seed_legacy(&harness.client).await?;
        let mut source = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
        if mixed {
            add_second(&harness.client).await?;
            source.input_revision += 1;
            harness.client.execute("UPDATE series_analysis_title_states SET input_revision=$2 WHERE game_title_id=$1", &[&TITLE_ID,&source.input_revision]).await?;
        }
        capabilities(&harness.client).await?;
        let report = promote(&PromotionRequest {
            trigger: PromotionTrigger::InitialBackfill,
            operation_key: if mixed {
                "notification-mixed-release"
            } else {
                "notification-maintenance-release"
            },
            apply: true,
        })
        .await?;
        let pointer: Option<String> = harness.client.query_one("SELECT current_artifact_id FROM series_analysis_title_states WHERE game_title_id=$1", &[&TITLE_ID]).await?.try_get(0)?;
        assert_eq!(
            pointer, None,
            "the real release transaction detaches the unreadable artifact"
        );
        assert_baseline(&harness.client, LEGACY_ARTIFACT).await?;
        let next = next_job(
            &harness.client,
            &source,
            if mixed {
                "release-mixed"
            } else {
                "release-maintenance"
            },
        )
        .await?;
        let triggers = if mixed {
            vec!["initial_backfill", "match_mutation"]
        } else {
            vec!["initial_backfill"]
        };
        harness.publish(&next, &triggers).await?;
        if mixed {
            let body = harness.expect_matches(&next, &[SECOND_MATCH]).await?;
            assert_eq!(
                body.pointer("/data/previousAnalysis/artifactId"),
                Some(&json!(LEGACY_ARTIFACT))
            );
            assert_eq!(
                body.pointer("/data/previousAnalysis/artifactSchemaVersion"),
                Some(&json!(3))
            );
            assert!(
                body.pointer("/data/overall")
                    .and_then(Value::as_array)
                    .is_some_and(|ranks| ranks
                        .iter()
                        .all(|rank| rank.get("before").is_some_and(Value::is_null))),
                "old aggregate payloads must not be interpreted as current rankings"
            );
        }
        harness
            .client
            .execute(
                "DELETE FROM series_analysis_operation_requests WHERE id=$1",
                &[&report.operation_id],
            )
            .await?;
        harness
            .client
            .execute(
                "DELETE FROM series_analysis_worker_capabilities WHERE worker_id=$1",
                &[&CAPABILITY_ID],
            )
            .await?;
        harness
            .client
            .execute(
                "DELETE FROM series_analysis_reader_capabilities WHERE reader_id=$1",
                &[&CAPABILITY_ID],
            )
            .await?;
        harness.finish().await?;
    }
    Ok(())
}

async fn capabilities(client: &Client) -> SmokeResult {
    client.execute("INSERT INTO series_analysis_worker_capabilities (worker_id,algorithm_versions,artifact_schema_versions,validation_contract_ids,draining,started_at,heartbeat_at) VALUES ($1,$2,$3,$4,false,clock_timestamp(),clock_timestamp())", &[&CAPABILITY_ID,&json!([ALGORITHM_VERSION]),&json!([ARTIFACT_SCHEMA_VERSION]),&json!([ARTIFACT_VALIDATION_CONTRACT_ID])]).await?;
    client.execute("INSERT INTO series_analysis_reader_capabilities (reader_id,artifact_schema_versions,validation_contract_ids,draining,started_at,heartbeat_at) VALUES ($1,$2,$3,false,clock_timestamp(),clock_timestamp())", &[&CAPABILITY_ID,&json!([ARTIFACT_SCHEMA_VERSION]),&json!([ARTIFACT_VALIDATION_CONTRACT_ID])]).await?;
    Ok(())
}

async fn seed_legacy(client: &Client) -> SmokeResult {
    // Explicit historical fixture: only relational input identity/counts are meaningful. The
    // current binary must never decode its opaque aggregate/context payload as a current schema.
    client.execute("UPDATE worker_execution_slots SET owner=NULL, task_kind=NULL, job_id=NULL, attempt_id=NULL, holder_preemptible=NULL, lease_expires_at=NULL WHERE job_id=$1", &[&JOB_ID]).await?;
    client
        .execute("DELETE FROM series_analysis_jobs WHERE id=$1", &[&JOB_ID])
        .await?;
    client.execute("INSERT INTO series_analysis_artifacts (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,source_input_checksum,root_checksum,aggregate_chunk_count,review_chunk_count,drilldown_chunk_count,match_context_chunk_count,encoded_bytes,decoded_bytes) VALUES ($1,$2,1,$3,3,'sha256:'||repeat('a',64),'sha256:'||repeat('a',64),4,0,0,4,16,16)", &[&LEGACY_ARTIFACT,&TITLE_ID,&ALGORITHM_VERSION]).await?;
    for (scope, kind, season, map) in [
        ("overall".to_owned(), "overall", None, None),
        (
            format!("season:{SEASON_ID}"),
            "season",
            Some(SEASON_ID),
            None,
        ),
        (format!("map:{MAP_ID}"), "map", None, Some(MAP_ID)),
        (
            format!("season_map:{SEASON_ID}:{MAP_ID}"),
            "season_map",
            Some(SEASON_ID),
            Some(MAP_ID),
        ),
    ] {
        client.execute("INSERT INTO series_analysis_scope_aggregate_artifacts (artifact_id,scope_key,scope_kind,season_master_id,map_master_id,payload,encoded_bytes,decoded_bytes,item_count,nesting_depth,checksum) VALUES ($1,$2,$3,$4,$5,convert_to('{}','UTF8'),2,2,4,1,'sha256:'||repeat('a',64))", &[&LEGACY_ARTIFACT,&scope,&kind,&season,&map]).await?;
        client.execute("INSERT INTO series_analysis_match_context_artifacts (artifact_id,scope_key,scope_kind,season_master_id,map_master_id,match_id,source_match_revision,payload,encoded_bytes,decoded_bytes,item_count,nesting_depth,checksum) VALUES ($1,$2,$3,$4,$5,$6,1,convert_to('{}','UTF8'),2,2,1,1,'sha256:'||repeat('a',64))", &[&LEGACY_ARTIFACT,&scope,&kind,&season,&map,&MATCH_ID]).await?;
    }
    client.execute("UPDATE series_analysis_artifacts SET validation_contract_id='series-analysis-artifact-v3-full-validation-v1' WHERE id=$1", &[&LEGACY_ARTIFACT]).await?;
    client.execute("UPDATE series_analysis_artifacts SET status='published', published_at=clock_timestamp() WHERE id=$1", &[&LEGACY_ARTIFACT]).await?;
    client.execute("UPDATE series_analysis_title_states SET artifact_schema_version=3, validation_contract_id='series-analysis-artifact-v3-full-validation-v1', current_artifact_id=$2, notification_baseline_state='artifact', notification_baseline_artifact_id=$2 WHERE game_title_id=$1", &[&TITLE_ID,&LEGACY_ARTIFACT]).await?;
    Ok(())
}
