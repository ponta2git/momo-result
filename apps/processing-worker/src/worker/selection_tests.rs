//! Isolated durable-job scans and recovery without an external delivery trigger.
#![expect(
    clippy::panic_in_result_fn,
    reason = "assertions keep isolated database acceptance boundaries explicit"
)]

use std::{collections::BTreeSet, error::Error, time::Duration};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use tokio_postgres::Client;

use super::{candidates, next_due, recover, recover_page};
use crate::{series_analysis::control::ALGORITHM_VERSION, worker::PostCommitSink};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
const TITLE: &str = "scheduler-selection-smoke-title";
const OWNER: &str = "scheduler-selection-smoke-worker";
const PREFIX: &str = "scheduler-selection-smoke-";

#[tokio::test]
#[ignore = "requires explicitly isolated PROCESSING_SCHEDULER_SMOKE_DATABASE_URL"]
async fn real_postgres_selects_due_work_and_recovers_orphans() -> TestResult {
    let database_url = std::env::var("PROCESSING_SCHEDULER_SMOKE_DATABASE_URL")?;
    let mut client = crate::postgres::connect(&database_url).await?;
    cleanup(&client).await?;
    let baseline = client.query_one("SELECT (SELECT count(*) FROM series_analysis_jobs WHERE status IN ('queued','running')), (SELECT count(*) FROM ocr_jobs WHERE status IN ('queued','running')), (SELECT owner IS NULL FROM worker_execution_slots WHERE slot_key='shared-heavy-work')", &[]).await?;
    assert_eq!(baseline.try_get::<_, i64>(0)?, 0);
    assert_eq!(baseline.try_get::<_, i64>(1)?, 0);
    assert!(baseline.try_get::<_, bool>(2)?);
    assert_eq!(
        next_due(&client, true, Duration::from_secs(30)).await?,
        Duration::from_secs(30)
    );
    client.execute("INSERT INTO game_titles (id,name,layout_family,display_order) VALUES ($1,'Scheduler selection smoke','momotetsu2',9999)", &[&TITLE]).await?;
    insert_jobs(&client).await?;
    assert!(candidates(&client, false, None).await?.is_empty());
    let due = next_due(&client, true, Duration::from_secs(30)).await?;
    assert!(due > Duration::ZERO && due <= Duration::from_secs(20));
    assert_eq!(
        next_due(&client, true, Duration::from_secs(1)).await?,
        Duration::from_secs(1)
    );
    client.execute("UPDATE series_analysis_jobs SET available_at=TIMESTAMPTZ '2020-01-01',requested_at=TIMESTAMPTZ '2020-01-01' WHERE id LIKE $1", &[&format!("{PREFIX}%")]).await?;
    let mut cursor = None;
    let mut ids = BTreeSet::new();
    let mut pages = 0;
    loop {
        let page = candidates(&client, false, cursor.as_ref()).await?;
        if page.is_empty() {
            break;
        }
        assert!(page.len() <= 64);
        pages += 1;
        for candidate in &page {
            assert!(
                ids.insert(candidate.id.clone()),
                "keyset pagination repeated a job"
            );
        }
        cursor = page.last().cloned();
    }
    assert_eq!(ids.len(), 300);
    assert_eq!(pages, 5);
    assert!(!ids.contains("scheduler-selection-smoke-unsupported"));
    assert_eq!(
        next_due(&client, true, Duration::from_secs(30)).await?,
        Duration::from_secs(30),
        "already due blocked jobs must not create a zero-delay retry loop"
    );
    client
        .execute(
            "DELETE FROM series_analysis_jobs WHERE id LIKE $1",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    verify_recovery(&mut client, true).await?;
    verify_recovery(&mut client, false).await?;
    verify_supported_intent_is_not_hidden(&mut client).await?;
    cleanup(&client).await?;
    Ok(())
}

async fn insert_jobs(client: &Client) -> TestResult {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    client.execute("INSERT INTO game_titles (id,name,layout_family,display_order) SELECT $1 || 'title-' || n::text,'Scheduler page smoke ' || n::text,'momotetsu2',10000+n FROM generate_series(1,301) n", &[&PREFIX]).await?;
    client.execute("INSERT INTO series_analysis_jobs (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,trigger,available_at) SELECT $1 || n::text,$1 || 'title-' || n::text,n,$2,$3,$4,'queued','manual',clock_timestamp()+interval '20 seconds' FROM generate_series(1,300) n", &[&PREFIX,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    client.execute("INSERT INTO series_analysis_jobs (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,trigger,available_at) VALUES ('scheduler-selection-smoke-unsupported',$1,301,'unsupported-scheduler-smoke',$2,$3,'queued','manual',clock_timestamp())", &[&format!("{PREFIX}title-301"),&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    Ok(())
}

async fn verify_recovery(client: &mut Client, held: bool) -> TestResult {
    let job = if held {
        "scheduler-selection-smoke-held"
    } else {
        "scheduler-selection-smoke-orphan"
    };
    let attempt = format!("{job}-attempt");
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    let revision: i64 = if held { 401 } else { 402 };
    let fence: i64 = 8_000_001;
    client.execute("INSERT INTO series_analysis_jobs (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,trigger,started_at,lease_owner,lease_attempt_id,lease_fencing_token,lease_expires_at,lease_validation_contract_id,attempt_count) VALUES ($1,$2,$3,$4,$5,$6,'running','manual',clock_timestamp(),$7,$8,$9,clock_timestamp()-interval '1 second',$6,1)", &[&job,&TITLE,&revision,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID,&OWNER,&attempt,&fence]).await?;
    client.execute("INSERT INTO series_analysis_job_attempts (id,job_id,attempt_no,owner,fencing_token,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,status,effective_config_version,calculation_timeout_milliseconds) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'running','scheduler-smoke',60000)", &[&attempt,&job,&OWNER,&fence,&revision,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    let slot_job = if held {
        job
    } else {
        "scheduler-selection-smoke-live"
    };
    client.execute("UPDATE worker_execution_slots SET task_kind='analysis',owner=$1,job_id=$2,attempt_id=$3,holder_preemptible=true,lease_expires_at=clock_timestamp()+$4::bigint*interval '1 second',fencing_token=$5 WHERE slot_key='shared-heavy-work' AND owner IS NULL", &[&OWNER,&slot_job,&attempt,&if held {-1_i64} else {60_i64},&fence]).await?;
    assert!(candidates(client, false, None).await?.is_empty());
    let (sink, mut wake) = PostCommitSink::channel();
    if held {
        let database_url = std::env::var("PROCESSING_SCHEDULER_SMOKE_DATABASE_URL")?;
        let mut blocker = crate::postgres::connect(&database_url).await?;
        let lock = blocker.transaction().await?;
        lock.query_one("SELECT game_title_id FROM series_analysis_title_states WHERE game_title_id=$1 FOR UPDATE", &[&TITLE]).await?;
        let progress = recover_page(client, &sink, 1, &mut None).await?;
        assert!(
            progress.deferred,
            "ordinary recovery contention must remain retryable"
        );
        assert!(!progress.more);
        assert!(wake.try_recv().is_err());
        lock.rollback().await?;
    }
    recover(client, &sink, 1).await?;
    assert!(wake.try_recv().is_ok());
    let row = client.query_one("SELECT j.status,j.lease_recovery_count,a.status,a.outcome FROM series_analysis_jobs j JOIN series_analysis_job_attempts a ON a.job_id=j.id WHERE j.id=$1", &[&job]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, "queued");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    assert_eq!(row.try_get::<_, String>(2)?, "terminal");
    assert_eq!(row.try_get::<_, String>(3)?, "owner_lost");
    let slot = client.query_one("SELECT owner,job_id,fencing_token FROM worker_execution_slots WHERE slot_key='shared-heavy-work'", &[]).await?;
    assert_eq!(slot.try_get::<_, i64>(2)?, fence);
    if held {
        assert!(slot.try_get::<_, Option<String>>(0)?.is_none());
    } else {
        assert_eq!(
            slot.try_get::<_, Option<String>>(0)?.as_deref(),
            Some(OWNER)
        );
        assert_eq!(
            slot.try_get::<_, Option<String>>(1)?.as_deref(),
            Some(slot_job)
        );
    }
    client
        .execute(
            "DELETE FROM series_analysis_job_attempts WHERE job_id=$1",
            &[&job],
        )
        .await?;
    client
        .execute("DELETE FROM series_analysis_jobs WHERE id=$1", &[&job])
        .await?;
    Ok(())
}

async fn verify_supported_intent_is_not_hidden(client: &mut Client) -> TestResult {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    let supported = format!("{PREFIX}zz-supported");
    client.execute("UPDATE series_analysis_title_states SET algorithm_version='unsupported-scheduler-smoke',artifact_schema_version=$2,validation_contract_id=$3 WHERE game_title_id LIKE $1", &[&format!("{PREFIX}%"),&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    client.execute("INSERT INTO game_titles (id,name,layout_family,display_order) VALUES ($1,'Scheduler supported intent','momotetsu2',20000)", &[&supported]).await?;
    client.execute("UPDATE series_analysis_title_states SET algorithm_version=$2,artifact_schema_version=$3,validation_contract_id=$4 WHERE game_title_id=$1", &[&supported,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    client.execute("INSERT INTO series_analysis_job_requests (id,game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,trigger) SELECT game_title_id || '-request',game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,'manual' FROM series_analysis_title_states WHERE game_title_id LIKE $1", &[&format!("{PREFIX}%")]).await?;
    assert_eq!(
        crate::series_analysis::control::radar::materialize_pending(client, 64).await?,
        1,
        "incompatible pending titles must not hide a later supported intent"
    );
    let materialized = client
        .query_one(
            "SELECT game_title_id FROM series_analysis_jobs WHERE game_title_id LIKE $1",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    assert_eq!(materialized.try_get::<_, String>(0)?, supported);
    Ok(())
}

async fn cleanup(client: &Client) -> TestResult {
    client
        .execute(
            "DELETE FROM series_analysis_job_requests WHERE game_title_id LIKE $1",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    client.execute("UPDATE worker_execution_slots SET task_kind=NULL,owner=NULL,job_id=NULL,attempt_id=NULL,holder_preemptible=NULL,lease_expires_at=NULL,preempt_requested_by=NULL,preempt_requested_at=NULL WHERE slot_key='shared-heavy-work' AND owner=$1", &[&OWNER]).await?;
    client
        .execute(
            "DELETE FROM series_analysis_job_attempts WHERE job_id IN (SELECT id FROM series_analysis_jobs WHERE game_title_id LIKE $1)",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    client
        .execute(
            "DELETE FROM series_analysis_jobs WHERE game_title_id LIKE $1",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    client
        .execute(
            "DELETE FROM game_titles WHERE id LIKE $1",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    Ok(())
}
