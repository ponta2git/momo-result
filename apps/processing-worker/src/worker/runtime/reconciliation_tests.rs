//! Receipt recovery keeps progressing while T0 retains an unrelated in-flight operation.

use super::*;
use crate::notifications::NotificationSink;
use sha2::{Digest, Sha256};
use std::error::Error;
use tokio::sync::oneshot;
use tokio_postgres::Client;

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

#[tokio::test]
#[ignore = "requires explicitly isolated OCR_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_reconciliation_continues_during_a_waiting_worker_operation() -> TestResult {
    if std::env::var("ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED").as_deref() != Ok("true") {
        return Err("isolated database authorization is required".into());
    }
    let url = std::env::var("OCR_CONTROL_SMOKE_DATABASE_URL")?;
    let observer = crate::identity::fixtures::connect(&url).await?;
    let ids = (0..34)
        .map(|index| format!("00000000-0015-4a00-8000-{index:012}"))
        .collect::<Vec<_>>();
    cleanup(&observer, &ids).await?;
    let result = verify(&observer, &url, &ids).await;
    let cleaned = cleanup(&observer, &ids).await;
    drop(observer);
    result?;
    cleaned
}

async fn verify(observer: &Client, url: &str, ids: &[String]) -> TestResult {
    let (late, initial) = ids.split_first().ok_or("missing receipt fixture")?;
    for id in initial {
        create(observer, id).await?;
    }
    let (_external, stopped) = watch::channel(false);
    let (sink, wake) = PostCommitSink::channel();
    let mut runtime = Runtime::new(stopped, Duration::from_secs(15), Duration::from_secs(1));
    runtime.wake = Some(wake);
    runtime.submissions = Some(
        ocr::submissions::runtime::Reconciler::initialize(
            url.to_owned(),
            Duration::from_secs(5),
            NotificationSink::default(),
        )
        .await?,
    );
    let (release, released) = oneshot::channel();
    let operation = runtime.operation(async move {
        released
            .await
            .map_err(|_closed| WorkerError::UnexpectedExit)?;
        Ok(())
    });
    let verify_receipts = async {
        // More than one finite page must settle before the T0 operation can be released.
        wait_for_settled(observer, initial, 33).await?;
        // This ID sorts before the completed cursor. Only a new wake/scan can discover it.
        create(observer, late).await?;
        sink.submit(super::super::PostCommitEffects::WakeJobs)?;
        wait_for_settled(observer, ids, 34).await?;
        release
            .send(())
            .map_err(|()| "worker operation ended before receipt recovery")?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    // The normal safety scan is later than this bound, so lost wake handling cannot pass.
    let outcome = time::timeout(Duration::from_secs(10), async {
        tokio::join!(operation, verify_receipts)
    })
    .await;
    let finalized = finish(&mut runtime, &mut None).await;
    drop(runtime);
    drop(sink);
    let (finished, receipts) = outcome?;
    finished?;
    receipts?;
    finalized?;
    Ok(())
}

async fn wait_for_settled(client: &Client, ids: &[String], count: i64) -> TestResult {
    loop {
        let settled: i64 = client
            .query_one(
                r"
                    SELECT count(*)
                    FROM ocr_submissions
                    WHERE ocr_submissions.legacy_id = ANY($1) AND status = 'settled'
                    ",
                &[&ids],
            )
            .await?
            .try_get(0)?;
        if settled == count {
            return Ok(());
        }
        tokio::task::yield_now().await;
    }
}

async fn create(client: &Client, id: &str) -> TestResult {
    let digest = hex::encode(Sha256::digest(id.as_bytes()));
    client.execute(r"
        INSERT INTO match_drafts (id, legacy_id, created_by_account_id, created_by_member_id, status)
        VALUES (pg_temp.fixture_uuid('match_drafts', $1), $1, pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'),
                pg_temp.fixture_uuid('members', 'member_ponta'), 'ocr_running')
        ", &[&id]).await?;
    client
        .execute(
            r"
        INSERT INTO ocr_submissions (id, legacy_id, owner_account_id, match_draft_id, legacy_match_draft_id, ocr_hints_json,
                                     status, admission_deadline, created_at)
        VALUES (pg_temp.fixture_uuid('ocr_submissions', $1), $1,
                pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'), pg_temp.fixture_uuid('match_drafts', $1), $1,
                CAST('{}' AS jsonb), 'open', clock_timestamp() - CAST('1 second' AS interval),
                clock_timestamp() - CAST('2 seconds' AS interval))
        ",
            &[&id],
        )
        .await?;
    client
        .execute(
            r"
        INSERT INTO ocr_submission_members (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex,
                                            image_byte_length, status)
        VALUES (pg_temp.fixture_uuid('ocr_submissions', $1), 'total_assets', $2, $2, 68, 'pending')
        ",
            &[&id, &digest],
        )
        .await?;
    Ok(())
}

async fn cleanup(client: &Client, ids: &[String]) -> TestResult {
    client
        .execute(
            r"
                DELETE FROM ocr_submission_members
                WHERE (SELECT fixture_parent.legacy_id
                       FROM ocr_submissions AS fixture_parent
                       WHERE fixture_parent.id = ocr_submission_members.submission_id) = ANY($1)
                ",
            &[&ids],
        )
        .await?;
    client
        .execute(
            r"
            DELETE FROM ocr_submissions
            WHERE ocr_submissions.legacy_id = ANY($1)
            ",
            &[&ids],
        )
        .await?;
    client
        .execute(
            r"
            DELETE FROM match_drafts
            WHERE match_drafts.legacy_id = ANY($1)
            ",
            &[&ids],
        )
        .await?;
    Ok(())
}
