//! Bind wire identity and version to the notification kind.

use serde::Serialize;

/// Supported wire kinds with fixed versions and complete JSONB limits.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    /// A completed OCR submission.
    OcrCompleted,
    /// A completed logical analysis job.
    AnalysisCompleted,
}

impl NotificationKind {
    /// Maximum UTF-8 bytes of the complete envelope in PostgreSQL JSONB text form.
    #[must_use]
    pub const fn maximum_jsonb_bytes(self) -> usize {
        match self {
            Self::OcrCompleted => super::config::MAXIMUM_OCR_JSONB_BYTES,
            Self::AnalysisCompleted => super::config::MAXIMUM_ANALYSIS_JSONB_BYTES,
        }
    }

    /// Stable wire kind used by producers and receipt matching.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OcrCompleted => "ocr_completed",
            Self::AnalysisCompleted => "analysis_completed",
        }
    }
}

/// Bind producer content to the kind's identity and schema version.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEnvelope<'a, T> {
    notification_id: String,
    kind: NotificationKind,
    // Private so producers cannot construct an independently versioned or mismatched envelope.
    schema_version: u8,
    source_job_id: &'a str,
    occurred_at: String,
    settings_generation: String,
    data: T,
}

impl<'a, T> NotificationEnvelope<'a, T> {
    /// Stable notification identity derived from kind and source job.
    pub fn notification_id(&self) -> &str {
        &self.notification_id
    }

    pub(super) const fn kind(&self) -> &'static str {
        self.kind.as_str()
    }

    pub(super) const fn maximum_jsonb_bytes(&self) -> usize {
        self.kind.maximum_jsonb_bytes()
    }

    pub(super) const fn source_job_id(&self) -> &str {
        self.source_job_id
    }

    /// Freeze producer-supplied content, time and settings generation under a wire identity.
    /// Domain payload validation remains the producer's responsibility.
    pub fn new(
        kind: NotificationKind,
        source_job_id: &'a str,
        occurred_at: String,
        settings_generation: String,
        data: T,
    ) -> Self {
        Self {
            notification_id: format!("result:{}:{source_job_id}", kind.as_str()),
            kind,
            schema_version: match kind {
                NotificationKind::OcrCompleted => 2,
                NotificationKind::AnalysisCompleted => 1,
            },
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
                    "kind": wire, "schemaVersion": if wire == "ocr_completed" { 2 } else { 1 }, "sourceJobId": "logical:job-1",
                    "occurredAt": "2026-01-01T00:00:00.000Z",
                    "settingsGeneration": "9007199254740993", "data": null
                })
            );
        }
        Ok(())
    }
}
