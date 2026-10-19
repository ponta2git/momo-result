use tokio_postgres::{Row, Transaction};

use super::{OcrClaimResult, OcrControlError};
use crate::ocr::contract::{
    OcrMediaType, RequestedScreenType, SourceImageClaims, ValidatedOcrInput,
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
    pub(super) input: ValidatedOcrInput,
}

impl OcrClaimCandidate {
    pub(super) fn matches(&self) -> bool {
        let payload = self.input.payload();
        self.draft_id == payload.draft_id()
            && self.source_image_id == payload.source_image_id()
            && self.source_image.object_key() == payload.image_object_key()
            && self.source_image.sha256() == payload.sha256()
            && self.source_image.byte_length() == payload.byte_length()
            && self.source_image.media_type() == payload.media_type()
            && self.requested_screen_type == payload.requested_screen_type()
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
                    available_at <= clock_timestamp(), input_snapshot, attempt_count\x20\
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
    let grouped = transaction
        .query_opt(
            "SELECT 1 FROM ocr_submission_members WHERE job_id = $1 AND status = 'registered' AND screen_type = $2",
            &[&job_id, &job.try_get::<_, String>(2)?],
        )
        .await?;
    if grouped.is_none() {
        return Err(OcrControlError::InvalidState);
    }
    if status == "running" {
        return Ok(CandidateResult::Rejected(OcrClaimResult::AlreadyRunning));
    }
    if status != "queued" {
        return Err(OcrControlError::InvalidState);
    }
    if !job.try_get::<_, bool>(4)? {
        return Ok(CandidateResult::Rejected(OcrClaimResult::NotYetAvailable));
    }
    let Some(source_image_id) = job.try_get::<_, Option<String>>(1)? else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let source = transaction
        .query_opt(
            "SELECT image.status, image.object_key, image.sha256_hex, image.byte_length,\x20\
                    image.media_type, image.width, image.height\x20\
             FROM source_images image\x20\
             WHERE image.id = $1 FOR UPDATE OF image",
            &[&source_image_id],
        )
        .await?;
    let Some(source) = source else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let Some(snapshot) = job.try_get::<_, Option<serde_json::Value>>(5)? else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let Ok(authoritative_input) = parse_persisted_payload(&snapshot) else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    let Some(candidate) = decode_candidate(&job, source_image_id, &source, authoritative_input)?
    else {
        return Ok(CandidateResult::InvalidPersistedContract);
    };
    if candidate.input.payload().job_id() != job_id || !candidate.matches() {
        return Ok(CandidateResult::InvalidPersistedContract);
    }
    Ok(CandidateResult::Ready(candidate))
}

fn decode_candidate(
    job: &Row,
    source_image_id: String,
    source: &Row,
    input: ValidatedOcrInput,
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
        input,
    }))
}

#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    reason = "fixture setup errors use Result while assertions describe the input boundary"
)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn candidate_requires_snapshot_and_source_image_to_agree()
    -> Result<(), Box<dyn std::error::Error>> {
        let snapshot = json!({"schemaVersion":"2","jobId":"ocr-job-1","draftId":"ocr-draft-1","sourceImageId":"source-image-1","imageObjectKey":"source-images/ocr-job-1.png","sha256":"ab".repeat(32),"byteLength":"68","mediaType":"image/png","requestedScreenType":"total_assets"});
        let input = parse_persisted_payload(&snapshot)?;
        let payload = input.payload();
        let source_image =
            SourceImageClaims::try_from_payload(payload).ok_or("invalid fixture image claims")?;
        let mut candidate = OcrClaimCandidate {
            draft_id: payload.draft_id().to_owned(),
            source_image_id: payload.source_image_id().to_owned(),
            source_image,
            width: 1920,
            height: 1080,
            requested_screen_type: payload.requested_screen_type(),
            attempt_count: 0,
            input,
        };
        assert!(candidate.matches());
        candidate.source_image_id = "different-source".into();
        assert!(!candidate.matches());
        candidate.source_image_id = "source-image-1".into();
        candidate.draft_id = "different-draft".into();
        assert!(!candidate.matches());
        Ok(())
    }
}
