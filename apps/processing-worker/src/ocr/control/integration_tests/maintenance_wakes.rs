use super::*;
use crate::ocr::submissions::CHANNEL;
use futures_util::future::poll_fn;
use tokio_postgres::AsyncMessage;

const STALE_AFTER: Duration = Duration::from_secs(300);
const TIMEOUT: Duration = Duration::from_secs(5);

pub(super) async fn verify(url: &str, primary: &mut Client, peer: &mut Client) -> SmokeResult {
    let (listener, mut connection) = crate::postgres::open(url).await?;
    let passes = async {
        listener
            .batch_execute("LISTEN ocr_submissions; LISTEN maintenance_checkpoint")
            .await?;
        verify_expiration(primary, peer).await?;
        verify_projection_repair(primary, peer).await?;
        checkpoint(primary, "done").await?;
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    };
    // The publisher commits each checkpoint after the pass. Its place in the notification
    // stream proves the quiet cases without a sleep or a race against delivery.
    let observe = async {
        let mut counts = Vec::new();
        let mut wakes = 0;
        loop {
            let message = tokio::time::timeout(
                Duration::from_secs(15),
                poll_fn(|cx| connection.poll_message(cx)),
            )
            .await?
            .ok_or_else(|| smoke_error("notification listener closed"))??;
            if let AsyncMessage::Notification(notification) = message {
                match (notification.channel(), notification.payload()) {
                    (CHANNEL, "") => wakes += 1,
                    ("maintenance_checkpoint", "done") => break,
                    ("maintenance_checkpoint", pass) => {
                        counts.push(format!("{pass}={wakes}"));
                        wakes = 0;
                    }
                    _ => return Err(smoke_error("unexpected OCR maintenance notification").into()),
                }
            }
        }
        Ok::<_, Box<dyn Error + Send + Sync>>(counts)
    };
    let ((), counts) = tokio::try_join!(passes, observe)?;
    assert_eq!(
        counts,
        [
            "empty=0",
            "contended=0",
            "expired=1",
            "rolled back=0",
            "partially committed=1",
            "projection repaired=1",
            "unchanged=0"
        ]
    );
    Ok(())
}

async fn checkpoint(publisher: &Client, pass: &str) -> SmokeResult {
    publisher
        .execute("SELECT pg_notify('maintenance_checkpoint', $1)", &[&pass])
        .await?;
    Ok(())
}

async fn verify_expiration(primary: &mut Client, peer: &mut Client) -> SmokeResult {
    maintenance::reap_stale(primary, STALE_AFTER, TIMEOUT).await?;
    checkpoint(primary, "empty").await?;
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
    maintenance::reap_stale(primary, STALE_AFTER, TIMEOUT).await?;
    checkpoint(primary, "contended").await?;
    lock.rollback().await?;
    maintenance::reap_stale(primary, STALE_AFTER, TIMEOUT).await?;
    checkpoint(primary, "expired").await?;
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

async fn verify_projection_repair(primary: &mut Client, peer: &Client) -> SmokeResult {
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
    expect_repair_error(primary).await?;
    checkpoint(primary, "rolled back").await?;

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
    expect_repair_error(primary).await?;
    checkpoint(primary, "partially committed").await?;
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
    maintenance::reap_stale(primary, STALE_AFTER, TIMEOUT).await?;
    checkpoint(primary, "projection repaired").await?;
    assert_match_draft_status(peer, &TAKEOVER, "ocr_failed").await?;
    maintenance::reap_stale(primary, STALE_AFTER, TIMEOUT).await?;
    checkpoint(primary, "unchanged").await?;
    Ok(())
}

async fn expect_repair_error(primary: &mut Client) -> SmokeResult {
    let result = maintenance::reap_stale(primary, STALE_AFTER, TIMEOUT).await;
    if !matches!(result, Err(OcrControlError::Postgres(ref err)) if err.code() == Some(&tokio_postgres::error::SqlState::WITH_CHECK_OPTION_VIOLATION))
    {
        return Err(
            smoke_error("expected the maintenance projection to fail its check option").into(),
        );
    }
    Ok(())
}
