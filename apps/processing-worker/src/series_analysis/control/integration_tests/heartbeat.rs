use super::*;
use crate::{
    notifications::{
        NotificationSink,
        test_support::{CommitFault, DelayedDatabase},
    },
    series_analysis::{
        control::HeartbeatResult,
        heartbeat::{HeartbeatConnection, HeartbeatFailure},
    },
};

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_heartbeat_owns_deadline_and_connection() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let primary = crate::postgres::connect(&database_url).await?;
    cleanup_database(&primary).await?;
    prepare_owned_attempt(&primary).await?;
    let directory = TempDir::new()?;
    let mut config =
        notifications::config(&database_url, NotificationSink::default(), directory.path())?;
    config.lease_duration = Duration::from_secs(70);
    let claim = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    super::super::register_capability(&primary, &config.worker_id).await?;

    // Real response latency crosses the former one-second deadline without lock contention.
    for latency in [300, 650] {
        let proxy = DelayedDatabase::start(&database_url, Duration::from_millis(latency)).await?;
        config.database_url.clone_from(&proxy.url);
        let mut connection = HeartbeatConnection::connect(&config.database_url).await?;
        for _ in 0..2 {
            let started = std::time::Instant::now();
            assert!(matches!(
                connection.renew(&claim, &config).await,
                Ok(HeartbeatResult::Continue)
            ));
            assert!(
                started.elapsed() > Duration::from_secs(1),
                "exercise delayed wire operations"
            );
        }
    }

    let proxy = DelayedDatabase::start(&database_url, Duration::from_secs(1)).await?;
    config.database_url.clone_from(&proxy.url);
    let mut connection = HeartbeatConnection::connect(&config.database_url).await?;
    assert!(matches!(
        connection.renew(&claim, &config).await,
        Err(HeartbeatFailure::Deadline)
    ));
    // The same capability object must open a fresh connection; the failed transport is never reused.
    config.database_url.clone_from(&database_url);
    assert!(matches!(
        connection.renew(&claim, &config).await,
        Ok(HeartbeatResult::Continue)
    ));

    let mut stale = claim.clone();
    stale.fencing_token += 1;
    assert!(matches!(
        connection.renew(&stale, &config).await,
        Ok(HeartbeatResult::OwnerLost)
    ));
    for (fault, committed) in [
        (CommitFault::BeforeCommit, false),
        (CommitFault::LostReply, true),
    ] {
        // Give the old lease a distinct value. Independently read durable state after disconnect.
        primary.execute("UPDATE series_analysis_jobs SET lease_expires_at = clock_timestamp() + interval '10 minutes' WHERE id = $1", &[&claim.job_id]).await?;
        let proxy = DelayedDatabase::commit_fault(&database_url, fault).await?;
        config.database_url.clone_from(&proxy.url);
        let mut uncertain = HeartbeatConnection::connect(&config.database_url).await?;
        assert!(
            uncertain.renew(&claim, &config).await.is_err(),
            "a lost COMMIT result must not authorize publication"
        );
        let committed_result: bool = primary.query_one("SELECT lease_expires_at < clock_timestamp() + interval '2 minutes' FROM series_analysis_jobs WHERE id = $1", &[&claim.job_id]).await?.try_get(0)?;
        assert_eq!(committed_result, committed);
        assert_current(&primary, None).await?;
        config.database_url.clone_from(&database_url);
        assert!(
            matches!(
                uncertain.renew(&claim, &config).await,
                Ok(HeartbeatResult::Continue)
            ),
            "both commit outcomes converge through a fresh guarded update"
        );
    }
    drop(config);
    assert_current(&primary, None).await?;
    drop(connection);
    cleanup_database(&primary).await?;
    primary
        .execute(
            "DELETE FROM series_analysis_worker_capabilities WHERE worker_id LIKE $1",
            &[&format!("{OLD_WORKER_ID}@%")],
        )
        .await?;
    Ok(())
}
