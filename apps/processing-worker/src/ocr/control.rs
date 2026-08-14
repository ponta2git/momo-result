use std::{fmt, time::Duration};

use serde_json::Value as JsonValue;
use thiserror::Error;
use tokio_postgres::{Client, Transaction};

use crate::execution_slot::{
    ExecutionSlotError, ExecutionSlotHolder, ExecutionSlotIdentity, ExecutionTaskKind,
    NewExecutionSlotHolder, SlotAcquisition, SlotRenewal, acquire_ocr, lock as lock_execution_slot,
    lock_owned as lock_owned_slot, release_owned, renew_owned, request_analysis_preemption,
};

use super::contract::{OcrMediaType, OcrQueuePayload, RequestedScreenType};

mod candidate;
mod recovery;

use candidate::{CandidateResult, OcrClaimCandidate, load_candidate};
use recovery::recover_expired_holder;

const MAXIMUM_DRAFT_JSON_BYTES: usize = 512 * 1024;
const MAXIMUM_PROFILE_ID_BYTES: usize = 128;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OcrControlConfig {
    worker_id: String,
    lease_duration: Duration,
    finalization_timeout: Duration,
    retry_delay: Duration,
}

impl OcrControlConfig {
    pub(crate) fn new(
        worker_id: String,
        lease_duration: Duration,
        finalization_timeout: Duration,
        retry_delay: Duration,
    ) -> Result<Self, OcrControlError> {
        if !crate::runtime_identifier::valid(&worker_id)
            || lease_duration.is_zero()
            || finalization_timeout.is_zero()
            || retry_delay.is_zero()
            || finalization_timeout >= lease_duration
        {
            return Err(OcrControlError::InvalidConfiguration);
        }
        Ok(Self {
            worker_id,
            lease_duration,
            finalization_timeout,
            retry_delay,
        })
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ClaimedOcrJob {
    pub(crate) job_id: String,
    pub(crate) draft_id: String,
    pub(crate) source_image_id: String,
    pub(crate) object_key: String,
    pub(crate) sha256: String,
    pub(crate) byte_length: u64,
    pub(crate) media_type: OcrMediaType,
    pub(crate) expected_width: u32,
    pub(crate) expected_height: u32,
    pub(crate) requested_screen_type: RequestedScreenType,
    pub(crate) attempt_id: String,
    lease_token: String,
    pub(crate) attempt_count: i32,
    pub(crate) fencing_token: i64,
}

impl fmt::Debug for ClaimedOcrJob {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClaimedOcrJob")
            .field("job_id", &self.job_id)
            .field("attempt_id", &self.attempt_id)
            .field("attempt_count", &self.attempt_count)
            .field("fencing_token", &self.fencing_token)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum OcrClaimResult {
    Claimed(ClaimedOcrJob),
    Busy,
    PreemptionRequested,
    MissingOrTerminal,
    AlreadyRunning,
    NotYetAvailable,
    UnsupportedQueueSchema,
    QueueContractMismatch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OcrHeartbeatResult {
    Continue,
    OwnerLost,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OcrFailureCode {
    TempImageMissing,
    InvalidImage,
    UnsupportedImageFormat,
    DecodeFailed,
    CategoryUndetected,
    LayoutUnsupported,
    OcrTimeout,
    OcrEngineUnavailable,
    ParserFailed,
    QueueFailure,
}

impl OcrFailureCode {
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::TempImageMissing => "TEMP_IMAGE_MISSING",
            Self::InvalidImage => "INVALID_IMAGE",
            Self::UnsupportedImageFormat => "UNSUPPORTED_IMAGE_FORMAT",
            Self::DecodeFailed => "DECODE_FAILED",
            Self::CategoryUndetected => "CATEGORY_UNDETECTED",
            Self::LayoutUnsupported => "LAYOUT_UNSUPPORTED",
            Self::OcrTimeout => "OCR_TIMEOUT",
            Self::OcrEngineUnavailable => "OCR_ENGINE_UNAVAILABLE",
            Self::ParserFailed => "PARSER_FAILED",
            Self::QueueFailure => "QUEUE_FAILURE",
        }
    }

    pub(crate) const fn retryable(self) -> bool {
        matches!(self, Self::OcrTimeout | Self::OcrEngineUnavailable)
    }

    const fn message(self) -> &'static str {
        match self {
            Self::TempImageMissing => "The OCR source image is unavailable.",
            Self::InvalidImage => "The OCR source image failed integrity validation.",
            Self::UnsupportedImageFormat => "The OCR source image format is unsupported.",
            Self::DecodeFailed => "The OCR source image could not be decoded.",
            Self::CategoryUndetected => "The OCR screen category could not be detected.",
            Self::LayoutUnsupported => "The OCR screen layout is unsupported.",
            Self::OcrTimeout => "OCR processing exceeded its deadline.",
            Self::OcrEngineUnavailable => "The OCR dependency is temporarily unavailable.",
            Self::ParserFailed => "The OCR result could not be parsed safely.",
            Self::QueueFailure => "The OCR queue delivery failed its persisted contract.",
        }
    }

    const fn user_action(self) -> &'static str {
        match self {
            Self::OcrEngineUnavailable | Self::OcrTimeout => {
                "しばらく待ってからOCRをやり直してください。"
            }
            Self::QueueFailure => "運用担当者に連絡してください。",
            Self::TempImageMissing
            | Self::InvalidImage
            | Self::UnsupportedImageFormat
            | Self::DecodeFailed
            | Self::CategoryUndetected
            | Self::LayoutUnsupported
            | Self::ParserFailed => "画像を確認してOCRをやり直してください。",
        }
    }
}

pub(crate) struct OcrDraftCompletion {
    pub(crate) detected_screen_type: RequestedScreenType,
    pub(crate) profile_id: Option<String>,
    pub(crate) payload: JsonValue,
    pub(crate) warnings: JsonValue,
    pub(crate) timings_milliseconds: JsonValue,
    pub(crate) duration_milliseconds: i32,
}

#[derive(Debug, Error)]
pub(crate) enum OcrControlError {
    #[error("OCR PostgreSQL state transition failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("OCR shared execution-slot transition failed: {0}")]
    ExecutionSlot(&'static str),
    #[error("OCR could not recover an expired analysis holder: {0}")]
    AnalysisRecovery(&'static str),
    #[error("OCR worker lost its fenced ownership")]
    OwnerLost,
    #[error("OCR control-plane numeric value exceeds its supported bound")]
    NumericBound,
    #[error("OCR persisted state violates its closed contract")]
    InvalidState,
    #[error("OCR control-plane configuration is unsafe")]
    InvalidConfiguration,
    #[error("OCR completion payload violates its bounded shape")]
    InvalidCompletion,
}

impl From<ExecutionSlotError> for OcrControlError {
    fn from(error: ExecutionSlotError) -> Self {
        Self::ExecutionSlot(error.kind())
    }
}

impl OcrControlError {
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Postgres(_) => "ocr_postgres_transition",
            Self::ExecutionSlot(kind) | Self::AnalysisRecovery(kind) => kind,
            Self::OwnerLost => "ocr_fencing_owner_lost",
            Self::NumericBound => "ocr_numeric_bound",
            Self::InvalidState => "ocr_persisted_state",
            Self::InvalidConfiguration => "ocr_control_configuration",
            Self::InvalidCompletion => "ocr_completion_contract",
        }
    }
}

pub(crate) async fn claim_job(
    client: &mut Client,
    payload: &OcrQueuePayload,
    config: &OcrControlConfig,
) -> Result<OcrClaimResult, OcrControlError> {
    let transaction = bounded_transaction(client, config.finalization_timeout).await?;
    let slot = lock_execution_slot(&transaction).await?;
    if let Some(holder) = &slot.holder
        && holder.expired
    {
        recover_expired_holder(&transaction, holder).await?;
    }

    let candidate = match load_candidate(&transaction, payload.job_id()).await? {
        CandidateResult::Ready(candidate) => candidate,
        CandidateResult::Rejected(result) => {
            transaction.rollback().await?;
            return Ok(result);
        }
        CandidateResult::InvalidPersistedContract => {
            fail_locked_queued_job(
                &transaction,
                payload.job_id(),
                OcrFailureCode::QueueFailure,
                0,
            )
            .await?;
            transaction.commit().await?;
            return Ok(OcrClaimResult::QueueContractMismatch);
        }
    };
    if !candidate.matches(payload) {
        fail_locked_queued_job(
            &transaction,
            payload.job_id(),
            OcrFailureCode::QueueFailure,
            0,
        )
        .await?;
        transaction.commit().await?;
        return Ok(OcrClaimResult::QueueContractMismatch);
    }

    if let Some(holder) = &slot.holder
        && !holder.expired
    {
        return handle_active_holder(transaction, &slot, holder, config).await;
    }

    acquire_candidate(transaction, slot.fencing_token, payload, candidate, config).await
}

async fn acquire_candidate(
    transaction: Transaction<'_>,
    slot_fencing_token: i64,
    payload: &OcrQueuePayload,
    candidate: OcrClaimCandidate,
    config: &OcrControlConfig,
) -> Result<OcrClaimResult, OcrControlError> {
    let (attempt_id, lease_token) = new_lease_identity(&transaction).await?;
    let lease_milliseconds = duration_milliseconds(config.lease_duration)?;
    let fencing_token = match acquire_ocr(
        &transaction,
        slot_fencing_token,
        NewExecutionSlotHolder {
            owner: &config.worker_id,
            job_id: payload.job_id(),
            attempt_id: &attempt_id,
        },
        lease_milliseconds,
    )
    .await?
    {
        SlotAcquisition::Acquired(fencing_token) => fencing_token,
        SlotAcquisition::Busy => {
            transaction.rollback().await?;
            return Ok(OcrClaimResult::Busy);
        }
    };
    let attempt_count = candidate
        .attempt_count
        .checked_add(1)
        .ok_or(OcrControlError::NumericBound)?;
    let updated = transaction
        .query_opt(
            "UPDATE ocr_jobs SET status = 'running', worker_id = $1, attempt_count = $2,\x20\
               started_at = clock_timestamp(), finished_at = NULL, duration_ms = NULL,\x20\
               failure_code = NULL, failure_message = NULL, failure_retryable = NULL,\x20\
               failure_user_action = NULL, attempt_id = $3::text::uuid, lease_owner = $1,\x20\
               lease_token = $4::text::uuid,\x20\
               lease_expires_at = clock_timestamp() + ($5::bigint * interval '1 millisecond'),\x20\
               lease_fencing_token = $6, updated_at = clock_timestamp()\x20\
             WHERE id = $7 AND status = 'queued' AND queue_schema_version = 2\x20\
               AND available_at <= clock_timestamp() RETURNING attempt_count",
            &[
                &config.worker_id,
                &attempt_count,
                &attempt_id,
                &lease_token,
                &lease_milliseconds,
                &fencing_token,
                &payload.job_id(),
            ],
        )
        .await?;
    if updated
        .as_ref()
        .map(|row| row.try_get::<_, i32>(0))
        .transpose()?
        != Some(attempt_count)
    {
        return Err(OcrControlError::OwnerLost);
    }
    transaction.commit().await?;
    Ok(OcrClaimResult::Claimed(ClaimedOcrJob {
        job_id: String::from(payload.job_id()),
        draft_id: candidate.draft_id,
        source_image_id: candidate.source_image_id,
        object_key: candidate.object_key,
        sha256: candidate.sha256,
        byte_length: candidate.byte_length,
        media_type: candidate.media_type,
        expected_width: candidate.width,
        expected_height: candidate.height,
        requested_screen_type: candidate.requested_screen_type,
        attempt_id,
        lease_token,
        attempt_count,
        fencing_token,
    }))
}

async fn handle_active_holder(
    transaction: Transaction<'_>,
    slot: &crate::execution_slot::LockedExecutionSlot,
    holder: &ExecutionSlotHolder,
    config: &OcrControlConfig,
) -> Result<OcrClaimResult, OcrControlError> {
    if holder.task_kind != ExecutionTaskKind::Analysis {
        transaction.rollback().await?;
        return Ok(OcrClaimResult::Busy);
    }
    if slot.preempt_requested_by.is_some() {
        transaction.rollback().await?;
        return Ok(OcrClaimResult::Busy);
    }
    if request_analysis_preemption(&transaction, holder, &config.worker_id).await? {
        transaction.commit().await?;
        Ok(OcrClaimResult::PreemptionRequested)
    } else {
        transaction.rollback().await?;
        Ok(OcrClaimResult::Busy)
    }
}

pub(crate) async fn heartbeat(
    client: &mut Client,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
) -> Result<OcrHeartbeatResult, OcrControlError> {
    let transaction = bounded_transaction(client, config.finalization_timeout).await?;
    let lease_milliseconds = duration_milliseconds(config.lease_duration)?;
    let renewal = renew_owned(&transaction, identity(claim, config), lease_milliseconds).await?;
    if renewal != SlotRenewal::Continue {
        transaction.rollback().await?;
        return Ok(OcrHeartbeatResult::OwnerLost);
    }
    let updated = transaction
        .execute(
            "UPDATE ocr_jobs SET\x20\
               lease_expires_at = clock_timestamp() + ($1::bigint * interval '1 millisecond'),\x20\
               updated_at = clock_timestamp()\x20\
             WHERE id = $2 AND status = 'running' AND lease_owner = $3\x20\
               AND attempt_id = $4::text::uuid AND lease_token = $5::text::uuid\x20\
               AND lease_fencing_token = $6 AND lease_expires_at > clock_timestamp()",
            &[
                &lease_milliseconds,
                &claim.job_id,
                &config.worker_id,
                &claim.attempt_id,
                &claim.lease_token,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        transaction.rollback().await?;
        return Ok(OcrHeartbeatResult::OwnerLost);
    }
    transaction.commit().await?;
    Ok(OcrHeartbeatResult::Continue)
}

pub(crate) async fn finish_success(
    client: &mut Client,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
    completion: &OcrDraftCompletion,
) -> Result<(), OcrControlError> {
    validate_completion(completion)?;
    let transaction = bounded_transaction(client, config.finalization_timeout).await?;
    lock_owned_job(&transaction, claim, config).await?;
    let requested_screen_type = claim.requested_screen_type.wire();
    let detected_screen_type = completion.detected_screen_type.wire();
    transaction
        .execute(
            "INSERT INTO ocr_drafts (id, job_id, requested_screen_type, detected_screen_type,\x20\
               profile_id, payload_json, warnings_json, timings_ms_json, created_at, updated_at)\x20\
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp(), clock_timestamp())\x20\
             ON CONFLICT (job_id) DO UPDATE SET id = EXCLUDED.id,\x20\
               requested_screen_type = EXCLUDED.requested_screen_type,\x20\
               detected_screen_type = EXCLUDED.detected_screen_type,\x20\
               profile_id = EXCLUDED.profile_id, payload_json = EXCLUDED.payload_json,\x20\
               warnings_json = EXCLUDED.warnings_json,\x20\
               timings_ms_json = EXCLUDED.timings_ms_json, updated_at = clock_timestamp()",
            &[
                &claim.draft_id,
                &claim.job_id,
                &requested_screen_type,
                &detected_screen_type,
                &completion.profile_id,
                &completion.payload,
                &completion.warnings,
                &completion.timings_milliseconds,
            ],
        )
        .await?;
    let updated = transaction
        .execute(
            "UPDATE ocr_jobs SET status = 'succeeded', detected_screen_type = $1,\x20\
               failure_code = NULL, failure_message = NULL, failure_retryable = NULL,\x20\
               failure_user_action = NULL, finished_at = clock_timestamp(), duration_ms = $2,\x20\
               attempt_id = NULL, lease_owner = NULL, lease_token = NULL,\x20\
               lease_expires_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE id = $3 AND status = 'running' AND lease_owner = $4\x20\
               AND attempt_id = $5::text::uuid AND lease_token = $6::text::uuid\x20\
               AND lease_fencing_token = $7",
            &[
                &detected_screen_type,
                &completion.duration_milliseconds,
                &claim.job_id,
                &config.worker_id,
                &claim.attempt_id,
                &claim.lease_token,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(OcrControlError::OwnerLost);
    }
    sync_match_draft_status(&transaction, &claim.job_id).await?;
    release_slot(&transaction, claim, config).await?;
    transaction.commit().await?;
    Ok(())
}

pub(crate) async fn finish_failure(
    client: &mut Client,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
    failure: OcrFailureCode,
    duration_milliseconds: i32,
) -> Result<(), OcrControlError> {
    if duration_milliseconds < 0 {
        return Err(OcrControlError::NumericBound);
    }
    let transaction = bounded_transaction(client, config.finalization_timeout).await?;
    lock_owned_job(&transaction, claim, config).await?;
    update_owned_failure(&transaction, claim, config, failure, duration_milliseconds).await?;
    sync_match_draft_status(&transaction, &claim.job_id).await?;
    release_slot(&transaction, claim, config).await?;
    transaction.commit().await?;
    Ok(())
}

pub(crate) async fn requeue_transient(
    client: &mut Client,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
) -> Result<(), OcrControlError> {
    let transaction = bounded_transaction(client, config.finalization_timeout).await?;
    lock_owned_job(&transaction, claim, config).await?;
    let retry_delay_milliseconds = duration_milliseconds(config.retry_delay)?;
    let updated = transaction
        .execute(
            "UPDATE ocr_jobs SET status = 'queued', worker_id = NULL, available_at =\x20\
               clock_timestamp() + ($1::bigint * interval '1 millisecond'), started_at = NULL,\x20\
               finished_at = NULL, duration_ms = NULL, failure_code = NULL, failure_message = NULL,\x20\
               failure_retryable = NULL, failure_user_action = NULL, attempt_id = NULL,\x20\
               lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,\x20\
               updated_at = clock_timestamp() WHERE id = $2 AND status = 'running'\x20\
               AND lease_owner = $3 AND attempt_id = $4::text::uuid\x20\
               AND lease_token = $5::text::uuid\x20\
               AND lease_fencing_token = $6",
            &[
                &retry_delay_milliseconds,
                &claim.job_id,
                &config.worker_id,
                &claim.attempt_id,
                &claim.lease_token,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(OcrControlError::OwnerLost);
    }
    release_slot(&transaction, claim, config).await?;
    transaction.commit().await?;
    Ok(())
}

pub(crate) async fn record_queue_failure(
    client: &mut Client,
    job_id: &str,
    finalization_timeout: Duration,
) -> Result<(), OcrControlError> {
    let transaction = bounded_transaction(client, finalization_timeout).await?;
    let row = transaction
        .query_opt(
            "SELECT status, queue_schema_version FROM ocr_jobs WHERE id = $1 FOR UPDATE",
            &[&job_id],
        )
        .await?;
    let Some(row) = row else {
        transaction.rollback().await?;
        return Ok(());
    };
    let status = row.try_get::<_, String>(0)?;
    let schema_version = row.try_get::<_, i16>(1)?;
    if status != "queued" || schema_version != 2 {
        transaction.rollback().await?;
        return Ok(());
    }
    fail_locked_queued_job(&transaction, job_id, OcrFailureCode::QueueFailure, 0).await?;
    transaction.commit().await?;
    Ok(())
}

async fn new_lease_identity(
    transaction: &Transaction<'_>,
) -> Result<(String, String), OcrControlError> {
    let row = transaction
        .query_one(
            "SELECT gen_random_uuid()::text, gen_random_uuid()::text",
            &[],
        )
        .await?;
    Ok((row.try_get(0)?, row.try_get(1)?))
}

async fn lock_owned_job(
    transaction: &Transaction<'_>,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
) -> Result<(), OcrControlError> {
    if !lock_owned_slot(transaction, identity(claim, config)).await? {
        return Err(OcrControlError::OwnerLost);
    }
    let job = transaction
        .query_opt(
            "SELECT 1 FROM ocr_jobs WHERE id = $1 AND status = 'running' AND lease_owner = $2\x20\
               AND attempt_id = $3::text::uuid AND lease_token = $4::text::uuid\x20\
               AND lease_fencing_token = $5 AND lease_expires_at > clock_timestamp() FOR UPDATE",
            &[
                &claim.job_id,
                &config.worker_id,
                &claim.attempt_id,
                &claim.lease_token,
                &claim.fencing_token,
            ],
        )
        .await?;
    if job.is_none() {
        return Err(OcrControlError::OwnerLost);
    }
    Ok(())
}

async fn release_slot(
    transaction: &Transaction<'_>,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
) -> Result<(), OcrControlError> {
    if !release_owned(transaction, identity(claim, config)).await? {
        return Err(OcrControlError::OwnerLost);
    }
    Ok(())
}

fn identity<'a>(
    claim: &'a ClaimedOcrJob,
    config: &'a OcrControlConfig,
) -> ExecutionSlotIdentity<'a> {
    ExecutionSlotIdentity {
        task_kind: ExecutionTaskKind::Ocr,
        owner: &config.worker_id,
        job_id: &claim.job_id,
        attempt_id: &claim.attempt_id,
        fencing_token: claim.fencing_token,
    }
}

async fn update_owned_failure(
    transaction: &Transaction<'_>,
    claim: &ClaimedOcrJob,
    config: &OcrControlConfig,
    failure: OcrFailureCode,
    duration_milliseconds: i32,
) -> Result<(), OcrControlError> {
    let code = failure.wire();
    let message = failure.message();
    let retryable = failure.retryable();
    let user_action = failure.user_action();
    let updated = transaction
        .execute(
            "UPDATE ocr_jobs SET status = 'failed', failure_code = $1, failure_message = $2,\x20\
               failure_retryable = $3, failure_user_action = $4, finished_at = clock_timestamp(),\x20\
               duration_ms = $5, attempt_id = NULL, lease_owner = NULL, lease_token = NULL,\x20\
               lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = $6\x20\
               AND status = 'running' AND lease_owner = $7 AND attempt_id = $8::text::uuid\x20\
               AND lease_token = $9::text::uuid AND lease_fencing_token = $10",
            &[
                &code,
                &message,
                &retryable,
                &user_action,
                &duration_milliseconds,
                &claim.job_id,
                &config.worker_id,
                &claim.attempt_id,
                &claim.lease_token,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(OcrControlError::OwnerLost);
    }
    Ok(())
}

async fn fail_locked_queued_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    failure: OcrFailureCode,
    duration_milliseconds: i32,
) -> Result<(), OcrControlError> {
    let code = failure.wire();
    let message = failure.message();
    let retryable = failure.retryable();
    let user_action = failure.user_action();
    let updated = transaction
        .execute(
            "UPDATE ocr_jobs SET status = 'failed', failure_code = $1, failure_message = $2,\x20\
               failure_retryable = $3, failure_user_action = $4, finished_at = clock_timestamp(),\x20\
               duration_ms = $5, updated_at = clock_timestamp()\x20\
             WHERE id = $6 AND status = 'queued' AND queue_schema_version = 2",
            &[
                &code,
                &message,
                &retryable,
                &user_action,
                &duration_milliseconds,
                &job_id,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(OcrControlError::OwnerLost);
    }
    sync_match_draft_status(transaction, job_id).await
}

async fn sync_match_draft_status(
    transaction: &Transaction<'_>,
    job_id: &str,
) -> Result<(), OcrControlError> {
    transaction
        .execute(
            "WITH touched AS (\x20\
               SELECT md.id FROM match_drafts md JOIN ocr_jobs j ON j.id = $1\x20\
               WHERE md.status = 'ocr_running' AND j.draft_id IN (\x20\
                 md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id\x20\
               )\x20\
             ), slot_jobs AS (\x20\
               SELECT md.id AS match_draft_id, j.status AS job_status,\x20\
                 COALESCE(jsonb_array_length(od.warnings_json), 0) AS warning_count\x20\
               FROM match_drafts md JOIN touched t ON t.id = md.id\x20\
               JOIN LATERAL unnest(ARRAY[md.total_assets_draft_id, md.revenue_draft_id,\x20\
                 md.incident_log_draft_id]) AS slot(ocr_draft_id) ON slot.ocr_draft_id IS NOT NULL\x20\
               LEFT JOIN ocr_jobs j ON j.draft_id = slot.ocr_draft_id\x20\
               LEFT JOIN ocr_drafts od ON od.id = slot.ocr_draft_id\x20\
             ), next_status AS (\x20\
               SELECT match_draft_id, CASE\x20\
                 WHEN COUNT(*) FILTER (WHERE job_status IN ('queued', 'running')\x20\
                   OR job_status IS NULL) > 0 THEN 'ocr_running'\x20\
                 WHEN COUNT(*) FILTER (WHERE job_status IN ('failed', 'cancelled')) > 0\x20\
                   THEN 'ocr_failed'\x20\
                 WHEN COUNT(*) FILTER (WHERE warning_count > 0) > 0 THEN 'needs_review'\x20\
                 ELSE 'draft_ready' END AS status\x20\
               FROM slot_jobs GROUP BY match_draft_id\x20\
             ) UPDATE match_drafts md SET status = ns.status, updated_at = clock_timestamp()\x20\
               FROM next_status ns WHERE md.id = ns.match_draft_id\x20\
                 AND md.status = 'ocr_running' AND md.status <> ns.status",
            &[&job_id],
        )
        .await?;
    Ok(())
}

fn validate_completion(completion: &OcrDraftCompletion) -> Result<(), OcrControlError> {
    let profile_valid = completion.profile_id.as_deref().is_none_or(|profile| {
        !profile.is_empty()
            && profile.len() <= MAXIMUM_PROFILE_ID_BYTES
            && profile.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    });
    let encoded_bytes = [
        &completion.payload,
        &completion.warnings,
        &completion.timings_milliseconds,
    ]
    .into_iter()
    .try_fold(0_usize, |total, value| {
        serde_json::to_vec(value)
            .ok()
            .and_then(|encoded| total.checked_add(encoded.len()))
    });
    if completion.payload.is_object()
        && completion.warnings.is_array()
        && completion.timings_milliseconds.is_object()
        && completion.duration_milliseconds >= 0
        && profile_valid
        && encoded_bytes.is_some_and(|bytes| bytes <= MAXIMUM_DRAFT_JSON_BYTES)
    {
        Ok(())
    } else {
        Err(OcrControlError::InvalidCompletion)
    }
}

async fn bounded_transaction(
    client: &mut Client,
    timeout: Duration,
) -> Result<Transaction<'_>, OcrControlError> {
    let transaction = client.transaction().await?;
    let timeout = format!("{}ms", duration_milliseconds(timeout)?);
    transaction
        .query_one(
            "SELECT set_config('statement_timeout', $1, true),\x20\
                    set_config('lock_timeout', $1, true)",
            &[&timeout],
        )
        .await?;
    Ok(transaction)
}

fn duration_milliseconds(duration: Duration) -> Result<i64, OcrControlError> {
    i64::try_from(duration.as_millis()).map_err(|_conversion_error| OcrControlError::NumericBound)
}

#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod tests;
