//! Freeze only this image's validated outcome, after every business write and before COMMIT.

use serde::Serialize;
use tokio::time::Instant;
use tokio_postgres::{Row, Transaction};

use super::{
    NotificationEnvelope, NotificationKind, NotificationReservation, PreparedNotification,
    SkipReason, valid_source_id,
};

pub(crate) const MAXIMUM_SNAPSHOT_BYTES: usize = 16 * 1024;
const KIND: &str = NotificationKind::OcrCompleted.as_str();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrData<'a> {
    match_draft_id: String,
    ocr_draft_id: &'a str,
    image_id: String,
    screen_type: &'a str,
    outcome: &'static str,
    summary: &'static str,
    context: Context,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    game_title_name: Option<String>,
    held_date_iso: Option<String>,
    match_no_in_event: Option<i32>,
}

/// A failed savepoint rollback or lost connection still fails finalization. Only recoverable
/// preparation errors become skips; an uncertain business COMMIT never authorizes HTTP. The
/// caller supplies the original finalization deadline, including time spent on business writes.
pub(crate) async fn prepare(
    transaction: &Transaction<'_>,
    reservation: NotificationReservation,
    job_id: &str,
    draft_id: &str,
    screen_type: &str,
    needs_review: bool,
    finalization_deadline: Instant,
) -> Result<Option<PreparedNotification>, tokio_postgres::Error> {
    super::preparation::recoverable(transaction, KIND, job_id, finalization_deadline, async {
        let rows = transaction.query(SNAPSHOT_SQL, &[&job_id]).await?;
        Ok(snapshot(&rows, job_id, draft_id, screen_type, needs_review)
            .and_then(|envelope| reservation.prepare(&envelope)))
    })
    .await
}

fn snapshot<'a>(
    rows: &[Row],
    job_id: &'a str,
    draft_id: &'a str,
    screen_type: &'a str,
    needs_review: bool,
) -> Result<NotificationEnvelope<'a, OcrData<'a>>, SkipReason> {
    let row = rows.first().ok_or(SkipReason::InvalidSnapshot)?;
    if !row
        .try_get::<_, bool>("enabled")
        .map_err(|_error| SkipReason::InvalidSnapshot)?
    {
        return Err(SkipReason::SettingOff);
    }
    let field = |key| {
        row.try_get::<_, Option<String>>(key)
            .map_err(|_error| SkipReason::InvalidSnapshot)?
            .ok_or(SkipReason::InvalidSnapshot)
    };
    let match_draft_id = field("match_draft_id")?;
    let image_id = field("image_id")?;
    let valid = row
        .try_get::<_, bool>("valid")
        .map_err(|_error| SkipReason::InvalidSnapshot)?;
    if rows.len() != 1
        || !valid
        || !valid_source_id(&match_draft_id)
        || !valid_source_id(&image_id)
        || !valid_source_id(draft_id)
        || !matches!(screen_type, "total_assets" | "revenue" | "incident_log")
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    // The row owns these strings only during serialization; keep them in the envelope itself.
    let occurred_at = field("occurred_at")?;
    let generation = field("generation")?;
    let data = OcrData {
        match_draft_id,
        ocr_draft_id: draft_id,
        image_id,
        screen_type,
        outcome: if needs_review {
            "needs_review"
        } else {
            "succeeded"
        },
        summary: if needs_review {
            "画像の読み取りが完了しました。確認が必要な項目があります。"
        } else {
            "画像の読み取りが完了しました。結果を確認してください。"
        },
        context: Context {
            game_title_name: row
                .try_get("game_title_name")
                .map_err(|_error| SkipReason::InvalidSnapshot)?,
            held_date_iso: row
                .try_get("held_date_iso")
                .map_err(|_error| SkipReason::InvalidSnapshot)?,
            match_no_in_event: row
                .try_get("match_no_in_event")
                .map_err(|_error| SkipReason::InvalidSnapshot)?,
        },
    };
    Ok(NotificationEnvelope::new(
        NotificationKind::OcrCompleted,
        job_id,
        occurred_at,
        generation,
        data,
    ))
}

// Bound every variable-length field before it crosses the DB driver. An oversized/ambiguous
// historical reference skips its notification; it cannot invalidate the image's business success.
const SNAPSHOT_SQL: &str = "SELECT s.enabled, s.generation::text AS generation, \
    left(md.id, 201) AS match_draft_id, left(j.source_image_id, 201) AS image_id, \
    to_char(j.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS occurred_at, \
    CASE WHEN octet_length(gt.name) <= 1024 THEN gt.name END AS game_title_name, \
    to_char(he.held_date_iso, 'YYYY-MM-DD') AS held_date_iso, md.match_no_in_event, \
    COALESCE(md.status NOT IN ('confirmed', 'cancelled') AND j.status = 'succeeded' \
      AND length(md.id) <= 200 AND length(j.source_image_id) <= 200 \
      AND (gt.name IS NULL OR octet_length(gt.name) <= 1024), false) AS valid \
    FROM discord_notification_settings s \
    LEFT JOIN ocr_jobs j ON j.id = $1 \
    LEFT JOIN match_drafts md ON j.draft_id IN \
      (md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id) \
    LEFT JOIN game_titles gt ON gt.id = md.game_title_id \
    LEFT JOIN held_events he ON he.id = md.held_event_id \
    WHERE s.kind = 'ocr_completed' LIMIT 2";
