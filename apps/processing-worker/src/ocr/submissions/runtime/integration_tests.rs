//! Real `PostgreSQL` coverage, deliberately sequential because the setting is global.

use super::*;
use crate::notifications::{
    NotificationConfig, NotificationDriver, NotificationSink, PreparedNotification,
};
use sha2::{Digest, Sha256};
use std::{error::Error, time::Duration};
use tokio_postgres::Client;

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
const TIMEOUT: Duration = Duration::from_secs(5);
const IDS: [&str; 8] = [
    "00000000-0024-4000-8000-000000000001",
    "00000000-0024-4000-8000-000000000002",
    "00000000-0024-4000-8000-000000000003",
    "00000000-0024-4000-8000-000000000004",
    "00000000-0024-4000-8000-000000000005",
    "00000000-0024-4000-8000-000000000006",
    "00000000-0024-4000-8000-000000000007",
    "00000000-0024-4000-8000-000000000008",
];

const EXTRA_IDS: [&str; 4] = [
    "00000000-0024-4000-8000-000000000009",
    "00000000-0024-4000-8000-000000000010",
    "00000000-0024-4000-8000-000000000011",
    "00000000-0024-4000-8000-000000000012",
];

const RETAINED_IDS: [&str; 2] = [
    "00000000-0024-4000-8000-000000000013",
    "00000000-0024-4000-8000-000000000017",
];

const RECOVERY_IDS: [&str; 3] = [
    "00000000-0024-4000-8000-000000000014",
    "00000000-0024-4000-8000-000000000015",
    "00000000-0024-4000-8000-000000000016",
];

#[tokio::test]
#[ignore = "requires an explicitly isolated migrated PostgreSQL database"]
async fn real_postgres_preserves_submission_finalization_and_recovery() -> TestResult {
    if std::env::var("ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED").as_deref() != Ok("true") {
        return Err("isolated database authorization is required".into());
    }
    let url = std::env::var("OCR_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = postgres::connect(&url).await?;
    let mut peer = postgres::connect(&url).await?;
    let old = primary.query_one("SELECT enabled, generation::text FROM discord_notification_settings WHERE kind = 'ocr_completed'", &[]).await?;
    let enabled: bool = old.get(0);
    let generation: String = old.get(1);
    cleanup(&primary).await?;
    primary.execute("UPDATE discord_notification_settings SET enabled = true, generation = 24 WHERE kind = 'ocr_completed'", &[]).await?;
    let (sink, driver) = NotificationDriver::new(NotificationConfig::http(
        "http://127.0.0.1:1/internal/discord-notifications",
        &"x".repeat(32),
    )?)?;
    let result = verify(&mut primary, &mut peer, &url, &sink).await;
    drop(sink);
    drop(driver);
    let cleaned = cleanup(&primary).await;
    let restored = primary.execute("UPDATE discord_notification_settings SET enabled = $1, generation = $2::text::bigint WHERE kind = 'ocr_completed'", &[&enabled, &generation]).await;
    result?;
    cleaned?;
    restored?;
    Ok(())
}

async fn verify(
    primary: &mut Client,
    peer: &mut Client,
    url: &str,
    sink: &NotificationSink,
) -> TestResult {
    verify_outcomes(primary, sink).await?;
    verify_concurrency(primary, peer, sink).await?;
    let [_, _, _, _, _, _, _, preparation] = IDS;
    create(primary, preparation, -1).await?;
    member(primary, preparation, "total_assets", None).await?;
    verify_gate(primary, peer, preparation, sink).await?;
    verify_listener(primary, url).await?;
    verify_recovery_boundaries(primary, peer, url, sink).await?;
    verify_listener_reconnect(primary, url).await?;
    verify_deadline_reconnect(primary, peer, url).await?;
    let delay = next_delay(primary, TIMEOUT).await?;
    ensure(
        delay == SAFETY_INTERVAL,
        "idle must retain a cold recovery scan",
    )?;
    Ok(())
}

async fn verify_outcomes(primary: &mut Client, sink: &NotificationSink) -> TestResult {
    let [mixed, zero, off, cancelled, _, _, _, _] = IDS;
    create(primary, mixed, 600).await?;
    member(primary, mixed, "total_assets", Some("succeeded")).await?;
    member(primary, mixed, "revenue", Some("failed")).await?;
    member(primary, mixed, "incident_log", None).await?;
    ensure(
        matches!(
            control::settle(primary, mixed, TIMEOUT, sink).await?,
            Settlement::Open
        ),
        "pending final member must prevent notification",
    )?;
    primary.execute("UPDATE ocr_submissions SET admission_deadline = clock_timestamp() - interval '1 second' WHERE id = $1", &[&mixed]).await?;
    let notification = prepared(control::settle(primary, mixed, TIMEOUT, sink).await?)?;
    let payload = notification.payload()?;
    ensure(
        payload.get("schemaVersion") == Some(&serde_json::json!(2)),
        "OCR wire version",
    )?;
    ensure(
        payload.pointer("/data/failures")
            == Some(&serde_json::json!([
                {"screenType":"revenue","reason":"ocr_timeout"}, {"screenType":"incident_log","reason":"admission_timeout"}
            ])),
        "fixed member failures and canonical order",
    )?;
    ensure(
        payload.pointer("/data/submissionId") == Some(&serde_json::json!(mixed)),
        "logical identity",
    )?;
    drop(notification); // Models commit followed by process loss before any HTTP.
    ensure(
        matches!(
            control::settle(primary, mixed, TIMEOUT, sink).await?,
            Settlement::Closed
        ),
        "committed payload must not be reconstructed",
    )?;

    create(primary, zero, -1).await?;
    member(primary, zero, "total_assets", None).await?;
    let notice = prepared(control::settle(primary, zero, TIMEOUT, sink).await?)?;
    ensure(
        notice.payload()?.pointer("/data/failures/0/reason")
            == Some(&serde_json::json!("admission_timeout")),
        "job zero must notify",
    )?;
    let status: String = primary
        .query_one("SELECT status FROM match_drafts WHERE id = $1", &[&zero])
        .await?
        .get(0);
    ensure(
        status == "ocr_failed",
        "empty draft must be usable after all admissions fail",
    )?;
    drop(notice);

    create(primary, off, -1).await?;
    member(primary, off, "total_assets", None).await?;
    primary
        .execute(
            "UPDATE discord_notification_settings SET enabled = false WHERE kind = 'ocr_completed'",
            &[],
        )
        .await?;
    ensure(
        matches!(
            control::settle(primary, off, TIMEOUT, sink).await?,
            Settlement::Settled(None)
        ),
        "OFF settles without an effect",
    )?;
    primary
        .execute(
            "UPDATE discord_notification_settings SET enabled = true WHERE kind = 'ocr_completed'",
            &[],
        )
        .await?;
    ensure(
        matches!(
            control::settle(primary, off, TIMEOUT, sink).await?,
            Settlement::Closed
        ),
        "ON cannot backfill",
    )?;

    create(primary, cancelled, -1).await?;
    member(primary, cancelled, "total_assets", None).await?;
    primary
        .execute("DELETE FROM match_drafts WHERE id = $1", &[&cancelled])
        .await?;
    ensure(
        matches!(
            control::settle(primary, cancelled, TIMEOUT, sink).await?,
            Settlement::Aborted
        ),
        "deleted source aborts",
    )?;

    Ok(())
}

async fn verify_concurrency(
    primary: &mut Client,
    peer: &mut Client,
    sink: &NotificationSink,
) -> TestResult {
    let [_, _, _, _, race, held, later, _] = IDS;
    create(primary, race, -1).await?;
    member(primary, race, "total_assets", None).await?;
    let (first, second) = tokio::join!(
        control::settle(primary, race, TIMEOUT, sink),
        control::settle(peer, race, TIMEOUT, sink)
    );
    let results = [first?, second?];
    ensure(
        results
            .iter()
            .filter(|value| matches!(value, Settlement::Settled(Some(_))))
            .count()
            == 1,
        "simultaneous finalizers emit one effect",
    )?;
    drop(results);

    create(primary, held, -1).await?;
    member(primary, held, "total_assets", None).await?;
    create(primary, later, -1).await?;
    member(primary, later, "total_assets", None).await?;
    let lock = peer.transaction().await?;
    lock.query_one(
        "SELECT id FROM match_drafts WHERE id = $1 FOR UPDATE",
        &[&held],
    )
    .await?;
    ensure(
        matches!(
            control::settle(primary, held, TIMEOUT, sink).await?,
            Settlement::Busy
        ),
        "busy source must not block",
    )?;
    let (_shutdown, receiver) = watch::channel(false);
    sweep(
        primary,
        TIMEOUT,
        &NotificationSink::default(),
        &receiver,
        &mut ScanCursor::default(),
    )
    .await?;
    let status: String = primary
        .query_one(
            "SELECT status FROM ocr_submissions WHERE id = $1",
            &[&later],
        )
        .await?
        .get(0);
    ensure(
        status == "settled",
        "later submission advances past locked source",
    )?;
    lock.rollback().await?;
    drop(prepared(
        control::settle(primary, held, TIMEOUT, sink).await?,
    )?);

    Ok(())
}

async fn verify_gate(
    primary: &mut Client,
    peer: &mut Client,
    id: &str,
    sink: &NotificationSink,
) -> TestResult {
    let gate = peer.transaction().await?;
    gate.query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
        .await?;
    gate.execute("UPDATE discord_notification_settings SET enabled = true, generation = 9007199254740993 WHERE kind = 'ocr_completed'", &[]).await?;
    let pid: i32 = primary
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .get(0);
    let (settlement, release) = tokio::join!(control::settle(primary, id, TIMEOUT, sink), async {
        time::timeout(Duration::from_secs(2), async {
            loop {
                let waiting: bool = gate.query_one("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted)", &[&pid]).await?.get(0);
                if waiting { return Ok::<(), tokio_postgres::Error>(()); }
                tokio::task::yield_now().await;
            }
        }).await??;
        gate.commit().await?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });
    release?;
    let notice = prepared(settlement?)?;
    ensure(
        notice.payload()?.get("settingsGeneration") == Some(&serde_json::json!("9007199254740993")),
        "snapshot must be after the gate wait",
    )?;
    drop(notice);
    Ok(())
}

async fn verify_listener(publisher: &Client, url: &str) -> TestResult {
    let (wake, mut receiver) = watch::channel(());
    let mut listener = Listener::subscribe(url, wake).await?;
    listener.verify(publisher).await?;
    receiver.borrow_and_update();
    let (shutdown, stop) = watch::channel(false);
    let (result, delivered) = tokio::join!(listener.run(stop), async {
        super::super::wake(publisher).await;
        let delivered = time::timeout(Duration::from_secs(1), receiver.changed()).await;
        shutdown.send(true)?;
        delivered??;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });
    result?;
    delivered?;
    Ok(())
}

async fn create(client: &Client, id: &str, deadline_seconds: i64) -> TestResult {
    client.execute("INSERT INTO match_drafts (id, created_by_account_id, created_by_member_id, status) VALUES ($1, 'account_ponta', 'member_ponta', 'ocr_running')", &[&id]).await?;
    client.execute("INSERT INTO ocr_submissions (id, owner_account_id, match_draft_id, ocr_hints_json, status, admission_deadline, created_at) VALUES ($1, 'account_ponta', $1, '{}'::jsonb, 'open', clock_timestamp() + $2::bigint * interval '1 second', clock_timestamp() - interval '2 seconds')", &[&id, &deadline_seconds]).await?;
    Ok(())
}

async fn member(client: &Client, id: &str, screen: &str, job_status: Option<&str>) -> TestResult {
    let job_id = format!("mom24-worker-{id}-{screen}");
    let digest = hex::encode(Sha256::digest(job_id.as_bytes()));
    if let Some(status) = job_status {
        client.execute("INSERT INTO source_images (id, owner_account_id, object_key, idempotency_key_hash, status, media_type, byte_length, sha256_hex, width, height, storage_etag, available_at) VALUES ($1, 'account_ponta', $1, $2, 'AVAILABLE', 'image/png', 68, $2, 1, 1, 'test', clock_timestamp())", &[&job_id, &digest]).await?;
        client.execute("INSERT INTO ocr_jobs (id, draft_id, image_id, source_image_id, requested_screen_type, status, queue_schema_version, failure_code, finished_at) VALUES ($1, $1, $1, $1, $2, $3, 2, CASE WHEN $3 = 'failed' THEN 'OCR_TIMEOUT' END, clock_timestamp())", &[&job_id, &screen, &status]).await?;
    }
    let status = if job_status.is_some() {
        "registered"
    } else {
        "pending"
    };
    let job = job_status.map(|_status| job_id.as_str());
    client.execute("INSERT INTO ocr_submission_members (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex, image_byte_length, status, job_id) VALUES ($1, $2, $3, $3, 68, $4, $5)", &[&id, &screen, &digest, &status, &job]).await?;
    Ok(())
}

async fn cleanup(client: &Client) -> TestResult {
    let ids: Vec<&str> = IDS
        .iter()
        .chain(EXTRA_IDS.iter())
        .chain(RETAINED_IDS.iter())
        .chain(RECOVERY_IDS.iter())
        .copied()
        .collect();
    let jobs: Vec<String> = ids
        .iter()
        .flat_map(|id| {
            ["total_assets", "revenue", "incident_log"]
                .map(|screen| format!("mom24-worker-{id}-{screen}"))
        })
        .collect();
    client
        .execute(
            "DELETE FROM ocr_submission_members WHERE submission_id = ANY($1)",
            &[&ids],
        )
        .await?;
    client
        .execute("DELETE FROM ocr_submissions WHERE id = ANY($1)", &[&ids])
        .await?;
    client
        .execute("DELETE FROM ocr_jobs WHERE id = ANY($1)", &[&jobs])
        .await?;
    client
        .execute("DELETE FROM source_images WHERE id = ANY($1)", &[&jobs])
        .await?;
    client
        .execute("DELETE FROM match_drafts WHERE id = ANY($1)", &[&ids])
        .await?;
    Ok(())
}

fn prepared(settlement: Settlement) -> TestResult<PreparedNotification> {
    if let Settlement::Settled(Some(notification)) = settlement {
        Ok(notification)
    } else {
        Err("expected one committed submission notification".into())
    }
}

fn ensure(condition: bool, message: &'static str) -> TestResult {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

async fn verify_recovery_boundaries(
    primary: &mut Client,
    peer: &mut Client,
    url: &str,
    sink: &NotificationSink,
) -> TestResult {
    let [timeout, invalid, success, cold] = EXTRA_IDS;
    create(primary, timeout, -1).await?;
    member(primary, timeout, "total_assets", None).await?;
    let gate = peer.transaction().await?;
    gate.query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
        .await?;
    let result = control::settle(primary, timeout, Duration::from_millis(800), sink).await?;
    ensure(
        matches!(result, Settlement::Settled(None)),
        "optional gate timeout must preserve business commit",
    )?;
    drop(result);
    gate.rollback().await?;

    create(primary, invalid, -1).await?;
    ensure(
        matches!(
            control::settle(primary, invalid, TIMEOUT, sink).await,
            Err(control::SubmissionError::InvalidState)
        ),
        "zero members is invalid, not all-finished",
    )?;
    let state: String = primary
        .query_one(
            "SELECT status FROM ocr_submissions WHERE id = $1",
            &[&invalid],
        )
        .await?
        .get(0);
    ensure(state == "open", "failed finalization must roll back")?;
    member(primary, invalid, "total_assets", Some("succeeded")).await?;
    primary
        .execute(
            "UPDATE ocr_submission_members SET screen_type = 'revenue' WHERE submission_id = $1",
            &[&invalid],
        )
        .await?;
    ensure(
        matches!(
            control::settle(primary, invalid, TIMEOUT, sink).await,
            Err(control::SubmissionError::InvalidState)
        ),
        "cross-screen job reference cannot count as success",
    )?;
    primary.execute("UPDATE ocr_submissions SET status = 'aborted', finished_at = clock_timestamp() WHERE id = $1", &[&invalid]).await?;

    create(primary, success, -1).await?;
    member(primary, success, "total_assets", Some("succeeded")).await?;
    let notice = prepared(control::settle(primary, success, TIMEOUT, sink).await?)?;
    ensure(
        notice.payload()?.pointer("/data/failures") == Some(&serde_json::json!([])),
        "success must have an empty failure list",
    )?;
    drop(notice);

    for (retained, status) in RETAINED_IDS
        .into_iter()
        .zip(["needs_review", "draft_ready"])
    {
        create(primary, retained, -1).await?;
        member(primary, retained, "total_assets", None).await?;
        primary.execute("UPDATE match_drafts SET total_assets_draft_id = 'retained-result', status = $2 WHERE id = $1", &[&retained, &status]).await?;
        let notification = prepared(control::settle(primary, retained, TIMEOUT, sink).await?)?;
        ensure(
            notification.payload()?.pointer("/data/failures/0/reason")
                == Some(&serde_json::json!("admission_timeout")),
            "job-zero submission still emits its admission failure",
        )?;
        drop(notification);
        let projection = primary
            .query_one(
                "SELECT status, total_assets_draft_id FROM match_drafts WHERE id = $1",
                &[&retained],
            )
            .await?;
        ensure(
            projection.get::<_, String>(0) == status
                && projection.get::<_, Option<String>>(1).as_deref() == Some("retained-result"),
            "job-zero submission cannot overwrite a retained source result or status",
        )?;
    }
    verify_idle_recovery(primary, url, cold).await?;
    Ok(())
}

async fn verify_idle_recovery(primary: &Client, url: &str, cold: &str) -> TestResult {
    let (_wake, receiver) = watch::channel(());
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut progress) = watch::channel(0_u64);
    let schedule = Schedule {
        safety_interval: Duration::from_millis(30),
        observed: Some(observed),
    };
    let database = postgres::connect(url).await?;
    let mut cursor = ScanCursor::default();
    let runner = coordinate(
        database,
        receiver,
        stop,
        TIMEOUT,
        NotificationSink::default(),
        schedule,
        &mut cursor,
    );
    let check = async {
        progress.changed().await?; // First scan completed while no new submission existed.
        create(primary, cold, -1).await?;
        member(primary, cold, "total_assets", None).await?; // Deliberately no hint.
        time::timeout(Duration::from_secs(2), async {
            loop {
                progress.changed().await?;
                let settled: bool = primary
                    .query_one(
                        "SELECT status = 'settled' FROM ocr_submissions WHERE id = $1",
                        &[&cold],
                    )
                    .await?
                    .get(0);
                if settled {
                    return Ok::<(), Box<dyn Error + Send + Sync>>(());
                }
            }
        })
        .await??;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stop_after_check = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (runtime, assertion) = tokio::join!(runner, stop_after_check);
    runtime?;
    assertion?;
    Ok(())
}

fn named_database(url: &str, name: &str) -> TestResult<String> {
    let mut parsed = url::Url::parse(url)?;
    parsed
        .query_pairs_mut()
        .append_pair("application_name", name);
    Ok(parsed.to_string())
}

async fn verify_listener_reconnect(primary: &Client, url: &str) -> TestResult {
    let [id, _, _] = RECOVERY_IDS;
    create(primary, id, 600).await?;
    member(primary, id, "total_assets", None).await?;
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut progress) = watch::channel(0_u64);
    let config = Config {
        database_url: url.to_owned(),
        listener_database_url: named_database(url, "mom24-listener-reconnect")?,
        finalization_timeout: TIMEOUT,
    };
    let runtime = run_observed(config, NotificationSink::default(), stop, observed);
    let check = async {
        time::timeout(Duration::from_secs(2), progress.changed()).await??;
        primary.execute("UPDATE ocr_submissions SET admission_deadline = clock_timestamp() - interval '1 second' WHERE id = $1", &[&id]).await?;
        let terminated = primary.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'mom24-listener-reconnect'", &[]).await?;
        ensure(
            terminated.len() == 1,
            "exactly the owned LISTEN connection is terminated",
        )?;
        time::timeout(Duration::from_secs(3), async {
            loop {
                progress.changed().await?;
                let settled: bool = primary
                    .query_one(
                        "SELECT status = 'settled' FROM ocr_submissions WHERE id = $1",
                        &[&id],
                    )
                    .await?
                    .get(0);
                if settled {
                    return Ok::<(), Box<dyn Error + Send + Sync>>(());
                }
            }
        })
        .await??;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stopped = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (result, assertion) = tokio::join!(runtime, stopped);
    result?;
    assertion?;
    Ok(())
}

async fn verify_deadline_reconnect(primary: &Client, peer: &mut Client, url: &str) -> TestResult {
    let [_, delayed, later] = RECOVERY_IDS;
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut progress) = watch::channel(0_u64);
    let config = Config {
        database_url: named_database(url, "mom24-control-timeout")?,
        listener_database_url: url.to_owned(),
        finalization_timeout: Duration::from_millis(300),
    };
    let runtime = run_observed(config, NotificationSink::default(), stop, observed);
    let check = async {
        time::timeout(Duration::from_secs(2), progress.changed()).await??;
        for id in [delayed, later] {
            create(primary, id, -1).await?;
            member(primary, id, "total_assets", None).await?;
        }
        let barrier = peer.transaction().await?;
        barrier
            .batch_execute("LOCK TABLE ocr_submission_members IN ACCESS EXCLUSIVE MODE")
            .await?;
        super::super::wake(primary).await;

        let pid = time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(row) = primary.query_opt("SELECT pid FROM pg_stat_activity WHERE application_name = 'mom24-control-timeout' AND wait_event_type = 'Lock'", &[]).await? {
                    return Ok::<i32, tokio_postgres::Error>(row.get(0));
                }
                tokio::task::yield_now().await;
            }
        }).await??;
        time::timeout(Duration::from_secs(2), async {
            loop {
                let alive: bool = primary
                    .query_one(
                        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1)",
                        &[&pid],
                    )
                    .await?
                    .get(0);
                if !alive {
                    return Ok::<(), tokio_postgres::Error>(());
                }
                tokio::task::yield_now().await;
            }
        })
        .await??;
        barrier.commit().await?;
        time::timeout(Duration::from_secs(2), progress.changed()).await??;
        let later_settled: bool = primary
            .query_one(
                "SELECT status = 'settled' FROM ocr_submissions WHERE id = $1",
                &[&later],
            )
            .await?
            .get(0);
        let delayed_open: bool = primary
            .query_one(
                "SELECT status = 'open' FROM ocr_submissions WHERE id = $1",
                &[&delayed],
            )
            .await?
            .get(0);
        ensure(
            later_settled && delayed_open,
            "replacement connection must resume after the timed-out row",
        )?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stopped = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (result, assertion) = tokio::join!(runtime, stopped);
    result?;
    assertion?;
    let mut recovered = postgres::connect(url).await?;
    ensure(
        matches!(
            control::settle(
                &mut recovered,
                delayed,
                TIMEOUT,
                &NotificationSink::default()
            )
            .await?,
            Settlement::Settled(None)
        ),
        "timed-out open submission remains recoverable",
    )?;
    Ok(())
}
