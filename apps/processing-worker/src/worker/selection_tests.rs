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
    let mut client = crate::identity::fixtures::connect(&database_url).await?;
    cleanup(&client).await?;
    let baseline = client.query_one("SELECT (SELECT count(*) FROM series_analysis_jobs WHERE status IN ('queued','running')), (SELECT count(*) FROM ocr_jobs WHERE status IN ('queued','running'))", &[]).await?;
    assert_eq!(baseline.try_get::<_, i64>(0)?, 0);
    assert_eq!(baseline.try_get::<_, i64>(1)?, 0);
    assert_eq!(
        next_due(&client, true, Duration::from_secs(30)).await?,
        Duration::from_secs(30)
    );
    client.execute(r"
        WITH fixture_titles AS (
               INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
               VALUES (pg_temp.fixture_uuid('game_titles', $1), $1, 'Scheduler selection smoke', 'momotetsu_2', 9999)
               RETURNING id
             )
          INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
          SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
          FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
          WHERE release.singleton_key = 'current'
          ON CONFLICT (game_title_id) DO NOTHING
        ", &[&TITLE]).await?;
    insert_jobs(&client).await?;
    assert!(candidates(&client, false, None).await?.is_empty());
    let due = next_due(&client, true, Duration::from_secs(30)).await?;
    assert!(due > Duration::ZERO && due <= Duration::from_secs(20));
    assert_eq!(
        next_due(&client, true, Duration::from_secs(1)).await?,
        Duration::from_secs(1)
    );
    client.execute(r"
        UPDATE series_analysis_jobs
        SET available_at = CAST('2020-01-01' AS timestamptz), requested_at = CAST('2020-01-01' AS timestamptz)
        WHERE series_analysis_jobs.legacy_id LIKE $1
        ", &[&format!("{PREFIX}%")]).await?;
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
            r"
                DELETE FROM series_analysis_jobs
                WHERE series_analysis_jobs.legacy_id LIKE $1
                ",
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
    client.execute(r"
        WITH fixture_titles AS (
               INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
               SELECT pg_temp.fixture_uuid('game_titles', $1 || 'title-' || CAST(n AS text)), $1 || 'title-' || CAST(n AS text),
                      'Scheduler page smoke ' || CAST(n AS text), 'momotetsu_2', 10000 + n
               FROM generate_series(1, 301) AS n
               RETURNING id
             )
          INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
          SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
          FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
          WHERE release.singleton_key = 'current'
          ON CONFLICT (game_title_id) DO NOTHING
        ", &[&PREFIX]).await?;
    client
        .execute(
            r"
        INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                          artifact_schema_version, validation_contract_id, status, trigger, available_at)
        SELECT pg_temp.fixture_uuid('series_analysis_jobs', $1 || CAST(n AS text)), $1 || CAST(n AS text),
               pg_temp.fixture_uuid('game_titles', $1 || 'title-' || CAST(n AS text)), n, $2, $3, $4, 'queued', 'manual',
               clock_timestamp() + CAST('20 seconds' AS interval)
        FROM generate_series(1, 300) AS n
        ",
            &[
                &PREFIX,
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?;
    client.execute(r"
        INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                          artifact_schema_version, validation_contract_id, status, trigger, available_at)
        VALUES (pg_temp.fixture_uuid('series_analysis_jobs', 'scheduler-selection-smoke-unsupported'),
                'scheduler-selection-smoke-unsupported', pg_temp.fixture_uuid('game_titles', $1), 301,
                'unsupported-scheduler-smoke', $2, $3, 'queued', 'manual', clock_timestamp())
        ", &[&format!("{PREFIX}title-301"),&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    Ok(())
}

#[expect(
    clippy::too_many_lines,
    reason = "keep canonical fixture setup and persisted behavior assertions in one scenario"
)]
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
    client
        .execute(
            r"
        INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                          artifact_schema_version, validation_contract_id, status, trigger, started_at, lease_owner, lease_attempt_id,
                                          legacy_lease_attempt_id, lease_fencing_token, lease_expires_at, lease_validation_contract_id, attempt_count,
                                          fencing_counter)
        VALUES (pg_temp.fixture_uuid('series_analysis_jobs', $1), $1, pg_temp.fixture_uuid('game_titles', $2), $3, $4, $5,
                $6, 'running', 'manual', clock_timestamp(), $7, pg_temp.fixture_uuid('series_analysis_job_attempts', $8), $8, $9,
                clock_timestamp() - CAST('1 second' AS interval), $6, 1, $9)
        ",
            &[
                &job,
                &TITLE,
                &revision,
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
                &OWNER,
                &attempt,
                &fence,
            ],
        )
        .await?;
    client
        .execute(
            r"
        INSERT INTO series_analysis_job_attempts (id, legacy_id, job_id, attempt_no, owner, fencing_token, input_revision,
                                                  algorithm_version, artifact_schema_version, validation_contract_id, status, effective_config_version,
                                                  calculation_timeout_milliseconds)
        VALUES (pg_temp.fixture_uuid('series_analysis_job_attempts', $1), $1,
                pg_temp.fixture_uuid('series_analysis_jobs', $2), 1, $3, $4, $5, $6, $7, $8, 'running', 'scheduler-smoke', 60000)
        ",
            &[
                &attempt,
                &job,
                &OWNER,
                &fence,
                &revision,
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?;
    assert!(candidates(client, false, None).await?.is_empty());
    let (sink, mut wake) = PostCommitSink::channel();
    if held {
        let database_url = std::env::var("PROCESSING_SCHEDULER_SMOKE_DATABASE_URL")?;
        let mut blocker = crate::identity::fixtures::connect(&database_url).await?;
        let lock = blocker.transaction().await?;
        lock.query_one(r"
            SELECT (SELECT fixture_parent.legacy_id
                    FROM game_titles AS fixture_parent
                    WHERE fixture_parent.id = series_analysis_title_states.game_title_id) AS game_title_id
            FROM series_analysis_title_states
            WHERE (SELECT fixture_parent.legacy_id
                   FROM game_titles AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
            FOR UPDATE
            ", &[&TITLE]).await?;
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
    let row = client.query_one(r"
        SELECT j.status, j.lease_recovery_count, a.status, a.outcome
        FROM series_analysis_jobs AS j
             INNER JOIN series_analysis_job_attempts AS a ON (SELECT fixture_parent.legacy_id
                                                              FROM series_analysis_jobs AS fixture_parent
                                                              WHERE fixture_parent.id = a.job_id) = j.legacy_id
        WHERE j.legacy_id = $1
        ", &[&job]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, "queued");
    assert_eq!(row.try_get::<_, i32>(1)?, 1);
    assert_eq!(row.try_get::<_, String>(2)?, "terminal");
    assert_eq!(row.try_get::<_, String>(3)?, "owner_lost");
    let counter: i64 = client
        .query_one(
            r"
                SELECT fencing_counter
                FROM series_analysis_jobs
                WHERE series_analysis_jobs.legacy_id = $1
                ",
            &[&job],
        )
        .await?
        .try_get(0)?;
    assert_eq!(
        counter, fence,
        "recovery must preserve the persistent counter"
    );
    client
        .execute(
            r"
                DELETE FROM series_analysis_job_attempts
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_analysis_jobs AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_job_attempts.job_id) = $1
                ",
            &[&job],
        )
        .await?;
    client
        .execute(
            r"
            DELETE FROM series_analysis_jobs
            WHERE series_analysis_jobs.legacy_id = $1
            ",
            &[&job],
        )
        .await?;
    Ok(())
}

async fn verify_supported_intent_is_not_hidden(client: &mut Client) -> TestResult {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    let supported = format!("{PREFIX}zz-supported");
    client.execute(r"
        UPDATE series_analysis_title_states
        SET algorithm_version = 'unsupported-scheduler-smoke', artifact_schema_version = $2, validation_contract_id = $3
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_analysis_title_states.game_title_id) LIKE $1
        ", &[&format!("{PREFIX}%"),&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?;
    client.execute(r"
        WITH fixture_titles AS (
               INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
               VALUES (pg_temp.fixture_uuid('game_titles', $1), $1, 'Scheduler supported intent', 'momotetsu_2', 20000)
               RETURNING id
             )
          INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
          SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
          FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
          WHERE release.singleton_key = 'current'
          ON CONFLICT (game_title_id) DO NOTHING
        ", &[&supported]).await?;
    client
        .execute(
            r"
        UPDATE series_analysis_title_states
        SET algorithm_version = $2, artifact_schema_version = $3, validation_contract_id = $4
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
        ",
            &[
                &supported,
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?;
    client.execute(r"
        INSERT INTO series_analysis_job_requests (id, legacy_id, game_title_id, legacy_game_title_id, input_revision,
                                                  algorithm_version, artifact_schema_version, validation_contract_id, trigger)
        SELECT pg_temp.fixture_uuid('series_analysis_job_requests', (SELECT fixture_parent.legacy_id
                                     FROM game_titles AS fixture_parent
                                     WHERE fixture_parent.id = series_analysis_title_states.game_title_id) || '-request'),
               (SELECT fixture_parent.legacy_id
                FROM game_titles AS fixture_parent
                WHERE fixture_parent.id = series_analysis_title_states.game_title_id) || '-request',
               series_analysis_title_states.game_title_id, (SELECT fixture_parent.legacy_id
                FROM game_titles AS fixture_parent
                WHERE fixture_parent.id = series_analysis_title_states.game_title_id), input_revision, algorithm_version,
               artifact_schema_version, validation_contract_id, 'manual'
        FROM series_analysis_title_states
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_analysis_title_states.game_title_id) LIKE $1
        ", &[&format!("{PREFIX}%")]).await?;
    assert_eq!(
        crate::series_analysis::control::radar::materialize_pending(client, 64).await?,
        1,
        "incompatible pending titles must not hide a later supported intent"
    );
    let materialized = client
        .query_one(
            r"
                SELECT (SELECT fixture_parent.legacy_id
                        FROM game_titles AS fixture_parent
                        WHERE fixture_parent.id = series_analysis_jobs.game_title_id) AS game_title_id
                FROM series_analysis_jobs
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_jobs.game_title_id) LIKE $1
                ",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    assert_eq!(materialized.try_get::<_, String>(0)?, supported);
    Ok(())
}

async fn cleanup(client: &Client) -> TestResult {
    client
        .execute(
            r"
                DELETE FROM series_analysis_job_requests
                WHERE series_analysis_job_requests.legacy_game_title_id LIKE $1
                ",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    client
        .execute(
            r"
                DELETE FROM series_analysis_job_attempts
                WHERE job_id IN (SELECT id FROM series_analysis_jobs WHERE game_title_id IN (SELECT id FROM game_titles WHERE legacy_id LIKE $1))
                ",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    client
        .execute(
            r"
                DELETE FROM series_analysis_jobs
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_jobs.game_title_id) LIKE $1
                ",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    client
        .execute(
            r"
                DELETE FROM game_titles
                WHERE game_titles.legacy_id LIKE $1
                ",
            &[&format!("{PREFIX}%")],
        )
        .await?;
    Ok(())
}
