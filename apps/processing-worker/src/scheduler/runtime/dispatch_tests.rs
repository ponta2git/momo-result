//! Durable claims must progress even when candidate discovery consumes the soft scan budget.
#![expect(
    clippy::panic_in_result_fn,
    reason = "isolated database assertions observe durable job and execution-slot transitions"
)]

use std::{error::Error, fs, num::NonZeroU64, path::Path, time::Duration};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use tempfile::TempDir;
use tokio::sync::watch;
use tokio_postgres::Client;

use super::{ScanBudget, Scheduler, SchedulerError, claim_analysis, claim_ocr, time};
use crate::{
    cgroup::{CgroupHierarchy, ChildCgroup},
    notifications::NotificationSink,
    ocr::control::OcrControlConfig,
    postgres::{self, test_support::DelayedDatabase},
    scheduler::{PostCommitSink, runtime::Settings},
    series_analysis::{
        config::{AnalysisConsumerConfig, AnalysisExecutionLimits},
        control::ALGORITHM_VERSION,
    },
};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
const ANALYSIS: &str = "scheduler-dispatch-smoke-analysis-a";
const WAITING: &str = "scheduler-dispatch-smoke-analysis-b";
const OCR: &str = "scheduler-dispatch-smoke-ocr";
const WORKER: &str = "scheduler-dispatch-smoke-worker";

#[tokio::test]
#[ignore = "requires explicitly isolated PROCESSING_SCHEDULER_SMOKE_DATABASE_URL"]
async fn real_postgres_delayed_candidates_still_attempt_durable_claims() -> TestResult {
    let database_url = std::env::var("PROCESSING_SCHEDULER_SMOKE_DATABASE_URL")?;
    let observer = postgres::connect(&database_url).await?;
    cleanup(&observer).await?;
    let vacant: bool = observer
        .query_one(
            "SELECT owner IS NULL FROM worker_execution_slots WHERE slot_key='shared-heavy-work'",
            &[],
        )
        .await?
        .try_get(0)?;
    assert!(
        vacant,
        "the scheduler fixture requires an isolated vacant slot"
    );
    insert_analysis(&observer).await?;
    let proxy = DelayedDatabase::start(&database_url, Duration::from_millis(150)).await?;
    let directory = TempDir::new()?;
    let config = analysis_config(&database_url, directory.path())?;
    let mut scheduler = fixture(&proxy.url, config).await?;
    let (shutdown, stopped) = watch::channel(true);

    // Shutdown takes precedence over the first-attempt guarantee.
    assert!(!Box::pin(claim_analysis(&mut scheduler, &stopped, &mut budget())).await?);
    assert_job(&observer, ANALYSIS, "queued", 0).await?;
    shutdown.send_replace(false);

    // Exercise both production scans with the same budget, as claim_next does.
    let mut shared = budget();
    assert!(!claim_ocr(&mut scheduler, &stopped, &mut shared).await?);
    assert!(
        shared.exhausted(),
        "the empty OCR query must consume the shared budget"
    );
    let analysis_claim = Box::pin(claim_analysis(&mut scheduler, &stopped, &mut shared)).await;
    assert!(matches!(
        analysis_claim,
        Err(SchedulerError::UnsupportedPlatform)
    ));
    assert_job(&observer, ANALYSIS, "running", 1).await?;
    let attempt_count: i64 = observer
        .query_one(
            "SELECT count(*) FROM series_analysis_job_attempts WHERE job_id=$1",
            &[&ANALYSIS],
        )
        .await?
        .try_get(0)?;
    assert_eq!(attempt_count, 1);
    assert_slot(&observer, "analysis", ANALYSIS).await?;

    // An active analysis must still receive the first slow OCR preemption request.
    insert_ocr(&observer).await?;
    scheduler.active = Some(tokio::spawn(std::future::pending()));
    assert!(!claim_ocr(&mut scheduler, &stopped, &mut budget()).await?);
    let requester: Option<String> = observer.query_one("SELECT preempt_requested_by FROM worker_execution_slots WHERE slot_key='shared-heavy-work'", &[]).await?.try_get(0)?;
    assert_eq!(requester.as_deref(), Some(WORKER));
    assert_slot(&observer, "analysis", ANALYSIS).await?;
    let active = scheduler
        .active
        .take()
        .ok_or("missing fixture active task")?;
    active.abort();
    assert!(active.await.is_err());
    clear_slot(&observer).await?;

    // No child is installed: UnsupportedPlatform occurs only after the real DB claim commits.
    let ocr_claim = claim_ocr(&mut scheduler, &stopped, &mut budget()).await;
    assert!(matches!(
        ocr_claim,
        Err(SchedulerError::UnsupportedPlatform)
    ));
    let row = observer
        .query_one(
            "SELECT status,attempt_count FROM ocr_jobs WHERE id=$1",
            &[&OCR],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "running");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    assert_slot(&observer, "ocr", OCR).await?;

    // A real busy claim must retain its backoff and leave the waiting attempt untouched.
    assert!(!Box::pin(claim_analysis(&mut scheduler, &stopped, &mut budget())).await?);
    assert!(
        scheduler
            .retry_after
            .is_some_and(|retry| retry > time::Instant::now())
    );
    assert_job(&observer, WAITING, "queued", 0).await?;
    assert_slot(&observer, "ocr", OCR).await?;
    drop(scheduler);
    cleanup(&observer).await?;
    Box::pin(verify_cursor_yield(&database_url, &proxy.url, &observer)).await?;
    cleanup(&observer).await?;
    Ok(())
}

async fn verify_cursor_yield(
    database_url: &str,
    delayed_url: &str,
    observer: &Client,
) -> TestResult {
    insert_analysis(observer).await?;
    let directory = TempDir::new()?;
    let mut scheduler = fixture(
        delayed_url,
        analysis_config(database_url, directory.path())?,
    )
    .await?;
    let (_shutdown, stopped) = watch::channel(false);
    let mut contender = postgres::connect(database_url).await?;
    let held_title = contender.transaction().await?;
    held_title.query_one("SELECT game_title_id FROM series_analysis_title_states WHERE game_title_id=$1 FOR UPDATE", &[&ANALYSIS]).await?;

    // The first candidate is attempted but contended. Yield before advancing over B.
    let mut scan = budget();
    assert!(Box::pin(claim_analysis(&mut scheduler, &stopped, &mut scan)).await?);
    assert!(scan.contended);
    assert_eq!(
        scheduler
            .analysis_cursor
            .as_ref()
            .map(|cursor| cursor.id.as_str()),
        Some(ANALYSIS)
    );
    assert_job(observer, ANALYSIS, "queued", 0).await?;
    assert_job(observer, WAITING, "queued", 0).await?;
    held_title.rollback().await?;

    let advanced = Box::pin(claim_analysis(&mut scheduler, &stopped, &mut budget())).await;
    assert!(matches!(advanced, Err(SchedulerError::UnsupportedPlatform)));
    assert_job(observer, WAITING, "running", 1).await?;
    assert_job(observer, ANALYSIS, "queued", 0).await?;
    assert_slot(observer, "analysis", WAITING).await?;
    clear_slot(observer).await?;

    // Exhausting the keyset wraps it, allowing the formerly contended A to run.
    assert!(!Box::pin(claim_analysis(&mut scheduler, &stopped, &mut budget())).await?);
    assert!(scheduler.analysis_cursor.is_none());
    let wrapped = Box::pin(claim_analysis(&mut scheduler, &stopped, &mut budget())).await;
    drop(scheduler);
    assert!(matches!(wrapped, Err(SchedulerError::UnsupportedPlatform)));
    assert_job(observer, ANALYSIS, "running", 1).await?;
    assert_slot(observer, "analysis", ANALYSIS).await?;
    Ok(())
}

fn budget() -> ScanBudget {
    ScanBudget {
        until: time::Instant::now() + Duration::from_millis(250),
        contended: false,
    }
}

async fn fixture(database_url: &str, config: AnalysisConsumerConfig) -> TestResult<Scheduler> {
    let settings = Settings::from(&config);
    let (sink, wake) = PostCommitSink::channel();
    let (stop, stopped) = watch::channel(false);
    Ok(Scheduler {
        config: Some(config),
        settings,
        database: postgres::connect(database_url).await?,
        analysis: None,
        ocr: None,
        ocr_config: Some(OcrControlConfig::new(
            WORKER.to_owned(),
            Duration::from_mins(5),
            Duration::from_secs(30),
            Duration::from_secs(1),
        )?),
        active: None,
        ocr_cursor: None,
        analysis_cursor: None,
        retry_after: None,
        recovery_cursor: None,
        sink,
        wake,
        stopped,
        stop,
        listener: None,
    })
}

fn analysis_config(database_url: &str, directory: &Path) -> TestResult<AnalysisConsumerConfig> {
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
        listener_database_url: database_url.to_owned(),
        read_database_url: database_url.to_owned(),
        worker_id: WORKER.to_owned(),
        temporary_root: directory.to_path_buf(),
        effective_config_version: "scheduler-dispatch-smoke".to_owned(),
        lease_duration: Duration::from_mins(5),
        heartbeat_interval: Duration::from_secs(1),
        heartbeat_timeout: Duration::from_secs(5),
        child_stop_grace: Duration::from_secs(1),
        recovery_interval: Duration::from_secs(5),
        ocr_stale_after: Duration::from_secs(300),
        notifications: NotificationSink::default(),
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
            finalization_timeout: Duration::from_secs(30),
            temporary_bytes_limit: bound(67_108_864)?,
            chunk_bytes_limit: bound(16_777_216)?,
            chunk_count_limit: bound(1_000)?,
            temporary_file_count_limit: bound(1_001)?,
        },
    })
}

async fn insert_analysis(client: &Client) -> TestResult {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    for id in [ANALYSIS, WAITING] {
        client.execute("INSERT INTO game_titles(id,name,layout_family,display_order) VALUES ($1,$1,'momotetsu2',9999)", &[&id]).await?;
        client.execute("INSERT INTO series_analysis_jobs(id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,trigger,available_at,requested_at) VALUES ($1,$1,0,$2,$3,$4,'queued','manual',TIMESTAMPTZ '2020-01-01',TIMESTAMPTZ '2020-01-01')", &[&id,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    }
    Ok(())
}

async fn insert_ocr(client: &Client) -> TestResult {
    let hash = "ab".repeat(32);
    let idempotency = "fe".repeat(32);
    client.execute("INSERT INTO source_images(id,owner_account_id,object_key,idempotency_key_hash,status,media_type,byte_length,sha256_hex,width,height,storage_etag,available_at) VALUES ($1,'account_ponta','source-images/scheduler-dispatch-smoke.png',$2,'AVAILABLE','image/png',68,$3,1,1,'fixture',clock_timestamp())", &[&OCR,&idempotency,&hash]).await?;
    client.execute("INSERT INTO match_drafts(id,created_by_account_id,status,total_assets_draft_id) VALUES ($1,'account_ponta','ocr_running',$1)", &[&OCR]).await?;
    let input = serde_json::json!({"schemaVersion":"2","jobId":OCR,"draftId":OCR,"sourceImageId":OCR,"imageObjectKey":"source-images/scheduler-dispatch-smoke.png","sha256":hash,"byteLength":"68","mediaType":"image/png","requestedScreenType":"total_assets"});
    client.execute("INSERT INTO ocr_jobs(id,draft_id,image_id,requested_screen_type,status,source_image_id,input_snapshot) VALUES ($1,$1,$1,'total_assets','queued',$1,$2)", &[&OCR,&input]).await?;
    client.execute("INSERT INTO ocr_submissions(id,owner_account_id,match_draft_id,status,admission_deadline) VALUES ('ad15e7ce-0000-4000-8000-000000000001','account_ponta',$1,'open',clock_timestamp()+interval '10 minutes')", &[&OCR]).await?;
    client.execute("INSERT INTO ocr_submission_members(submission_id,screen_type,upload_idempotency_key_hash,image_sha256_hex,image_byte_length,status,job_id) VALUES ('ad15e7ce-0000-4000-8000-000000000001','total_assets',$1,$2,68,'registered',$3)", &[&idempotency,&"ab".repeat(32),&OCR]).await?;
    Ok(())
}

async fn assert_job(client: &Client, id: &str, status: &str, attempts: i32) -> TestResult {
    let row = client
        .query_one(
            "SELECT status,attempt_count FROM series_analysis_jobs WHERE id=$1",
            &[&id],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, status);
    assert_eq!(row.try_get::<_, i32>(1)?, attempts);
    Ok(())
}

async fn assert_slot(client: &Client, kind: &str, job: &str) -> TestResult {
    let row = client.query_one("SELECT task_kind,job_id,owner,fencing_token FROM worker_execution_slots WHERE slot_key='shared-heavy-work'", &[]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, kind);
    assert_eq!(row.try_get::<_, String>(1)?, job);
    assert_eq!(row.try_get::<_, String>(2)?, WORKER);
    assert!(row.try_get::<_, i64>(3)? > 0);
    Ok(())
}

async fn clear_slot(client: &Client) -> TestResult {
    client.execute("UPDATE worker_execution_slots SET task_kind=NULL,owner=NULL,job_id=NULL,attempt_id=NULL,holder_preemptible=NULL,lease_expires_at=NULL,preempt_requested_by=NULL,preempt_requested_at=NULL WHERE slot_key='shared-heavy-work' AND owner=$1", &[&WORKER]).await?;
    Ok(())
}

async fn cleanup(client: &Client) -> TestResult {
    clear_slot(client).await?;
    client
        .execute(
            "DELETE FROM ocr_submission_members WHERE job_id=$1",
            &[&OCR],
        )
        .await?;
    client
        .execute(
            "DELETE FROM ocr_submissions WHERE match_draft_id=$1",
            &[&OCR],
        )
        .await?;
    client
        .execute("DELETE FROM ocr_jobs WHERE id=$1", &[&OCR])
        .await?;
    client
        .execute("DELETE FROM match_drafts WHERE id=$1", &[&OCR])
        .await?;
    client
        .execute("DELETE FROM source_images WHERE id=$1", &[&OCR])
        .await?;
    for id in [ANALYSIS, WAITING] {
        client
            .execute(
                "DELETE FROM series_analysis_job_attempts WHERE job_id=$1",
                &[&id],
            )
            .await?;
        client
            .execute("DELETE FROM series_analysis_jobs WHERE id=$1", &[&id])
            .await?;
        client
            .execute("DELETE FROM game_titles WHERE id=$1", &[&id])
            .await?;
    }
    Ok(())
}
