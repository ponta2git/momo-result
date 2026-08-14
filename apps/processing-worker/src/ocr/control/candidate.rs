use tokio_postgres::{Row, Transaction};

use super::{OcrClaimResult, OcrControlError};
use crate::ocr::contract::{OcrMediaType, OcrQueuePayload, RequestedScreenType};

pub(super) struct OcrClaimCandidate {
    pub(super) draft_id: String,
    pub(super) source_image_id: String,
    pub(super) object_key: String,
    pub(super) sha256: String,
    pub(super) byte_length: u64,
    pub(super) media_type: OcrMediaType,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) requested_screen_type: RequestedScreenType,
    pub(super) attempt_count: i32,
}

impl OcrClaimCandidate {
    pub(super) fn matches(&self, payload: &OcrQueuePayload) -> bool {
        self.draft_id == payload.draft_id()
            && self.source_image_id == payload.source_image_id()
            && self.object_key == payload.image_object_key()
            && self.sha256 == payload.sha256()
            && self.byte_length == payload.byte_length()
            && self.media_type == payload.media_type()
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
    Ok(decode_candidate(&job, source_image_id, &source)?.map_or(
        CandidateResult::InvalidPersistedContract,
        CandidateResult::Ready,
    ))
}

fn decode_candidate(
    job: &Row,
    source_image_id: String,
    source: &Row,
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
    if byte_length == 0 || width == 0 || height == 0 || width > 1920 || height > 1080 {
        return Ok(None);
    }
    Ok(Some(OcrClaimCandidate {
        draft_id: job.try_get(0)?,
        source_image_id,
        object_key: source.try_get(1)?,
        sha256: source.try_get(2)?,
        byte_length,
        media_type,
        width,
        height,
        requested_screen_type,
        attempt_count: job.try_get(6)?,
    }))
}
