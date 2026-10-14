//! Delayed and missing COMMIT replies must preserve recoverable fenced ownership.

use std::sync::Arc;

use tokio::{sync::Notify, time};

use super::{
    Client, Duration, SmokeResult, TAKEOVER, claimed, control_config, insert_fixture,
    prepare_database,
};
use crate::{
    ocr::control::{claim_job, requeue_interrupted},
    postgres::test_support::{CommitFault, DelayedDatabase},
};

pub(super) async fn verify(database_url: &str, observer: &Client) -> SmokeResult {
    insert_fixture(observer, &TAKEOVER).await?;
    let committed = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let proxy = DelayedDatabase::commit_fault(
        database_url,
        CommitFault::HoldReply {
            committed: Arc::clone(&committed),
            release: Arc::clone(&release),
        },
    )
    .await?;
    let mut client = crate::postgres::connect(&proxy.url).await?;
    let config = control_config("ocr-c2-worker-a")?;
    let worker_config = config.clone();
    let mut claim_task = tokio::spawn(async move {
        let outcome = time::timeout(
            Duration::from_secs(2),
            claim_job(&mut client, TAKEOVER.job_id, &worker_config),
        )
        .await??;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>((client, outcome))
    });
    time::timeout(Duration::from_secs(5), committed.notified()).await?;
    assert!(
        time::timeout(Duration::from_millis(100), &mut claim_task)
            .await
            .is_err()
    );
    release.notify_one();
    let (mut client, outcome) = time::timeout(Duration::from_secs(3), claim_task).await???;
    let claim = claimed(outcome)?;
    requeue_interrupted(&mut client, &claim, &config).await?;
    let state = observer.query_one(
        "SELECT j.status, s.owner IS NULL, j.failure_retry_count, j.lease_recovery_count FROM ocr_jobs j CROSS JOIN worker_execution_slots s WHERE j.id=$1 AND s.slot_key='shared-heavy-work'", &[&TAKEOVER.job_id],
    ).await?;
    assert_eq!(state.try_get::<_, String>(0)?, "queued");
    assert!(state.try_get::<_, bool>(1)?);
    assert_eq!(state.try_get::<_, i32>(2)?, 0);
    assert_eq!(state.try_get::<_, i32>(3)?, 0);

    prepare_database(observer).await?;
    insert_fixture(observer, &TAKEOVER).await?;
    let mut uncertain_client = crate::postgres::connect(&proxy.url).await?;
    let uncertain = tokio::spawn(async move {
        time::timeout(
            Duration::from_secs(1),
            claim_job(&mut uncertain_client, TAKEOVER.job_id, &config),
        )
        .await
    });
    time::timeout(Duration::from_secs(5), committed.notified()).await?;
    assert!(
        time::timeout(Duration::from_secs(3), uncertain)
            .await??
            .is_err()
    );
    let state = observer.query_one(
        "SELECT j.status, s.owner IS NOT NULL, j.failure_retry_count, j.lease_recovery_count FROM ocr_jobs j CROSS JOIN worker_execution_slots s WHERE j.id=$1 AND s.slot_key='shared-heavy-work'", &[&TAKEOVER.job_id],
    ).await?;
    assert_eq!(state.try_get::<_, String>(0)?, "running");
    assert!(state.try_get::<_, bool>(1)?);
    assert_eq!(state.try_get::<_, i32>(2)?, 0);
    assert_eq!(state.try_get::<_, i32>(3)?, 0);
    Ok(())
}
