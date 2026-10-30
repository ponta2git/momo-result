//! Finalization deadlines cover durable transitions and publication recovery alike.

use std::{sync::Arc, time::Instant};

use tokio::{io::AsyncReadExt, net::TcpListener, sync::Notify, time};

use super::{
    AttemptMetrics, Client, Duration, JOB_ID, OLD_ATTEMPT_ID, OLD_FENCE, SmokeResult, TempDir,
    build_manifest, claim, cleanup_database, notifications, prepare_owned_attempt,
};
use crate::{
    notifications::NotificationSink,
    postgres::test_support::{CommitFault, DelayedDatabase, accept_startup},
    series_analysis::{
        AttemptResult, ConsumerError, attempt::finish_attempt_result,
        child_process::AnalysisChildOutcome,
    },
};

pub(super) async fn verify(database_url: &str, observer: &Client) -> SmokeResult {
    verify_unacknowledged_transitions(database_url, observer).await?;
    for stalled in [false, true] {
        cleanup_database(observer).await?;
        prepare_owned_attempt(observer).await?;
        verify_publication_recovery(database_url, observer, stalled).await?;
    }
    cleanup_database(observer).await
}

async fn verify_unacknowledged_transitions(database_url: &str, observer: &Client) -> SmokeResult {
    for (outcome, status, retries) in [
        (AnalysisChildOutcome::CalculationFailed, "failed", 0),
        (AnalysisChildOutcome::DependencyFailed, "queued", 1),
    ] {
        cleanup_database(observer).await?;
        prepare_owned_attempt(observer).await?;
        let directory = TempDir::new()?;
        let mut config =
            notifications::config(database_url, NotificationSink::default(), directory.path())?;
        config.execution_limits.finalization_timeout = Duration::from_secs(2);
        let claimed = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
        let committed = Arc::new(Notify::new());
        let proxy = DelayedDatabase::commit_fault(
            database_url,
            CommitFault::HoldReply {
                committed: Arc::clone(&committed),
                release: Arc::new(Notify::new()),
            },
        )
        .await?;
        let mut uncertain = crate::identity::fixtures::connect(&proxy.url).await?;
        let transition = finish_attempt_result(
            &mut uncertain,
            &config,
            &claimed,
            directory.path(),
            Instant::now(),
            Ok((outcome, AttemptMetrics::default())),
        );
        let (result, ()) = time::timeout(
            config.execution_limits.finalization_timeout + Duration::from_secs(2),
            async { tokio::join!(transition, committed.notified()) },
        )
        .await
        .map_err(|_elapsed| {
            format!("unacknowledged {status} finalization exceeded test watchdog")
        })?;
        drop(config);
        assert!(matches!(result, Err(ConsumerError::ControlTimeout)));
        drop(uncertain);
        let row = observer
            .query_one(
                "SELECT status, lease_owner IS NULL, transient_retry_count \
                 FROM series_analysis_jobs WHERE legacy_id = $1",
                &[&JOB_ID],
            )
            .await?;
        assert_eq!(row.try_get::<_, String>(0)?, status);
        assert!(row.try_get::<_, bool>(1)?);
        assert_eq!(row.try_get::<_, i32>(2)?, retries);
    }
    Ok(())
}

async fn verify_publication_recovery(
    database_url: &str,
    observer: &Client,
    stalled: bool,
) -> SmokeResult {
    let directory = TempDir::new()?;
    let artifact_directory = TempDir::new()?;
    let mut config =
        notifications::config(database_url, NotificationSink::default(), directory.path())?;
    config.execution_limits.finalization_timeout = Duration::from_secs(2);
    let claimed = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    let artifact = build_manifest(&claimed, artifact_directory.path())?;
    let metrics = AttemptMetrics {
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
    let mut control = crate::identity::fixtures::connect(database_url).await?;
    let pid: i32 = control
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get(0)?;
    observer
        .query_one("SELECT pg_terminate_backend($1)", &[&pid])
        .await?;
    assert!(control.batch_execute("SELECT 1").await.is_err());

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    if stalled {
        let mut url = url::Url::parse(database_url)?;
        url.set_host(Some("127.0.0.1"))?;
        url.set_port(Some(listener.local_addr()?.port()))
            .map_err(|()| "test port")?;
        url.query_pairs_mut().append_pair("sslmode", "disable");
        config.database_url = url.to_string();
    }
    // Staging uses the closed control connection before recovery opens config.database_url.
    let transition = finish_attempt_result(
        &mut control,
        &config,
        &claimed,
        artifact_directory.path(),
        Instant::now(),
        Ok((AnalysisChildOutcome::Succeeded, metrics)),
    );
    let watchdog = config.execution_limits.finalization_timeout + Duration::from_secs(2);
    if stalled {
        let peer = async {
            let mut socket = accept_startup(&listener).await?;
            // Acknowledge transport reads but never answer the identity query.
            let tag = socket.read_u8().await?;
            assert!(
                matches!(tag, b'P' | b'Q'),
                "recovery must send a query before closing its socket"
            );
            tokio::io::copy(&mut socket, &mut tokio::io::sink()).await?;
            Ok::<(), std::io::Error>(())
        };
        let (result, closed) = time::timeout(watchdog, async { tokio::join!(transition, peer) })
            .await
            .map_err(
                |_elapsed| "stalled publication recovery did not finish and close its socket",
            )?;
        assert!(matches!(result, Err(ConsumerError::ControlTimeout)));
        closed?;
    } else {
        let result = time::timeout(watchdog, transition)
            .await
            .map_err(|_elapsed| "publication recovery exceeded test watchdog")??;
        assert!(matches!(result.value, AttemptResult::Completed));
        control.query_one("SELECT 1", &[]).await?;
    }
    drop(config);
    let row = observer
        .query_one(
            "SELECT status, lease_owner IS NULL FROM series_analysis_jobs WHERE legacy_id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(
        row.try_get::<_, String>(0)?,
        if stalled { "running" } else { "failed" }
    );
    assert_eq!(row.try_get::<_, bool>(1)?, !stalled);
    Ok(())
}
