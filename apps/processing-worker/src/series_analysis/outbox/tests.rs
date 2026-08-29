use std::error::Error;

use momo_analysis_core::contract::ARTIFACT_VALIDATION_CONTRACT_ID;
use redis::{AsyncCommands, aio::ConnectionManager, streams::StreamRangeReply};

use super::*;

type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

const TITLE_ID: &str = "analysis-outbox-smoke-title";
const JOB_ID: &str = "analysis-outbox-smoke-job";
const OUTBOX_ID: &str = "analysis-outbox-smoke-delivery";
const HISTORICAL_OUTBOX_ID: &str = "analysis-outbox-smoke-historical-delivery";
const STREAM: &str = "analysis-outbox-smoke-stream";
const CAMPAIGN_ID: &str = "analysis-campaign-smoke";
const CAMPAIGN_OPERATION_ID: &str = "analysis-campaign-smoke-operation";

#[test]
fn queue_payload_and_retry_backoff_match_the_delivery_contract() {
    assert_eq!(
        queue_fields("analysis-job-1"),
        [
            ("schemaVersion", String::from("1")),
            ("jobId", String::from("analysis-job-1")),
        ]
    );
    assert_eq!(
        (0..=2)
            .map(delivery_retry_delay)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string()),
        Ok(vec![
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
        ])
    );
}

#[test]
fn campaign_ids_match_the_cross_runtime_sha256_contract() {
    let target = campaign_target(SystemTime::UNIX_EPOCH);

    assert_eq!(
        campaign_stable_id("analysis-request", &target),
        "analysis-request-356b33cedb6a6d732ae4f53968121356"
    );
    assert_eq!(
        campaign_stable_id("analysis-job", &target),
        "analysis-job-9321a6c13f14001a5bd49b2d9b381e03"
    );
    assert_eq!(
        campaign_stable_id("analysis-outbox", &target),
        "analysis-outbox-2d34c0435c4c3eb2a420b50cfe80773c"
    );
}

#[test]
fn campaign_assignment_decision_preserves_the_acceptance_race_boundary() {
    let accepted_at = SystemTime::UNIX_EPOCH + Duration::from_secs(100);
    let target = campaign_target(accepted_at);
    let queued = active_job("queued", None, None);
    let running_before = active_job(
        "running",
        Some(accepted_at - Duration::from_secs(1)),
        Some("attempt-before"),
    );
    let running_at_acceptance =
        active_job("running", Some(accepted_at), Some("attempt-at-acceptance"));
    let running_after = active_job(
        "running",
        Some(accepted_at + Duration::from_secs(1)),
        Some("attempt-after"),
    );
    let running_without_attempt = active_job("running", Some(accepted_at), None);

    assert_eq!(
        campaign_assignment_decision(None, &target).ok(),
        Some(CampaignAssignmentDecision::Create)
    );
    assert_eq!(
        campaign_assignment_decision(Some(&queued), &target).ok(),
        Some(CampaignAssignmentDecision::RefreshQueued {
            job_id: "active-job"
        })
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_before), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_at_acceptance), &target).ok(),
        Some(CampaignAssignmentDecision::JoinRunning {
            job_id: "active-job",
            attempt_id: "attempt-at-acceptance"
        })
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_after), &target).ok(),
        Some(CampaignAssignmentDecision::JoinRunning {
            job_id: "active-job",
            attempt_id: "attempt-after"
        })
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_without_attempt), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
}

#[test]
fn campaign_never_joins_a_running_attempt_under_a_different_version_contract() {
    let accepted_at = SystemTime::UNIX_EPOCH + Duration::from_secs(100);
    let target = campaign_target(accepted_at);
    let mut running = active_job("running", Some(accepted_at), Some("attempt-1"));

    running.validation_contract_id = Some(String::from("different-validation-contract"));
    assert_eq!(
        campaign_assignment_decision(Some(&running), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
    running.validation_contract_id = target.validation_contract_id.clone();
    running.algorithm_version = String::from("different-algorithm");
    assert_eq!(
        campaign_assignment_decision(Some(&running), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
    running
        .algorithm_version
        .clone_from(&target.algorithm_version);
    running.artifact_schema_version = target.artifact_schema_version + 1;
    assert_eq!(
        campaign_assignment_decision(Some(&running), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
}

#[test]
fn only_release_campaigns_require_one_uniform_version_tuple() {
    assert_eq!(
        campaign_requires_uniform_version("manual").ok(),
        Some(false)
    );
    for trigger in [
        "algorithm_update",
        "artifact_schema_update",
        "validation_contract_update",
        "initial_backfill",
    ] {
        assert_eq!(campaign_requires_uniform_version(trigger).ok(), Some(true));
    }
    assert!(campaign_requires_uniform_version("unknown-trigger").is_err());
}

fn campaign_target(accepted_at: SystemTime) -> CampaignTarget {
    CampaignTarget {
        campaign_id: String::from("campaign-1"),
        game_title_id: String::from("title-1"),
        input_revision: 3,
        algorithm_version: String::from("series-analysis-v1"),
        artifact_schema_version: 1,
        validation_contract_id: None,
        accepted_at,
        operation_id: String::from("operation-1"),
        trigger: String::from("manual"),
    }
}

fn active_job(
    status: &str,
    started_at: Option<SystemTime>,
    attempt_id: Option<&str>,
) -> ActiveAnalysisJob {
    ActiveAnalysisJob {
        id: String::from("active-job"),
        status: String::from(status),
        algorithm_version: String::from("series-analysis-v1"),
        artifact_schema_version: 1,
        validation_contract_id: None,
        started_at,
        attempt_id: attempt_id.map(String::from),
    }
}

#[test]
fn configuration_rejects_unbounded_or_immediate_work() {
    assert!(matches!(
        SeriesAnalysisOutboxConfig::new(String::new(), 0, Duration::ZERO, Duration::ZERO,),
        Err(SeriesAnalysisOutboxError::InvalidConfiguration)
    ));
    assert!(
        SeriesAnalysisOutboxConfig::new(
            String::from("analysis-stream"),
            10,
            Duration::from_secs(30),
            Duration::from_mins(5),
        )
        .is_ok()
    );
    assert!(SeriesAnalysisOutboxConfig::for_runtime(String::from("analysis-stream")).is_ok());
    assert!(matches!(
        SeriesAnalysisOutboxConfig::new(
            String::from("analysis-stream"),
            10,
            Duration::MAX,
            Duration::from_mins(5),
        ),
        Err(SeriesAnalysisOutboxError::DurationBound(_))
    ));
}

#[test]
fn no_progress_due_work_uses_a_bounded_lock_contention_retry() {
    assert_eq!(
        bounded_idle_delay(Duration::ZERO),
        LOCK_CONTENTION_RETRY_DELAY
    );
    assert_eq!(
        bounded_idle_delay(Duration::from_secs(9)),
        Duration::from_secs(9)
    );
    assert_eq!(None.map(bounded_idle_delay), None);
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_OUTBOX_SMOKE_DATABASE_URL and ANALYSIS_OUTBOX_SMOKE_REDIS_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "the isolated database and Redis scenario keeps durable boundaries visible"
)]
async fn real_postgres_and_redis_preserve_claim_and_payload_contract() -> SmokeResult {
    let database_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_DATABASE_URL")?;
    let redis_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_REDIS_URL")?;
    let database = crate::postgres::connect(&database_url).await?;
    let redis_client = redis::Client::open(redis_url)?;
    let mut observer = redis_client.get_connection_manager().await?;
    let _: usize = observer.del(STREAM).await?;
    prepare_outbox(&database).await?;

    let config = SeriesAnalysisOutboxConfig::new(
        String::from(STREAM),
        10,
        Duration::from_secs(30),
        Duration::from_mins(5),
    )?;
    let redis = redis_client.get_connection_manager().await?;
    let mut driver = SeriesAnalysisOutboxDriver::new(database, redis, config);

    assert_campaign_expansion_decision_table(&mut driver, &database_url).await?;
    assert_publish_retry_follows_job_availability(&mut driver, &mut observer).await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let state = driver
        .database
        .query_one(
            "SELECT status, redis_message_id FROM series_analysis_queue_outbox WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    let status: String = state.try_get("status")?;
    let message_id: Option<String> = state.try_get("redis_message_id")?;
    assert_eq!(status, "delivered");

    let entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
    let entry = entries.ids.first().ok_or("Redis stream entry is missing")?;
    assert_eq!(message_id.as_deref(), Some(entry.id.as_str()));
    assert_eq!(entry.get::<String>("schemaVersion").as_deref(), Some("1"));
    assert_eq!(entry.get::<String>("jobId").as_deref(), Some(JOB_ID));

    let idle = driver.drain_once().await?;
    assert_ne!(idle, DrainBatch::progress());
    assert_ne!(idle, DrainBatch::idle(None));

    driver
        .database
        .execute(
            "UPDATE series_analysis_queue_outbox SET delivered_at = now() - interval '6 minutes' WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let entries_after_redelivery: StreamRangeReply = observer.xrange_all(STREAM).await?;
    assert_eq!(entries_after_redelivery.ids.len(), 2);

    assert_future_job_defers_stale_deliveries(&mut driver, &mut observer).await?;
    assert_terminal_retry_uses_shared_mutation_lock_order(&mut driver, &database_url).await?;
    assert_recent_delivery_preserves_queued_job(&mut driver).await?;
    assert_locked_due_delivery_uses_bounded_retry(&mut driver, &database_url).await?;
    assert_postgres_failure_classification(&driver, &database_url).await?;

    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
        .await?;
    Ok(())
}

async fn assert_postgres_failure_classification(
    driver: &SeriesAnalysisOutboxDriver,
    database_url: &str,
) -> SmokeResult {
    let dependency_database = crate::postgres::connect(database_url).await?;
    dependency_database
        .batch_execute("SET statement_timeout = '1ms'")
        .await?;
    let attempted = dependency_database
        .query_one("SELECT pg_sleep(1)", &[])
        .await;
    let Err(dependency_failure) = attempted else {
        return Err("bounded PostgreSQL statement unexpectedly completed".into());
    };
    assert!(
        !dependency_failure.is_closed(),
        "statement timeout must preserve the dependency connection"
    );
    assert_eq!(
        SeriesAnalysisOutboxDriver::failure_kind(&SeriesAnalysisOutboxError::Postgres(
            dependency_failure,
        )),
        DriverFailureKind::Recoverable,
        "a live dependency failure retains bounded dependency backoff"
    );
    dependency_database
        .batch_execute("SET statement_timeout = 0")
        .await?;

    let backend_pid = dependency_database
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get::<_, i32>(0)?;
    let terminated = driver
        .database
        .query_one("SELECT pg_terminate_backend($1)", &[&backend_pid])
        .await?
        .try_get::<_, bool>(0)?;
    assert!(terminated, "isolated PostgreSQL peer was not terminated");
    tokio::time::timeout(Duration::from_secs(2), async {
        while !dependency_database.is_closed() {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    let closed_attempt = dependency_database.query_one("SELECT 1", &[]).await;
    let Err(error) = closed_attempt else {
        return Err("closed PostgreSQL client unexpectedly accepted a query".into());
    };
    assert!(error.is_closed());
    assert_eq!(
        SeriesAnalysisOutboxDriver::failure_kind(&SeriesAnalysisOutboxError::Postgres(error)),
        DriverFailureKind::Structural
    );
    Ok(())
}

#[expect(
    clippy::too_many_lines,
    reason = "one isolated integration scenario keeps the campaign decision table and projections visible"
)]
async fn assert_campaign_expansion_decision_table(
    driver: &mut SeriesAnalysisOutboxDriver,
    database_url: &str,
) -> SmokeResult {
    cleanup_campaign_expansion_fixture(&driver.database).await?;
    driver
        .database
        .batch_execute(
            r"
            INSERT INTO game_titles (id, name, layout_family, display_order) VALUES
              ('analysis-campaign-smoke-new', 'campaign new', 'momotetsu2', 9901),
              ('analysis-campaign-smoke-queued', 'campaign queued', 'momotetsu2', 9902),
              ('analysis-campaign-smoke-before', 'campaign before', 'momotetsu2', 9903),
              ('analysis-campaign-smoke-after', 'campaign after', 'momotetsu2', 9904),
              ('analysis-campaign-smoke-deleted', 'campaign deleted', 'momotetsu2', 9905);

            UPDATE series_analysis_title_states
            SET algorithm_version = 'series-analysis-v3',
                artifact_schema_version = 2,
                validation_contract_id = 'series-analysis-artifact-v2-full-validation-v1'
            WHERE game_title_id LIKE 'analysis-campaign-smoke-%';

            UPDATE series_analysis_title_states
            SET input_revision = 9,
                algorithm_version = 'series-analysis-v2',
                artifact_schema_version = 2
            WHERE game_title_id = 'analysis-campaign-smoke-queued';

            INSERT INTO series_analysis_operation_requests (
              id, scope, game_title_id, requested_by_account_id, idempotency_key_hash,
              endpoint, status, target_count, accepted_at
            ) VALUES (
              'analysis-campaign-smoke-operation', 'all_titles', NULL, NULL,
              'analysis-campaign-smoke-idempotency', '/series-analysis/recalculate-all',
              'pending', 5, clock_timestamp() - interval '1 minute'
            );
            INSERT INTO series_analysis_campaigns (
              id, operation_request_id, trigger, algorithm_version,
              artifact_schema_version, validation_contract_id, status, target_count, accepted_at
            )
            SELECT
              'analysis-campaign-smoke', id, 'manual', 'mixed', 2, NULL,
              'expanding', 5, accepted_at
            FROM series_analysis_operation_requests
            WHERE id = 'analysis-campaign-smoke-operation';
            INSERT INTO series_analysis_campaign_targets (
              campaign_id, game_title_id, input_revision, algorithm_version,
              artifact_schema_version, validation_contract_id, accepted_at
            )
            SELECT c.id, s.game_title_id, s.input_revision, s.algorithm_version,
                   s.artifact_schema_version, s.validation_contract_id, c.accepted_at
            FROM series_analysis_campaigns c
            CROSS JOIN series_analysis_title_states s
            WHERE c.id = 'analysis-campaign-smoke'
              AND s.game_title_id LIKE 'analysis-campaign-smoke-%';

            INSERT INTO series_analysis_jobs (
              id, game_title_id, input_revision, algorithm_version,
              artifact_schema_version, validation_contract_id, status, trigger,
              requested_at, available_at
            )
            SELECT
              'analysis-campaign-smoke-queued-job', 'analysis-campaign-smoke-queued',
              0, 'stale-version', 1, NULL, 'queued', 'match_mutation', accepted_at, accepted_at
            FROM series_analysis_campaigns WHERE id = 'analysis-campaign-smoke';
            INSERT INTO series_analysis_jobs (
              id, game_title_id, input_revision, algorithm_version,
              artifact_schema_version, validation_contract_id, status, trigger,
              requested_at, available_at,
              started_at, lease_owner, lease_attempt_id, lease_fencing_token, lease_expires_at,
              lease_validation_contract_id
            )
            SELECT
              'analysis-campaign-smoke-before-job', 'analysis-campaign-smoke-before',
              0, 'series-analysis-v3', 2,
              'series-analysis-artifact-v2-full-validation-v1', 'running', 'match_mutation',
              accepted_at - interval '1 second', accepted_at - interval '1 second',
              accepted_at - interval '1 second', 'worker-before', 'attempt-before', 1,
              clock_timestamp() + interval '10 minutes',
              'series-analysis-artifact-v2-full-validation-v1'
            FROM series_analysis_campaigns WHERE id = 'analysis-campaign-smoke'
            UNION ALL
            SELECT
              'analysis-campaign-smoke-after-job', 'analysis-campaign-smoke-after',
              0, 'series-analysis-v3', 2,
              'series-analysis-artifact-v2-full-validation-v1', 'running', 'match_mutation',
              accepted_at + interval '1 second', accepted_at + interval '1 second',
              accepted_at + interval '1 second', 'worker-after', 'attempt-after', 1,
              clock_timestamp() + interval '10 minutes',
              'series-analysis-artifact-v2-full-validation-v1'
            FROM series_analysis_campaigns WHERE id = 'analysis-campaign-smoke';

            DELETE FROM game_titles WHERE id = 'analysis-campaign-smoke-deleted';
            ",
        )
        .await?;

    let peer_database = crate::postgres::connect(database_url).await?;
    let mut peer =
        SeriesAnalysisOutboxDriver::new(peer_database, driver.redis.clone(), driver.config.clone());
    let (first, second) = tokio::join!(
        driver.expand_pending_campaign_targets(),
        peer.expand_pending_campaign_targets(),
    );
    assert_eq!(first? + second?, 5);
    assert_eq!(driver.expand_pending_campaign_targets().await?, 0);
    let rows = driver
        .database
        .query(
            r"
            SELECT t.game_title_id, t.status AS target_status,
                   r.status AS request_status, r.assigned_job_id, r.assigned_attempt_id
            FROM series_analysis_campaign_targets t
            LEFT JOIN series_analysis_job_requests r ON r.id = t.job_request_id
            WHERE t.campaign_id = $1
            ORDER BY t.game_title_id
            ",
            &[&CAMPAIGN_ID],
        )
        .await?
        .into_iter()
        .map(|row| {
            Ok::<_, tokio_postgres::Error>((
                row.try_get::<_, String>("game_title_id")?,
                row.try_get::<_, String>("target_status")?,
                row.try_get::<_, Option<String>>("request_status")?,
                row.try_get::<_, Option<String>>("assigned_job_id")?,
                row.try_get::<_, Option<String>>("assigned_attempt_id")?,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(
        rows,
        vec![
            (
                String::from("analysis-campaign-smoke-after"),
                String::from("running"),
                Some(String::from("assigned")),
                Some(String::from("analysis-campaign-smoke-after-job")),
                Some(String::from("attempt-after")),
            ),
            (
                String::from("analysis-campaign-smoke-before"),
                String::from("expanded"),
                Some(String::from("pending")),
                None,
                None,
            ),
            (
                String::from("analysis-campaign-smoke-deleted"),
                String::from("skipped_title_deleted"),
                None,
                None,
                None,
            ),
            (
                String::from("analysis-campaign-smoke-new"),
                String::from("expanded"),
                Some(String::from("pending")),
                Some(campaign_stable_id(
                    "analysis-job",
                    &campaign_target_for("analysis-campaign-smoke-new"),
                )),
                None,
            ),
            (
                String::from("analysis-campaign-smoke-queued"),
                String::from("expanded"),
                Some(String::from("pending")),
                Some(String::from("analysis-campaign-smoke-queued-job")),
                None,
            ),
        ]
    );
    let projection = driver
        .database
        .query_one(
            r"
            SELECT c.expanded_count, c.terminal_count, c.skipped_count, c.status,
                   o.status AS operation_status,
                   (SELECT pending_forced_run_count FROM series_analysis_title_states
                    WHERE game_title_id = 'analysis-campaign-smoke-before') AS forced_runs,
                   (SELECT input_revision FROM series_analysis_jobs
                    WHERE id = 'analysis-campaign-smoke-queued-job') AS queued_revision,
                   (SELECT validation_contract_id FROM series_analysis_jobs
                    WHERE id = 'analysis-campaign-smoke-queued-job') AS queued_validation_contract,
                   (SELECT BOOL_AND(
                      r.id IS NULL
                      OR r.validation_contract_id IS NOT DISTINCT FROM t.validation_contract_id
                    )
                    FROM series_analysis_campaign_targets t
                    LEFT JOIN series_analysis_job_requests r ON r.id = t.job_request_id
                    WHERE t.campaign_id = c.id) AS request_tuple_propagated,
                   (SELECT COUNT(*)::bigint FROM series_analysis_queue_outbox q
                    JOIN series_analysis_jobs j ON j.id = q.job_id
                    WHERE j.game_title_id LIKE 'analysis-campaign-smoke-%') AS outbox_count
            FROM series_analysis_campaigns c
            JOIN series_analysis_operation_requests o ON o.id = c.operation_request_id
            WHERE c.id = $1
            ",
            &[&CAMPAIGN_ID],
        )
        .await?;
    assert_eq!(projection.try_get::<_, i32>("expanded_count")?, 5);
    assert_eq!(projection.try_get::<_, i32>("terminal_count")?, 1);
    assert_eq!(projection.try_get::<_, i32>("skipped_count")?, 1);
    assert_eq!(projection.try_get::<_, String>("status")?, "running");
    assert_eq!(
        projection.try_get::<_, String>("operation_status")?,
        "running"
    );
    assert_eq!(projection.try_get::<_, i32>("forced_runs")?, 1);
    assert_eq!(projection.try_get::<_, i64>("queued_revision")?, 9);
    assert_eq!(
        projection
            .try_get::<_, Option<String>>("queued_validation_contract")?
            .as_deref(),
        Some(ARTIFACT_VALIDATION_CONTRACT_ID)
    );
    assert!(projection.try_get::<_, bool>("request_tuple_propagated")?);
    assert_eq!(projection.try_get::<_, i64>("outbox_count")?, 2);

    cleanup_campaign_expansion_fixture(&driver.database).await?;
    Ok(())
}

fn campaign_target_for(game_title_id: &str) -> CampaignTarget {
    CampaignTarget {
        campaign_id: String::from(CAMPAIGN_ID),
        game_title_id: String::from(game_title_id),
        input_revision: 0,
        algorithm_version: String::from("series-analysis-v3"),
        artifact_schema_version: 2,
        validation_contract_id: Some(String::from(ARTIFACT_VALIDATION_CONTRACT_ID)),
        accepted_at: SystemTime::UNIX_EPOCH,
        operation_id: String::from(CAMPAIGN_OPERATION_ID),
        trigger: String::from("manual"),
    }
}

async fn cleanup_campaign_expansion_fixture(database: &Client) -> SmokeResult {
    database
        .execute(
            "DELETE FROM series_analysis_operation_requests WHERE id = $1",
            &[&CAMPAIGN_OPERATION_ID],
        )
        .await?;
    database
        .execute(
            "DELETE FROM game_titles WHERE id = ANY($1)",
            &[&vec![
                "analysis-campaign-smoke-new",
                "analysis-campaign-smoke-queued",
                "analysis-campaign-smoke-before",
                "analysis-campaign-smoke-after",
                "analysis-campaign-smoke-deleted",
            ]],
        )
        .await?;
    Ok(())
}

async fn assert_locked_due_delivery_uses_bounded_retry(
    driver: &mut SeriesAnalysisOutboxDriver,
    database_url: &str,
) -> SmokeResult {
    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET status = 'queued', available_at = clock_timestamp(),\
             lease_owner = NULL, lease_attempt_id = NULL, lease_fencing_token = NULL,\
             lease_expires_at = NULL, lease_validation_contract_id = NULL WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "INSERT INTO series_analysis_queue_outbox\
             (id, job_id, dedupe_key, status, next_attempt_at)\
             VALUES ($1, $2, $1, 'pending', clock_timestamp())",
            &[&OUTBOX_ID, &JOB_ID],
        )
        .await?;
    let mut lock_database = crate::postgres::connect(database_url).await?;
    let lock = lock_database.transaction().await?;
    lock.query_one(
        "SELECT id FROM series_analysis_queue_outbox WHERE id = $1 FOR UPDATE",
        &[&OUTBOX_ID],
    )
    .await?;

    let before = Instant::now();
    let batch = tokio::time::timeout(Duration::from_secs(1), driver.drain_once()).await??;
    let deadline = batch
        .idle_deadline()
        .ok_or("locked due delivery did not yield a bounded idle deadline")?;
    assert!(
        deadline >= before + LOCK_CONTENTION_RETRY_DELAY,
        "locked due delivery retried before the contention floor"
    );
    lock.rollback().await?;
    Ok(())
}

async fn assert_terminal_retry_uses_shared_mutation_lock_order(
    driver: &mut SeriesAnalysisOutboxDriver,
    database_url: &str,
) -> SmokeResult {
    let claim = prepare_terminal_retry_claim(driver, Duration::from_mins(6)).await?;
    let mut lifecycle_database = crate::postgres::connect(database_url).await?;
    let lifecycle = lifecycle_database.transaction().await?;
    let lifecycle_pid = lifecycle
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get::<_, i32>(0)?;
    lifecycle
        .query_one(
            "SELECT slot_key FROM worker_execution_slots\x20\
             WHERE slot_key = 'shared-heavy-work' FOR UPDATE",
            &[],
        )
        .await?;

    let retry_database = crate::postgres::connect(database_url).await?;
    let retry_pid = retry_database
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get::<_, i32>(0)?;
    let mut retry_driver = SeriesAnalysisOutboxDriver::new(
        retry_database,
        driver.redis.clone(),
        driver.config.clone(),
    );
    let retry = tokio::spawn(async move {
        retry_driver
            .release_for_retry(&claim, Duration::from_secs(2))
            .await
    });

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let blocked_by_lifecycle = lifecycle
                .query_one(
                    "SELECT $1::int = ANY(pg_blocking_pids($2::int))",
                    &[&lifecycle_pid, &retry_pid],
                )
                .await?
                .try_get::<_, bool>(0)?;
            if blocked_by_lifecycle {
                return Ok::<(), tokio_postgres::Error>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;

    // The terminal retry must wait at the standard slot prefix. Its lifecycle peer can therefore
    // continue through title -> job -> outbox without a reverse-order lock or deadlock.
    lifecycle
        .query_one(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE NOWAIT",
            &[&TITLE_ID],
        )
        .await?;
    lifecycle
        .query_one(
            "SELECT id FROM series_analysis_jobs WHERE id = $1 FOR UPDATE NOWAIT",
            &[&JOB_ID],
        )
        .await?;
    lifecycle
        .query_one(
            "SELECT id FROM series_analysis_queue_outbox WHERE id = $1 FOR UPDATE NOWAIT",
            &[&OUTBOX_ID],
        )
        .await?;
    lifecycle.commit().await?;
    assert!(tokio::time::timeout(Duration::from_secs(2), retry).await???);

    let state = driver
        .database
        .query_one(
            "SELECT j.status AS job_status, q.status AS outbox_status,\x20\
                    historical.status AS historical_status\x20\
             FROM series_analysis_jobs j\x20\
             JOIN series_analysis_queue_outbox q ON q.job_id = j.id\x20\
             JOIN series_analysis_queue_outbox historical ON historical.job_id = j.id\x20\
             WHERE j.id = $1 AND q.id = $2 AND historical.id = $3",
            &[&JOB_ID, &OUTBOX_ID, &HISTORICAL_OUTBOX_ID],
        )
        .await?;
    assert_eq!(state.try_get::<_, String>("job_status")?, "failed");
    assert_eq!(state.try_get::<_, String>("outbox_status")?, "failed");
    assert_eq!(
        state.try_get::<_, String>("historical_status")?,
        "delivered"
    );
    assert_eq!(driver.reconcile_queued().await?, 0);
    Ok(())
}

async fn assert_recent_delivery_preserves_queued_job(
    driver: &mut SeriesAnalysisOutboxDriver,
) -> SmokeResult {
    let claim = prepare_terminal_retry_claim(driver, Duration::ZERO).await?;
    assert!(
        driver
            .release_for_retry(&claim, Duration::from_secs(2))
            .await?
    );
    let state = driver
        .database
        .query_one(
            "SELECT j.status AS job_status, q.status AS outbox_status\x20\
             FROM series_analysis_jobs j\x20\
             JOIN series_analysis_queue_outbox q ON q.job_id = j.id\x20\
             WHERE j.id = $1 AND q.id = $2",
            &[&JOB_ID, &OUTBOX_ID],
        )
        .await?;
    assert_eq!(state.try_get::<_, String>("job_status")?, "queued");
    assert_eq!(state.try_get::<_, String>("outbox_status")?, "failed");
    assert_eq!(driver.reconcile_queued().await?, 0);
    Ok(())
}

async fn prepare_terminal_retry_claim(
    driver: &mut SeriesAnalysisOutboxDriver,
    delivered_age: Duration,
) -> SmokeResult<OutboxClaim> {
    let delivered_age_milliseconds = postgres_duration_milliseconds(delivered_age)?;
    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET status = 'queued', available_at = clock_timestamp(),\x20\
               finished_at = NULL, safe_failure_code = NULL WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            r"
            INSERT INTO series_analysis_queue_outbox (
              id, job_id, dedupe_key, status, attempt_count, next_attempt_at,
              delivered_at, redis_message_id
            ) VALUES
              (
                $1, $2, $3, 'pending', 2,
                clock_timestamp() - interval '1 second', NULL, NULL
              ),
              (
                $4, $2, $5, 'delivered', 0,
                clock_timestamp() - ($6::bigint * interval '1 millisecond'),
                clock_timestamp() - ($6::bigint * interval '1 millisecond'),
                'historical-redis-message'
              )
            ",
            &[
                &OUTBOX_ID,
                &JOB_ID,
                &"analysis-outbox-lock-order",
                &HISTORICAL_OUTBOX_ID,
                &"analysis-outbox-historical-delivery",
                &delivered_age_milliseconds,
            ],
        )
        .await?;
    driver
        .claim_due()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "lock-order outbox delivery was not claimed".into())
}

async fn assert_publish_retry_follows_job_availability(
    driver: &mut SeriesAnalysisOutboxDriver,
    observer: &mut ConnectionManager,
) -> SmokeResult {
    let _: () = observer.set(STREAM, "force-wrong-type").await?;
    let claims = driver.claim_due().await?;
    assert_eq!(claims.len(), 1);
    let claim = claims
        .first()
        .ok_or("due Analysis outbox delivery was not claimed")?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               available_at = clock_timestamp() + interval '1 hour' WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(driver.publish_claim(claim).await?, PublishResult::Retried);
    let retry_state = driver
        .database
        .query_one(
            "SELECT q.status, q.attempt_count,\x20\
               q.next_attempt_at > q.last_attempt_at AS delayed,\x20\
               q.next_attempt_at = j.available_at AS follows_job_availability\x20\
             FROM series_analysis_queue_outbox q\x20\
             JOIN series_analysis_jobs j ON j.id = q.job_id WHERE q.id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    assert_eq!(retry_state.try_get::<_, String>("status")?, "pending");
    assert_eq!(retry_state.try_get::<_, i32>("attempt_count")?, 1);
    assert!(retry_state.try_get::<_, bool>("delayed")?);
    assert!(retry_state.try_get::<_, bool>("follows_job_availability")?);

    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_queue_outbox\x20\
             SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = $1",
            &[&OUTBOX_ID],
        )
        .await?;
    Ok(())
}

async fn assert_future_job_defers_stale_deliveries(
    driver: &mut SeriesAnalysisOutboxDriver,
    observer: &mut ConnectionManager,
) -> SmokeResult {
    let _: usize = observer.del(STREAM).await?;
    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET\x20\
               available_at = clock_timestamp() + interval '1 hour' WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            r"
            INSERT INTO series_analysis_queue_outbox (
              id, job_id, dedupe_key, status, next_attempt_at,
              last_attempt_at, claim_expires_at
            ) VALUES
              (
                'analysis-outbox-smoke-stale-pending', $1,
                'analysis-outbox-smoke-stale-pending', 'pending',
                clock_timestamp() - interval '1 minute', NULL, NULL
              ),
              (
                'analysis-outbox-smoke-stale-in-flight', $1,
                'analysis-outbox-smoke-stale-in-flight', 'in_flight',
                clock_timestamp() - interval '2 minutes',
                clock_timestamp() - interval '2 minutes',
                clock_timestamp() - interval '1 minute'
              )
            ",
            &[&JOB_ID],
        )
        .await?;
    let future_delay = driver
        .next_delay()
        .await?
        .ok_or("future Analysis job has no durable wake deadline")?;
    assert!(future_delay > Duration::from_mins(50));
    let future_idle = driver.drain_once().await?;
    assert_ne!(future_idle, DrainBatch::progress());
    assert_ne!(future_idle, DrainBatch::idle(None));
    let future_entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
    assert!(future_entries.ids.is_empty());
    let future_outbox_count = driver
        .database
        .query_one(
            "SELECT COUNT(*)::bigint FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?
        .try_get::<_, i64>(0)?;
    assert_eq!(future_outbox_count, 2);

    driver
        .database
        .execute(
            "DELETE FROM series_analysis_queue_outbox WHERE job_id = $1",
            &[&JOB_ID],
        )
        .await?;
    driver
        .database
        .execute(
            "UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE id = $1",
            &[&JOB_ID],
        )
        .await?;
    assert_eq!(driver.drain_once().await?, DrainBatch::progress());
    let due_entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
    assert_eq!(due_entries.ids.len(), 1);
    Ok(())
}

async fn prepare_outbox(database: &Client) -> SmokeResult {
    database
        .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
        .await?;
    database
        .execute(
            "INSERT INTO game_titles (id, name, layout_family, display_order) VALUES ($1, $2, $3, $4)",
            &[&TITLE_ID, &"Analysis outbox smoke", &"momotetsu2", &9_999_i32],
        )
        .await?;
    database
        .execute(
            "UPDATE series_analysis_title_states SET algorithm_version = 'series-analysis-v1', \
             artifact_schema_version = 1, validation_contract_id = NULL \
             WHERE game_title_id = $1",
            &[&TITLE_ID],
        )
        .await?;
    database
        .execute(
            r"
            INSERT INTO series_analysis_jobs (
              id, game_title_id, input_revision, algorithm_version,
              artifact_schema_version, status, trigger, requested_at, available_at
            ) VALUES ($1, $2, 1, 'series-analysis-v1', 1, 'queued', 'manual', now(), now())
            ",
            &[&JOB_ID, &TITLE_ID],
        )
        .await?;
    database
        .execute(
            r"
            INSERT INTO series_analysis_queue_outbox (
              id, job_id, dedupe_key, next_attempt_at, created_at, updated_at
            ) VALUES (
              $1, $2, $3, clock_timestamp() - interval '1 second',
              clock_timestamp(), clock_timestamp()
            )
            ",
            &[&OUTBOX_ID, &JOB_ID, &"analysis-outbox-smoke-dedupe"],
        )
        .await?;
    Ok(())
}
