use super::*;
use crate::worker::{PostCommitSink, WakeReceiver};

const STALE_AFTER: Duration = Duration::from_secs(300);
const TIMEOUT: Duration = Duration::from_secs(5);

pub(super) async fn verify(primary: &mut Client, peer: &mut Client) -> SmokeResult {
    let (sink, mut receiver) = PostCommitSink::channel();
    verify_expiration(primary, peer, &sink, &mut receiver).await?;
    verify_projection_repair(primary, peer, &sink, &mut receiver).await
}

fn checkpoint(receiver: &mut WakeReceiver, expected: bool, phase: &str) {
    assert_eq!(receiver.try_recv().is_ok(), expected, "{phase}");
}

async fn verify_expiration(
    primary: &mut Client,
    peer: &mut Client,
    sink: &PostCommitSink,
    receiver: &mut WakeReceiver,
) -> SmokeResult {
    maintenance::reap_stale(primary, sink, STALE_AFTER, TIMEOUT).await?;
    checkpoint(receiver, false, "empty");
    insert_fixture(primary, &TAKEOVER).await?;
    insert_fixture(primary, &SUCCESS).await?;
    let config = control_config("ocr-c2-worker-success")?;
    let live = claimed(claim_job(primary, SUCCESS.job_id, &config).await?)?;
    primary.execute(r"
        UPDATE ocr_jobs
        SET created_at = clock_timestamp() - CAST('1 hour' AS interval)
          , started_at = CASE
                           WHEN status = 'running' THEN clock_timestamp() - CAST('1 hour' AS interval)
                           ELSE NULL
                         END
        WHERE ocr_jobs.legacy_id IN ($1, $2)
        ", &[&TAKEOVER.job_id,&SUCCESS.job_id]).await?;
    let lock = peer.transaction().await?;
    lock_match_drafts_for_job(&lock, TAKEOVER.job_id).await?;
    maintenance::reap_stale(primary, sink, STALE_AFTER, TIMEOUT).await?;
    checkpoint(receiver, false, "contended");
    lock.rollback().await?;
    maintenance::reap_stale(primary, sink, STALE_AFTER, TIMEOUT).await?;
    checkpoint(receiver, true, "expired");
    let stale = primary
        .query_one(
            r"
                SELECT status, failure_code
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&TAKEOVER.job_id],
        )
        .await?;
    assert_eq!(stale.try_get::<_, String>(0)?, "failed");
    assert_eq!(stale.try_get::<_, String>(1)?, "OCR_TIMEOUT");
    assert_match_draft_status(primary, &TAKEOVER, "ocr_failed").await?;
    let active = primary
        .query_one(
            r"
                SELECT status, CAST(attempt_id AS text)
                FROM ocr_jobs
                WHERE ocr_jobs.legacy_id = $1
                ",
            &[&SUCCESS.job_id],
        )
        .await?;
    assert_eq!(active.try_get::<_, String>(0)?, "running");
    assert_eq!(active.try_get::<_, String>(1)?, live.attempt_id);
    assert_match_draft_status(primary, &SUCCESS, "ocr_running").await?;
    Ok(())
}

async fn verify_projection_repair(
    primary: &mut Client,
    peer: &Client,
    sink: &PostCommitSink,
    receiver: &mut WakeReceiver,
) -> SmokeResult {
    // Simulate an older terminal job whose projection is still pending. A session-local
    // check rejects only that projection, independently of earlier candidate commits.
    primary
        .execute(
            "UPDATE match_drafts SET status='ocr_running' WHERE legacy_id=$1",
            &[&TAKEOVER.match_draft_id],
        )
        .await?;
    primary
        .batch_execute(
            "CREATE TEMP VIEW match_drafts AS
        SELECT * FROM public.match_drafts
        WHERE status='ocr_running' OR legacy_id <> 'c2-smoke-match-draft-takeover'
        WITH LOCAL CHECK OPTION",
        )
        .await?;
    expect_repair_error(primary, sink).await?;
    checkpoint(receiver, false, "rolled back");

    // Both jobs now expire without changing their drafts. Only one wake is needed.
    for fixture in [&PREEMPT, &MALFORMED] {
        insert_fixture(primary, fixture).await?;
        primary
            .execute(
                "UPDATE match_drafts SET status='cancelled' WHERE legacy_id=$1",
                &[&fixture.match_draft_id],
            )
            .await?;
    }
    primary
        .execute(
            "UPDATE ocr_jobs SET created_at=clock_timestamp()-interval '1 hour'
             WHERE legacy_id IN ($1, $2)",
            &[&PREEMPT.job_id, &MALFORMED.job_id],
        )
        .await?;
    expect_repair_error(primary, sink).await?;
    checkpoint(receiver, true, "partially committed");
    let expired: i64 = peer
        .query_one(
            "SELECT count(*) FROM ocr_jobs WHERE legacy_id IN ($1, $2)
         AND status='failed' AND failure_code='OCR_TIMEOUT'",
            &[&PREEMPT.job_id, &MALFORMED.job_id],
        )
        .await?
        .try_get(0)?;
    assert_eq!(expired, 2);
    assert_match_draft_status(peer, &TAKEOVER, "ocr_running").await?;

    primary
        .batch_execute("DROP VIEW pg_temp.match_drafts")
        .await?;
    maintenance::reap_stale(primary, sink, STALE_AFTER, TIMEOUT).await?;
    checkpoint(receiver, true, "projection repaired");
    assert_match_draft_status(peer, &TAKEOVER, "ocr_failed").await?;
    maintenance::reap_stale(primary, sink, STALE_AFTER, TIMEOUT).await?;
    checkpoint(receiver, false, "unchanged");
    Ok(())
}

async fn expect_repair_error(primary: &mut Client, sink: &PostCommitSink) -> SmokeResult {
    let result = maintenance::reap_stale(primary, sink, STALE_AFTER, TIMEOUT).await;
    if !matches!(result, Err(OcrControlError::Postgres(ref err)) if err.code() == Some(&tokio_postgres::error::SqlState::WITH_CHECK_OPTION_VIOLATION))
    {
        return Err(
            smoke_error("expected the maintenance projection to fail its check option").into(),
        );
    }
    Ok(())
}
