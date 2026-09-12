use std::{num::NonZeroU64, path::Path};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::mpsc,
    time::Instant,
};

use super::*;
use crate::{
    cgroup::{CgroupHierarchy, ChildCgroup},
    notifications::{NotificationConfig, NotificationDriver, NotificationSink, analysis},
    series_analysis::config::{AnalysisConsumerConfig, AnalysisExecutionLimits},
};

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_analysis_notifications_follow_committed_publications() -> SmokeResult {
    let _logging = tracing_subscriber::fmt().with_test_writer().try_init();
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = crate::postgres::connect(&database_url).await?;
    let mut peer = crate::postgres::connect(&database_url).await?;
    cleanup_database(&primary).await?;
    prepare_owned_attempt(&primary).await?;
    primary
        .batch_execute("UPDATE discord_notification_settings SET enabled = true, generation = 0")
        .await?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!(
        "http://{}/internal/discord-notifications",
        listener.local_addr()?
    );
    let (sink, driver) =
        NotificationDriver::new(NotificationConfig::http(&endpoint, &"x".repeat(32))?)?;
    let (sent, mut received) = mpsc::channel(16);
    let server = tokio::spawn(capture(listener, sent, database_url.clone()));
    let sender = tokio::spawn(driver.run());
    let temporary = TempDir::new()?;
    let config = config(&database_url, sink.clone(), temporary.path())?;
    let first = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;

    // Publication waits for the shared gate. The setting and memo committed before the final
    // SELECT must be included, even though the calculation and comparison were prepared earlier.
    let gate = peer.transaction().await?;
    gate.query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
        .await?;
    let metadata = crate::postgres::connect(&database_url).await?;
    let (published, edited) = tokio::join!(publish(&mut primary, &config, &first), async {
        wait_for_gate(&gate).await?;
        // A finite settings transaction can outlast a few local round trips. Publication and
        // its notification must both survive that wait within the parent's remaining budget.
        tokio::time::sleep(Duration::from_millis(600)).await;
        metadata.execute("UPDATE matches SET note_body = $2, note_version = 1, note_updated_by_account_id = 'account_ponta', \
                note_updated_at = clock_timestamp() WHERE id = $1", &[&MATCH_ID, &"保存済みメモ。\n改行と @everyone を保持。"] ).await?;
        gate.batch_execute("UPDATE discord_notification_settings SET generation = 9007199254740993 WHERE kind = 'analysis_completed'").await?;
        gate.commit().await?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });
    edited.map_err(|error| format!("publication gate probe: {error}"))?;
    assert_eq!(published?, super::super::PublicationResult::Published);
    let first_body = receive(&mut received).await?;
    assert_eq!(
        first_body.get("settingsGeneration"),
        Some(&json!("9007199254740993"))
    );
    assert_eq!(
        first_body.pointer("/data/previousAnalysis"),
        Some(&Value::Null)
    );
    assert_eq!(
        first_body.pointer("/data/matches/0/note"),
        Some(&json!("保存済みメモ。\n改行と @everyone を保持。"))
    );
    assert_eq!(
        first_body.pointer("/data/matches/0/ginjiTotal"),
        Some(&json!(0))
    );
    assert_eq!(
        first_body.pointer("/data/currentAnalysis/artifactId"),
        Some(&json!(artifact_id_for_attempt(OLD_ATTEMPT_ID)))
    );
    if let Ok(path) = std::env::var("ANALYSIS_NOTIFICATION_FIXTURE_PATH") {
        fs::write(path, serde_json::to_vec(&first_body)?)?;
    }

    // This is the same terminal-job deletion boundary used by history maintenance. The artifact
    // survives with a null attempt reference, so the next logical job can still compare/reuse it.
    primary
        .execute(
            "DELETE FROM series_analysis_jobs WHERE id = $1 AND status = 'succeeded'",
            &[&first.job_id],
        )
        .await?;
    let reused = next_job(&primary, &first, "reuse").await?;
    assert_eq!(
        publish(&mut primary, &config, &reused).await?,
        super::super::PublicationResult::Reused
    );
    let reused_body = receive(&mut received).await?;
    assert_eq!(reused_body.get("sourceJobId"), Some(&json!(reused.job_id)));
    assert_eq!(
        reused_body.pointer("/data/previousAnalysis"),
        reused_body.pointer("/data/currentAnalysis")
    );
    assert_eq!(reused_body.pointer("/data/matches"), Some(&json!([])));
    assert_eq!(
        reused_body.pointer("/data/seasons/0/seasonId"),
        Some(&json!(SEASON_ID))
    );

    verify_preparation_boundaries(&mut primary, &peer, &config, &reused).await?;
    for (label, enabled) in [("off", false), ("contended", true)] {
        let next = next_job(&primary, &reused, label).await?;
        primary.execute("UPDATE discord_notification_settings SET enabled = $1 WHERE kind = 'analysis_completed'", &[&enabled]).await?;
        let held_gate = peer.transaction().await?;
        if enabled {
            held_gate
                .query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
                .await?;
        }
        assert_eq!(
            publish(&mut primary, &config, &next).await?,
            super::super::PublicationResult::Reused
        );
        held_gate.rollback().await?;
    }
    let stale = next_job(&primary, &reused, "stale").await?;
    let mut wrong_owner = stale.clone();
    wrong_owner.fencing_token += 1;
    assert!(
        publish(&mut primary, &config, &wrong_owner).await.is_err(),
        "a stale fence cannot send a success notification"
    );
    drop(config);
    drop(sink);
    tokio::time::timeout(Duration::from_secs(6), sender).await??;
    assert!(
        received.try_recv().is_err(),
        "OFF, contended preparation and stale ownership must not send; HTTP failure must not retry"
    );
    server.abort();
    let _server_result = server.await;
    primary
        .batch_execute("UPDATE discord_notification_settings SET enabled = true, generation = 0")
        .await?;
    primary.execute("UPDATE worker_execution_slots SET owner = NULL, task_kind = NULL, job_id = NULL, attempt_id = NULL, \
        holder_preemptible = NULL, lease_expires_at = NULL WHERE job_id = $1", &[&stale.job_id]).await?;
    cleanup_database(&primary).await?;
    Ok(())
}

async fn verify_preparation_boundaries(
    primary: &mut Client,
    peer: &Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
) -> SmokeResult {
    let artifact_id = artifact_id_for_attempt(OLD_ATTEMPT_ID);
    for scenario in ["rollback", "invalid", "short"] {
        let deadline = Instant::now() + Duration::from_secs(2);
        let comparison = analysis::load(
            &config.notifications,
            &config.database_url,
            claim,
            &artifact_id,
            false,
            deadline,
        )
        .await
        .ok_or("comparison missing")?;
        let transaction = primary.transaction().await?;
        if scenario == "invalid" {
            transaction
                .batch_execute("SET LOCAL search_path = pg_catalog")
                .await?;
        }
        let prepared = comparison
            .prepare(
                &transaction,
                claim,
                Some(&artifact_id),
                true,
                if scenario == "short" {
                    Instant::now() + Duration::from_millis(50)
                } else {
                    deadline
                },
            )
            .await?;
        if matches!(scenario, "invalid" | "short") {
            assert!(
                prepared.is_none(),
                "recoverable SQL failure/deadline must skip notification"
            );
            drop(prepared);
            transaction.query_one("SELECT 1", &[]).await?;
        } else {
            let prepared = prepared.ok_or("reused snapshot missing")?;
            let frozen = prepared.payload()?;
            let member_id = MEMBER_IDS.first().ok_or("member")?;
            let old_name: String = peer
                .query_one(
                    "SELECT display_name FROM members WHERE id = $1",
                    &[member_id],
                )
                .await?
                .try_get(0)?;
            peer.execute(
                "UPDATE members SET display_name = 'Edited after snapshot' WHERE id = $1",
                &[member_id],
            )
            .await?;
            assert_eq!(prepared.payload()?, frozen);
            drop(prepared);
            peer.execute(
                "UPDATE members SET display_name = $2 WHERE id = $1",
                &[member_id, &old_name],
            )
            .await?;
        }
        transaction.rollback().await?;
    }
    Ok(())
}

async fn publish(
    primary: &mut Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
) -> SmokeResult<super::super::PublicationResult> {
    let directory = TempDir::new()?;
    let artifact = build_manifest(claim, directory.path())?;
    let mut metrics = AttemptMetrics {
        artifact_chunk_count: Some(i64::try_from(artifact.manifest().resources.len())?),
        artifact_encoded_bytes: Some(
            artifact
                .manifest()
                .resources
                .iter()
                .map(|resource| i64::try_from(resource.common().encoded_bytes))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .sum(),
        ),
        ..AttemptMetrics::default()
    };
    let deadline = Instant::now() + config.execution_limits.finalization_timeout;
    Ok(tokio::time::timeout_at(
        deadline,
        super::super::publish(
            primary,
            claim,
            config,
            directory.path(),
            &mut metrics,
            deadline,
        ),
    )
    .await??
    .value)
}

async fn next_job(client: &Client, previous: &ClaimedJob, label: &str) -> SmokeResult<ClaimedJob> {
    let next = ClaimedJob {
        job_id: format!("analysis-notification-{label}"),
        attempt_id: format!("analysis-notification-attempt-{label}"),
        fencing_token: previous.fencing_token + 1,
        ..previous.clone()
    };
    client.execute("INSERT INTO series_analysis_jobs (id, game_title_id, input_revision, algorithm_version, artifact_schema_version, \
        validation_contract_id, status, trigger, started_at, lease_owner, lease_attempt_id, lease_fencing_token, lease_expires_at, \
        lease_validation_contract_id, attempt_count) VALUES ($1,$2,$3,$4,$5,$6,'running','manual',clock_timestamp(),$7,$8,$9,clock_timestamp()+interval '10 minutes',$6,1)",
        &[&next.job_id, &next.game_title_id, &next.input_revision, &next.algorithm_version, &next.artifact_schema_version, &next.validation_contract_id, &OLD_WORKER_ID, &next.attempt_id, &next.fencing_token]).await?;
    client.execute("INSERT INTO series_analysis_job_attempts (id,job_id,attempt_no,owner,fencing_token,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,effective_config_version,calculation_timeout_milliseconds) \
        VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'running','notification-test',60000)",
        &[&next.attempt_id,&next.job_id,&OLD_WORKER_ID,&next.fencing_token,&next.input_revision,&next.algorithm_version,&next.artifact_schema_version,&next.validation_contract_id]).await?;
    client.execute("UPDATE worker_execution_slots SET task_kind='analysis', owner=$1, job_id=$2, attempt_id=$3, fencing_token=$4, \
        holder_preemptible=true, lease_expires_at=clock_timestamp()+interval '10 minutes' WHERE slot_key='shared-heavy-work'",
        &[&OLD_WORKER_ID,&next.job_id,&next.attempt_id,&next.fencing_token]).await?;
    Ok(next)
}

async fn wait_for_gate(gate: &Transaction<'_>) -> SmokeResult {
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let blocked: bool = gate.query_one("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 19790514 AND objid = 1 AND NOT granted)", &[]).await?.try_get(0)?;
            if blocked { return Ok::<(), tokio_postgres::Error>(()); }
            tokio::task::yield_now().await;
        }
    }).await??;
    Ok(())
}

async fn receive(receiver: &mut mpsc::Receiver<Value>) -> SmokeResult<Value> {
    tokio::time::timeout(Duration::from_secs(2), receiver.recv())
        .await?
        .ok_or_else(|| "HTTP capture closed".into())
}

async fn capture(
    listener: TcpListener,
    sent: mpsc::Sender<Value>,
    database_url: String,
) -> SmokeResult {
    let client = crate::postgres::connect(&database_url).await?;
    loop {
        let (mut stream, _) = listener.accept().await?;
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        let (header_end, length) = loop {
            let read = stream.read(&mut buffer).await?;
            if read == 0 {
                return Err("request closed before headers".into());
            }
            request.extend_from_slice(buffer.get(..read).ok_or("request buffer")?);
            if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let headers = std::str::from_utf8(request.get(..end).ok_or("headers")?)?;
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .map(str::to_owned)
                    })
                    .ok_or("content length")?
                    .parse::<usize>()?;
                break (end + 4, length);
            }
        };
        while request.len() < header_end + length {
            let read = stream.read(&mut buffer).await?;
            if read == 0 {
                return Err("request body incomplete".into());
            }
            request.extend_from_slice(buffer.get(..read).ok_or("request buffer")?);
        }
        let payload: Value =
            serde_json::from_slice(request.get(header_end..header_end + length).ok_or("body")?)?;
        let id = payload
            .get("sourceJobId")
            .and_then(Value::as_str)
            .ok_or("source ID")?;
        let row = client.query_one("SELECT j.status, s.owner FROM series_analysis_jobs j CROSS JOIN worker_execution_slots s \
            WHERE j.id=$1 AND s.slot_key='shared-heavy-work'", &[&id]).await?;
        assert_eq!(row.try_get::<_, String>(0)?, "succeeded");
        assert_eq!(row.try_get::<_, Option<String>>(1)?, None);
        sent.send(payload).await?;
        stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
    }
}

fn config(
    database_url: &str,
    notifications: NotificationSink,
    directory: &Path,
) -> SmokeResult<AnalysisConsumerConfig> {
    for (name, content) in [
        ("memory.max", "134217728"),
        ("memory.current", "0"),
        ("memory.peak", "0"),
        ("memory.events", "max 0\noom_kill 0\n"),
        ("cgroup.procs", ""),
        ("cgroup.kill", ""),
    ] {
        fs::write(directory.join(name), content)?;
    }
    let bound = |value| NonZeroU64::new(value).ok_or("positive fixture bound");
    Ok(AnalysisConsumerConfig {
        database_url: database_url.to_owned(),
        outbox_listener_database_url: database_url.to_owned(),
        read_database_url: database_url.to_owned(),
        redis_url: String::new(),
        redis_stream: "fixture".to_owned(),
        redis_group: "fixture".to_owned(),
        worker_id: OLD_WORKER_ID.to_owned(),
        temporary_root: directory.to_path_buf(),
        effective_config_version: "notification-test".to_owned(),
        lease_duration: Duration::from_mins(1),
        heartbeat_interval: Duration::from_secs(1),
        child_stop_grace: Duration::from_secs(1),
        redis_block: Duration::from_millis(100),
        pel_recovery_interval: Duration::from_secs(5),
        notifications,
        child_cgroup: ChildCgroup::open_fixture(
            CgroupHierarchy::V2,
            directory.to_path_buf(),
            134_217_728,
        )?,
        execution_limits: AnalysisExecutionLimits {
            runtime_memory_limit: bound(268_435_456)?,
            child_memory_limit: bound(134_217_728)?,
            parent_headroom: bound(134_217_728)?,
            calculation_timeout: Duration::from_mins(1),
            finalization_timeout: Duration::from_secs(5),
            temporary_bytes_limit: bound(67_108_864)?,
            chunk_bytes_limit: bound(16_777_216)?,
            chunk_count_limit: bound(1_000)?,
            temporary_file_count_limit: bound(1_001)?,
        },
    })
}
