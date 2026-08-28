use tokio_postgres::{Row, Transaction};

use super::{OcrClaimResult, OcrControlError};
use crate::ocr::contract::{
    OcrMediaType, RequestedScreenType, SourceImageClaims, ValidatedOcrDelivery,
    parse_persisted_payload,
};

pub(super) struct OcrClaimCandidate {
    pub(super) draft_id: String,
    pub(super) source_image_id: String,
    pub(super) source_image: SourceImageClaims,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) requested_screen_type: RequestedScreenType,
    pub(super) attempt_count: i32,
    authoritative_delivery: ValidatedOcrDelivery,
}

impl OcrClaimCandidate {
    pub(super) fn matches(&self, delivery: &ValidatedOcrDelivery) -> bool {
        let payload = delivery.payload();
        self.draft_id == payload.draft_id()
            && self.source_image_id == payload.source_image_id()
            && self.source_image.object_key() == payload.image_object_key()
            && self.source_image.sha256() == payload.sha256()
            && self.source_image.byte_length() == payload.byte_length()
            && self.source_image.media_type() == payload.media_type()
            && self.requested_screen_type == payload.requested_screen_type()
            && self.authoritative_delivery == *delivery
    }
}

pub(super) enum CandidateResult {
    Ready(OcrClaimCandidate),
    Rejected(OcrClaimResult),
    InvalidPersistedContract,
}

pub(super) async fn load_candidate(
    transaction: &Transaction<'_>,
    job_id: &str,
) -> Result<CandidateResult, OcrControlError> {
    let job = transaction
        .query_opt(
            "SELECT draft_id, source_image_id, requested_screen_type, status,\x20\
                    available_at <= clock_timestamp(), queue_schema_version, attempt_count\x20\
             FROM ocr_jobs WHERE id = $1 FOR UPDATE",
            &[&job_id],
        )
        .await?;
    let Some(job) = job else {
        return Ok(CandidateResult::Rejected(OcrClaimResult::MissingOrTerminal));
    };
    let status = job.try_get::<_, String>(3)?;
    if matches!(status.as_str(), "succeeded" | "failed" | "cancelled") {
        return Ok(CandidateResult::Rejected(OcrClaimResult::MissingOrTerminal));
    }
    if status == "running" {
        return Ok(CandidateResult::Rejected(OcrClaimResult::AlreadyRunning));
    }
    if status != "queued" {
        return Err(OcrControlError::InvalidState);
    }
    if job.try_get::<_, i16>(5)? != 2 {
        return Ok(CandidateResult::Rejected(
            OcrClaimResult::UnsupportedQueueSchema,
        ));
    }
    if !job.try_get::<_, bool>(4)? {
        return Ok(CandidateResult::Rejected(OcrClaimResult::NotYetAvailable));
    }
    let Some(source_image_id) = job.try_get::<_, Option<String>>(1)? else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let source = transaction
        .query_opt(
            "SELECT status, object_key, sha256_hex, byte_length, media_type, width, height\x20\
             FROM source_images WHERE id = $1 FOR UPDATE",
            &[&source_image_id],
        )
        .await?;
    let Some(source) = source else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let outbox = transaction
        .query_opt(
            "SELECT stream_payload FROM ocr_queue_outbox\x20\
             WHERE id = 'ocr-outbox-' || $1 AND job_id = $1 AND schema_version = 2",
            &[&job_id],
        )
        .await?;
    let Some(outbox) = outbox else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let outbox_payload = outbox.try_get::<_, serde_json::Value>(0)?;
    let Ok(authoritative_delivery) = parse_persisted_payload(&outbox_payload) else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    Ok(
        decode_candidate(&job, source_image_id, &source, authoritative_delivery)?.map_or(
            CandidateResult::InvalidPersistedContract,
            CandidateResult::Ready,
        ),
    )
}

fn decode_candidate(
    job: &Row,
    source_image_id: String,
    source: &Row,
    authoritative_delivery: ValidatedOcrDelivery,
) -> Result<Option<OcrClaimCandidate>, OcrControlError> {
    if source.try_get::<_, String>(0)? != "AVAILABLE" {
        return Ok(None);
    }
    let Some(media_type) = OcrMediaType::parse_wire(&source.try_get::<_, String>(4)?) else {
        return Ok(None);
    };
    let Some(requested_screen_type) =
        RequestedScreenType::parse_wire(&job.try_get::<_, String>(2)?)
    else {
        return Ok(None);
    };
    let (Ok(byte_length), Ok(width), Ok(height)) = (
        u64::try_from(source.try_get::<_, i32>(3)?),
        u32::try_from(source.try_get::<_, i32>(5)?),
        u32::try_from(source.try_get::<_, i32>(6)?),
    ) else {
        return Ok(None);
    };
    let Some(source_image) = SourceImageClaims::new(
        source.try_get(1)?,
        source.try_get(2)?,
        byte_length,
        media_type,
    ) else {
        return Ok(None);
    };
    if width == 0 || height == 0 || width > 1920 || height > 1080 {
        return Ok(None);
    }
    Ok(Some(OcrClaimCandidate {
        draft_id: job.try_get(0)?,
        source_image_id,
        source_image,
        width,
        height,
        requested_screen_type,
        attempt_count: job.try_get(6)?,
        authoritative_delivery,
    }))
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "a malformed checked-in wire fixture must stop this contract test with context"
)]
mod tests {
    use super::*;
    use serde_json::json;

    fn delivery(
        hints_json: &str,
        attempt: &str,
        enqueued_at: &str,
        request_id: &str,
    ) -> ValidatedOcrDelivery {
        let persisted = json!({
            "schemaVersion": "2",
            "jobId": "ocr-job-1",
            "draftId": "ocr-draft-1",
            "sourceImageId": "source-image-1",
            "imageObjectKey": "source-images/ocr-job-1.png",
            "sha256": "ab".repeat(32),
            "byteLength": "68",
            "mediaType": "image/png",
            "requestedScreenType": "total_assets",
            "attempt": attempt,
            "enqueuedAt": enqueued_at,
            "ocrHintsJson": hints_json,
            "requestId": request_id,
        });
        parse_persisted_payload(&persisted)
            .unwrap_or_else(|error| panic!("valid delivery fixture: {error}"))
    }

    #[test]
    fn candidate_requires_the_complete_immutable_outbox_wire_projection() {
        let authoritative = delivery("{}", "1", "2026-08-11T00:00:00Z", "request-1");
        let payload = authoritative.payload();
        let source_image = SourceImageClaims::try_from_payload(payload);
        assert!(source_image.is_some());
        let Some(source_image) = source_image else {
            return;
        };
        let candidate = OcrClaimCandidate {
            draft_id: String::from(payload.draft_id()),
            source_image_id: String::from(payload.source_image_id()),
            source_image,
            width: 1920,
            height: 1080,
            requested_screen_type: payload.requested_screen_type(),
            attempt_count: 0,
            authoritative_delivery: authoritative.clone(),
        };
        assert!(candidate.matches(&authoritative));

        for changed in [
            delivery(
                r#"{"layoutFamily":"world"}"#,
                "1",
                "2026-08-11T00:00:00Z",
                "request-1",
            ),
            delivery("{}", "2", "2026-08-11T00:00:00Z", "request-1"),
            delivery("{}", "1", "2026-08-11T00:00:01Z", "request-1"),
            delivery("{}", "1", "2026-08-11T00:00:00Z", "request-2"),
        ] {
            assert!(!candidate.matches(&changed));
        }
    }
}
