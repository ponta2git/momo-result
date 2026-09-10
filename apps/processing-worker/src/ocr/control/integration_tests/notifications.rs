use super::*;
use crate::notifications::{
    NotificationConfig, NotificationDriver, NotificationSink, PreparedNotification, ocr,
};

macro_rules! fixture {
    ($name:literal, $digit:literal) => {
        Fixture {
            job_id: concat!("c2-notification-job-", $name),
            draft_id: concat!("c2-notification-ocr-", $name),
            match_draft_id: concat!("c2-notification-match-", $name),
            source_image_id: concat!("c2-notification-image-", $name),
            object_key: concat!("source-images/c2-notification-", $name, ".png"),
            idempotency_digit: $digit,
        }
    };
}

const TOTAL: Fixture = fixture!("total", "8");
const REVENUE: Fixture = fixture!("revenue", "9");
const INCIDENT: Fixture = fixture!("incident", "a");
const OFF: Fixture = fixture!("off", "b");
const TIMEOUT: Fixture = fixture!("timeout", "c");
const ORPHAN: Fixture = fixture!("orphan", "d");
const ROLLBACK: Fixture = fixture!("rollback", "e");
const GENERATION: Fixture = fixture!("generation", "f");

pub(super) async fn verify(primary: &mut Client, peer: &mut Client) -> SmokeResult {
    for fixture in [
        &TOTAL,
        &REVENUE,
        &INCIDENT,
        &OFF,
        &TIMEOUT,
        &ORPHAN,
        &ROLLBACK,
        &GENERATION,
    ] {
        insert_fixture(primary, fixture).await?;
    }
    let (sink, driver) = NotificationDriver::new(NotificationConfig::http(
        "http://127.0.0.1:1/internal/discord-notifications",
        &"x".repeat(32),
    )?)?;
    let config = control_config("ocr-c2-worker-success")?;
    verify_mixed_images(primary, &config, &sink).await?;
    verify_generation_after_gate_wait(primary, peer, &config, &sink).await?;
    verify_skips_preserve_success(primary, peer, &config, &sink).await?;
    verify_rollback(primary, &config, &sink).await?;
    drop(sink);
    drop(driver);
    primary.batch_execute(
        "DELETE FROM match_drafts WHERE id LIKE 'c2-notification-match-%'; \
         DELETE FROM ocr_queue_outbox WHERE job_id LIKE 'c2-notification-job-%'; \
         DELETE FROM ocr_jobs WHERE id LIKE 'c2-notification-job-%'; \
         DELETE FROM ocr_drafts WHERE id LIKE 'c2-notification-ocr-%'; \
         DELETE FROM source_images WHERE id LIKE 'c2-notification-image-%'; \
         UPDATE discord_notification_settings SET enabled = true, generation = 0 WHERE kind = 'ocr_completed'"
    ).await?;
    Ok(())
}

async fn verify_mixed_images(
    primary: &mut Client,
    config: &OcrControlConfig,
    sink: &NotificationSink,
) -> SmokeResult {
    let revenue_delivery = change_screen(primary, &REVENUE, RequestedScreenType::Revenue).await?;
    let incident_delivery =
        change_screen(primary, &INCIDENT, RequestedScreenType::IncidentLog).await?;
    primary
        .execute(
            "UPDATE match_drafts SET revenue_draft_id = $2, incident_log_draft_id = $3, \
        played_at = '2026-01-01T12:00:00Z' WHERE id = $1",
            &[&TOTAL.match_draft_id, &REVENUE.draft_id, &INCIDENT.draft_id],
        )
        .await?;
    primary
        .execute(
            "DELETE FROM match_drafts WHERE id = ANY($1)",
            &[&vec![REVENUE.match_draft_id, INCIDENT.match_draft_id]],
        )
        .await?;
    let first_claim = claimed(claim_job(primary, &payload(&TOTAL)?, config).await?)?;
    let first = complete(
        primary,
        &first_claim,
        config,
        sink,
        &tests::completion_with_missing_amount_warning(),
    )
    .await?
    .ok_or("first image notification missing")?;
    let first_payload = first.payload()?;
    drop(first);
    assert_match_draft_status(primary, &TOTAL, "ocr_running").await?;
    let second_claim = claimed(claim_job(primary, &revenue_delivery, config).await?)?;
    let second = complete(
        primary,
        &second_claim,
        config,
        sink,
        &tests::valid_completion(RequestedScreenType::Revenue),
    )
    .await?
    .ok_or("second image notification missing")?;
    let second_payload = second.payload()?;
    drop(second);
    let third_claim = claimed(claim_job(primary, &incident_delivery, config).await?)?;
    finish_failure(
        primary,
        &third_claim,
        config,
        OcrFailureCode::ParserFailed,
        10,
    )
    .await?;
    assert_match_draft_status(primary, &TOTAL, "ocr_failed").await?;
    for (body, fixture, outcome, screen) in [
        (first_payload, &TOTAL, "needs_review", "total_assets"),
        (second_payload, &REVENUE, "succeeded", "revenue"),
    ] {
        let payload = body;
        assert_eq!(
            payload.get("notificationId"),
            Some(&json!(format!("result:ocr_completed:{}", fixture.job_id)))
        );
        assert_eq!(
            payload.pointer("/data/matchDraftId"),
            Some(&json!(TOTAL.match_draft_id))
        );
        assert_eq!(
            payload.pointer("/data/ocrDraftId"),
            Some(&json!(fixture.draft_id))
        );
        assert_eq!(
            payload.pointer("/data/imageId"),
            Some(&json!(fixture.source_image_id))
        );
        assert_eq!(payload.pointer("/data/outcome"), Some(&json!(outcome)));
        assert_eq!(payload.pointer("/data/screenType"), Some(&json!(screen)));
        assert_eq!(
            payload.pointer("/data/context"),
            Some(&json!({"gameTitleName":null,"heldDateIso":null,"matchNoInEvent":null}))
        );
        let finished: String = primary.query_one(
            "SELECT to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM ocr_jobs WHERE id = $1",
            &[&fixture.job_id],
        ).await?.try_get(0)?;
        assert_eq!(payload.get("occurredAt"), Some(&json!(finished)));
    }
    assert!(matches!(
        claim_result(claim_job(primary, &payload(&TOTAL)?, config).await?)?,
        OcrClaimResult::MissingOrTerminal
    ));
    Ok(())
}

async fn verify_generation_after_gate_wait(
    primary: &mut Client,
    peer: &mut Client,
    config: &OcrControlConfig,
    sink: &NotificationSink,
) -> SmokeResult {
    let claim = claimed(claim_job(primary, &payload(&GENERATION)?, config).await?)?;
    let gate = peer.transaction().await?;
    gate.query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
        .await?;
    gate.execute("UPDATE discord_notification_settings SET enabled = false, generation = 9007199254740992 WHERE kind = 'ocr_completed'", &[]).await?;
    let completion = tests::valid_completion(RequestedScreenType::TotalAssets);
    let (notification, released) = tokio::join!(
        complete(primary, &claim, config, sink, &completion),
        async {
            tokio::time::timeout(Duration::from_secs(1), async {
                loop {
                    let blocked: bool = gate.query_one(
                        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid)))", &[],
                    ).await?.try_get(0)?;
                    if blocked { break Ok::<(), tokio_postgres::Error>(()); }
                    tokio::task::yield_now().await;
                }
            }).await??;
            gate.execute("UPDATE discord_notification_settings SET enabled = true, generation = 9007199254740993 WHERE kind = 'ocr_completed'", &[]).await?;
            gate.commit().await?;
            Ok::<(), Box<dyn Error + Send + Sync>>(())
        }
    );
    released?;
    let body = notification?
        .ok_or("generation snapshot missing")?
        .payload()?;
    assert_eq!(
        body.get("settingsGeneration"),
        Some(&json!("9007199254740993"))
    );
    Ok(())
}

async fn verify_skips_preserve_success(
    primary: &mut Client,
    peer: &mut Client,
    config: &OcrControlConfig,
    sink: &NotificationSink,
) -> SmokeResult {
    let completion = tests::valid_completion(RequestedScreenType::TotalAssets);
    primary
        .execute(
            "UPDATE discord_notification_settings SET enabled = false WHERE kind = 'ocr_completed'",
            &[],
        )
        .await?;
    let off = claimed(claim_job(primary, &payload(&OFF)?, config).await?)?;
    assert!(
        complete(primary, &off, config, sink, &completion)
            .await?
            .is_none()
    );
    assert_match_draft_status(primary, &OFF, "draft_ready").await?;
    primary
        .execute(
            "UPDATE discord_notification_settings SET enabled = true WHERE kind = 'ocr_completed'",
            &[],
        )
        .await?;
    let timed = claimed(claim_job(primary, &payload(&TIMEOUT)?, config).await?)?;
    let gate = peer.transaction().await?;
    gate.query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
        .await?;
    assert!(
        complete(primary, &timed, config, sink, &completion)
            .await?
            .is_none()
    );
    assert_match_draft_status(primary, &TIMEOUT, "draft_ready").await?;
    gate.rollback().await?;
    let orphan = claimed(claim_job(primary, &payload(&ORPHAN)?, config).await?)?;
    primary
        .execute(
            "DELETE FROM match_drafts WHERE id = $1",
            &[&ORPHAN.match_draft_id],
        )
        .await?;
    assert!(
        complete(primary, &orphan, config, sink, &completion)
            .await?
            .is_none()
    );
    let status: String = primary
        .query_one(
            "SELECT status FROM ocr_jobs WHERE id = $1",
            &[&ORPHAN.job_id],
        )
        .await?
        .try_get(0)?;
    assert_eq!(status, "succeeded");
    // Exercise the actual savepoint preparation with both success and statement timeout, checking
    // limits before COMMIT so transaction-local reset cannot hide an incorrect RELEASE path.
    for block in [false, true] {
        let restoration_gate = peer.transaction().await?;
        if block {
            restoration_gate
                .query_one("SELECT pg_advisory_xact_lock(19790514, 1)", &[])
                .await?;
        }
        let tx = bounded_transaction(primary, config.finalization_timeout()).await?;
        let result = ocr::prepare(
            &tx,
            reserve(sink)?,
            TOTAL.job_id,
            TOTAL.draft_id,
            "total_assets",
            true,
            config.finalization_timeout(),
        )
        .await?;
        assert_eq!(result.is_none(), block);
        drop(result);
        for name in ["statement_timeout", "lock_timeout"] {
            let value: String = tx
                .query_one("SELECT current_setting($1)", &[&name])
                .await?
                .try_get(0)?;
            assert_eq!(value, "1s");
        }
        tx.rollback().await?;
        restoration_gate.rollback().await?;
    }
    Ok(())
}

async fn verify_rollback(
    primary: &mut Client,
    config: &OcrControlConfig,
    sink: &NotificationSink,
) -> SmokeResult {
    let claim = claimed(claim_job(primary, &payload(&ROLLBACK)?, config).await?)?;
    let mut stale = claim.clone();
    stale.fencing_token += 1;
    let completion = tests::valid_completion(RequestedScreenType::TotalAssets);
    assert!(matches!(
        finish_success(
            primary,
            &stale,
            config,
            &OcrHints::default(),
            &completion,
            Some(reserve(sink)?)
        )
        .await,
        Err(OcrControlError::OwnerLost)
    ));
    let status: String = primary
        .query_one(
            "SELECT status FROM ocr_jobs WHERE id = $1",
            &[&ROLLBACK.job_id],
        )
        .await?
        .try_get(0)?;
    assert_eq!(status, "running");
    finish_failure(primary, &claim, config, OcrFailureCode::ParserFailed, 10).await?;
    Ok(())
}

fn reserve(sink: &NotificationSink) -> SmokeResult<NotificationReservation> {
    sink.reserve(ocr::MAXIMUM_SNAPSHOT_BYTES)
        .map_err(|_error| "notification admission failed".into())
}

async fn complete(
    client: &mut Client,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
    sink: &NotificationSink,
    completion: &OcrDraftCompletion,
) -> SmokeResult<Option<PreparedNotification>> {
    finish_success(
        client,
        claim,
        config,
        &OcrHints::default(),
        completion,
        Some(reserve(sink)?),
    )
    .await
    .map_err(Into::into)
}

async fn change_screen(
    client: &Client,
    fixture: &Fixture,
    screen: RequestedScreenType,
) -> SmokeResult<ValidatedOcrDelivery> {
    let mut message = persisted_payload(fixture);
    message
        .as_object_mut()
        .ok_or("fixture payload object")?
        .insert("requestedScreenType".to_owned(), json!(screen.wire()));
    client
        .execute(
            "UPDATE ocr_jobs SET requested_screen_type = $2 WHERE id = $1",
            &[&fixture.job_id, &screen.wire()],
        )
        .await?;
    client
        .execute(
            "UPDATE ocr_queue_outbox SET stream_payload = $2 WHERE job_id = $1",
            &[&fixture.job_id, &message],
        )
        .await?;
    crate::ocr::contract::parse_persisted_payload(&message).map_err(Into::into)
}
