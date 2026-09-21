//! Freeze the submission result after all business writes and before COMMIT.

use serde::Serialize;
use tokio::time::Instant;
use tokio_postgres::{Transaction, types::Type};

use super::{
    NotificationEnvelope, NotificationKind, NotificationReservation, PreparedNotification,
    SkipReason,
};

pub(crate) const MAXIMUM_SNAPSHOT_BYTES: usize = 16 * 1024;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Failure {
    pub(crate) screen_type: String,
    pub(crate) reason: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrData<'a> {
    submission_id: &'a str,
    match_draft_id: String,
    context: Context,
    failures: Vec<Failure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    game_title_name: Option<String>,
    held_date_iso: Option<String>,
    match_no_in_event: Option<i32>,
}

pub(crate) async fn prepare(
    transaction: &Transaction<'_>,
    reservation: NotificationReservation,
    submission_id: &str,
    failures: Vec<Failure>,
    deadline: Instant,
) -> Result<Option<PreparedNotification>, tokio_postgres::Error> {
    let source = format!("submission:{submission_id}");
    super::preparation::recoverable(transaction, "ocr_completed", &source, deadline, async {
        let row = transaction
            .query_typed_opt(SNAPSHOT_SQL, &[(&submission_id, Type::TEXT)])
            .await?;
        let Some(row) = row else {
            return Ok(Err(SkipReason::InvalidSnapshot));
        };
        if !row.get::<_, bool>("enabled") {
            return Ok(Err(SkipReason::SettingOff));
        }
        let data = OcrData {
            submission_id,
            match_draft_id: row.get("match_draft_id"),
            context: Context {
                game_title_name: row.get("game_title_name"),
                held_date_iso: row.get("held_date_iso"),
                match_no_in_event: row.get("match_no_in_event"),
            },
            failures,
        };
        let envelope = NotificationEnvelope::new(
            NotificationKind::OcrCompleted,
            &source,
            row.get("occurred_at"),
            row.get("generation"),
            data,
        );
        Ok(reservation.prepare(&envelope))
    })
    .await
}

const SNAPSHOT_SQL: &str = "SELECT settings.enabled, settings.generation::text AS generation, \
    s.match_draft_id, to_char(s.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS occurred_at, \
    CASE WHEN length(gt.name) > 200 THEN left(gt.name, 200) || '…' ELSE gt.name END AS game_title_name, \
    to_char(he.held_date_iso, 'YYYY-MM-DD') AS held_date_iso, md.match_no_in_event \
    FROM ocr_submissions s JOIN match_drafts md ON md.id = s.match_draft_id \
    JOIN discord_notification_settings settings ON settings.kind = 'ocr_completed' \
    LEFT JOIN game_titles gt ON gt.id = md.game_title_id \
    LEFT JOIN held_events he ON he.id = md.held_event_id \
    WHERE s.id = $1 AND s.status = 'settled' AND md.status NOT IN ('confirmed', 'cancelled')";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoder_matches_the_shared_submission_fixture() -> Result<(), Box<dyn std::error::Error>> {
        let data = OcrData {
            submission_id: "00000000-0000-4000-8000-000000000024",
            match_draft_id: "match-draft-24".to_owned(),
            context: Context {
                game_title_name: Some("桃太郎電鉄".to_owned()),
                held_date_iso: Some("2026-01-01".to_owned()),
                match_no_in_event: Some(1),
            },
            failures: vec![Failure {
                screen_type: "incident_log".to_owned(),
                reason: "ocr_timeout",
            }],
        };
        let envelope = NotificationEnvelope::new(
            NotificationKind::OcrCompleted,
            "submission:00000000-0000-4000-8000-000000000024",
            "2026-01-01T00:00:00.000Z".to_owned(),
            "9007199254740993".to_owned(),
            data,
        );
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../testdata/ocr-submission-v2.json"))?;
        if serde_json::to_value(envelope)? != fixture {
            return Err("OCR submission wire fixture drift".into());
        }
        Ok(())
    }
}
