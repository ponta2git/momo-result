//! Own the v1 wire identity in one place; callers supply only successful snapshot data.

use serde::Serialize;

#[derive(Clone, Copy)]
pub(crate) enum NotificationKind {
    OcrCompleted,
    AnalysisCompleted,
}

impl NotificationKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::OcrCompleted => "ocr_completed",
            Self::AnalysisCompleted => "analysis_completed",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationEnvelope<'a, T> {
    notification_id: String,
    kind: &'static str,
    // Private so producers cannot construct an independently versioned or mismatched envelope.
    schema_version: u8,
    source_job_id: &'a str,
    occurred_at: String,
    settings_generation: String,
    data: T,
}

impl<'a, T> NotificationEnvelope<'a, T> {
    pub(super) fn notification_id(&self) -> &str {
        &self.notification_id
    }

    pub(super) const fn kind(&self) -> &'static str {
        self.kind
    }

    pub(super) const fn source_job_id(&self) -> &str {
        self.source_job_id
    }

    pub(crate) fn new(
        kind: NotificationKind,
        source_job_id: &'a str,
        occurred_at: String,
        settings_generation: String,
        data: T,
    ) -> Self {
        Self {
            notification_id: format!("result:{}:{source_job_id}", kind.as_str()),
            kind: kind.as_str(),
            schema_version: 1,
            source_job_id,
            occurred_at,
            settings_generation,
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "wire assertions report drift while serialization failures propagate"
    )]
    fn wire_identity_is_bound_to_kind_and_logical_job() -> serde_json::Result<()> {
        for (kind, wire) in [
            (NotificationKind::OcrCompleted, "ocr_completed"),
            (NotificationKind::AnalysisCompleted, "analysis_completed"),
        ] {
            let envelope = NotificationEnvelope::new(
                kind,
                "logical:job-1",
                "2026-01-01T00:00:00.000Z".to_owned(),
                "9007199254740993".to_owned(),
                (),
            );
            assert_eq!(
                serde_json::to_value(envelope)?,
                serde_json::json!({
                    "notificationId": format!("result:{wire}:logical:job-1"),
                    "kind": wire, "schemaVersion": 1, "sourceJobId": "logical:job-1",
                    "occurredAt": "2026-01-01T00:00:00.000Z",
                    "settingsGeneration": "9007199254740993", "data": null
                })
            );
        }
        Ok(())
    }
}
