use std::{mem::size_of, time::Duration};

use momo_analysis_core::{canonical, contract::ScopeRef};
use sha2::{Digest, Sha256};
use tokio_postgres::{Client, Transaction};

use super::{
    AttemptMetrics, AttemptOutcome, ClaimedJob, ControlError, RequestOutcome, TransactionEffects,
};

pub(super) async fn lock_owned(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    worker_id: &str,
) -> Result<(), ControlError> {
    let title = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = (SELECT id FROM game_titles WHERE legacy_id=$1) FOR UPDATE",
            &[&claim.game_title_id],
        )
        .await?;
    let job = transaction
        .query_opt(
            "SELECT id FROM series_analysis_jobs WHERE legacy_id = $1 AND status = 'running'\x20\
               AND lease_owner = $2 AND legacy_lease_attempt_id = $3 AND lease_fencing_token = $4\x20\
               AND input_revision = $5 AND algorithm_version = $6\x20\
               AND artifact_schema_version = $7\x20\
               AND validation_contract_id IS NOT DISTINCT FROM $8\x20\
               AND lease_validation_contract_id IS NOT DISTINCT FROM $8\x20\
               AND lease_expires_at > clock_timestamp()\x20\
             FOR UPDATE",
            &[
                &claim.job_id,
                &worker_id,
                &claim.attempt_id,
                &claim.fencing_token,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &claim.validation_contract_id,
            ],
        )
        .await?;
    let attempt = transaction
        .query_opt(
            "SELECT id FROM series_analysis_job_attempts\x20\
             WHERE legacy_id = $1 AND job_id = (SELECT id FROM series_analysis_jobs WHERE legacy_id=$2) AND attempt_no = $3 AND owner = $4\x20\
               AND fencing_token = $5 AND input_revision = $6 AND algorithm_version = $7\x20\
               AND artifact_schema_version = $8\x20\
               AND validation_contract_id IS NOT DISTINCT FROM $9\x20\
               AND status = 'running' FOR UPDATE",
            &[
                &claim.attempt_id,
                &claim.job_id,
                &claim.attempt_no,
                &worker_id,
                &claim.fencing_token,
                &claim.input_revision,
                &claim.algorithm_version,
                &claim.artifact_schema_version,
                &claim.validation_contract_id,
            ],
        )
        .await?;
    if title.is_none() || job.is_none() || attempt.is_none() {
        return Err(ControlError::OwnerLost);
    }
    Ok(())
}

pub(super) async fn finish_attempt(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    outcome: AttemptOutcome,
    metrics: &AttemptMetrics,
) -> Result<(), ControlError> {
    let outcome = outcome.wire();
    let updated = transaction
        .execute(
            "UPDATE series_analysis_job_attempts SET\x20\
               status = 'terminal', outcome = $1, finished_at = clock_timestamp(),\x20\
               elapsed_milliseconds = $2, calculation_milliseconds = $3,\x20\
               staging_milliseconds = $4, publication_milliseconds = $5,\x20\
               child_peak_bytes = $6, worker_peak_bytes = $7\x20\
             WHERE legacy_id = $8 AND status = 'running' AND fencing_token = $9",
            &[
                &outcome,
                &metrics.elapsed_milliseconds,
                &metrics.calculation_milliseconds,
                &metrics.staging_milliseconds,
                &metrics.publication_milliseconds,
                &metrics.child_peak_bytes,
                &metrics.worker_peak_bytes,
                &claim.attempt_id,
                &claim.fencing_token,
            ],
        )
        .await?;
    if updated != 1 {
        return Err(ControlError::OwnerLost);
    }
    Ok(())
}

pub(super) async fn fulfill_requests(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    outcome: RequestOutcome,
) -> Result<(), ControlError> {
    let outcome = outcome.wire();
    transaction
        .execute(
            "UPDATE series_analysis_job_requests SET status = 'fulfilled', fulfilled_at = clock_timestamp()\x20\
             WHERE status = 'assigned' AND legacy_assigned_attempt_id = $1",
            &[&claim.attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t\x20\
             SET status = $1, updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r\x20\
             WHERE t.job_request_id = r.id AND r.legacy_assigned_attempt_id = $2 AND r.status = 'fulfilled'",
            &[&outcome, &claim.attempt_id],
        )
        .await?;
    Ok(())
}

pub(super) async fn schedule_follow_up(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    effects: &mut TransactionEffects,
) -> Result<(), ControlError> {
    if super::radar::materialize_next(transaction, &claim.game_title_id).await? {
        effects.record_series_analysis();
    }
    Ok(())
}

pub(super) async fn refresh_operation_projections(
    transaction: &Transaction<'_>,
    attempt_id: &str,
) -> Result<(), ControlError> {
    let campaign_ids = transaction
        .query(
            "SELECT DISTINCT (SELECT legacy_id FROM series_analysis_campaigns WHERE id=r.campaign_id) FROM series_analysis_job_requests r
             WHERE legacy_assigned_attempt_id = $1 AND campaign_id IS NOT NULL",
            &[&attempt_id],
        )
        .await?
        .iter()
        .map(|row| row.try_get::<_, String>(0))
        .collect::<Result<Vec<_>, _>>()?;
    crate::series_analysis::campaign::refresh(transaction, &campaign_ids).await?;
    transaction
        .execute(
            "UPDATE series_analysis_operation_requests o\x20\
             SET status = 'terminal', finished_at = COALESCE(o.finished_at, clock_timestamp())\x20\
             WHERE o.status <> 'terminal' AND o.scope = 'title'\x20\
               AND EXISTS (\x20\
                 SELECT 1 FROM series_analysis_job_requests changed\x20\
                 WHERE changed.operation_request_id = o.id AND changed.legacy_assigned_attempt_id = $1\x20\
               ) AND NOT EXISTS (\x20\
                 SELECT 1 FROM series_analysis_job_requests pending\x20\
                 WHERE pending.operation_request_id = o.id AND pending.status <> 'fulfilled'\x20\
               )",
            &[&attempt_id],
        )
        .await?;
    Ok(())
}

pub(super) const fn request_scheduler_wake(effects: &mut TransactionEffects) {
    effects.record_series_analysis();
}

pub(super) const fn scope_columns(scope: &ScopeRef) -> (&'static str, Option<&str>, Option<&str>) {
    match scope {
        ScopeRef::Overall => ("overall", None, None),
        ScopeRef::Season { season_master_id } => ("season", Some(season_master_id.as_str()), None),
        ScopeRef::Map { map_master_id } => ("map", None, Some(map_master_id.as_str())),
        ScopeRef::SeasonMap {
            season_master_id,
            map_master_id,
        } => (
            "season_map",
            Some(season_master_id.as_str()),
            Some(map_master_id.as_str()),
        ),
    }
}

pub(super) fn stable_id(prefix: &str, parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update(length_frame(part.len()));
        digest.update(part.as_bytes());
    }
    format!("{prefix}-{}", canonical::lower_hex(&digest.finalize()))
}

const _: () = assert!(
    size_of::<usize>() <= size_of::<u64>(),
    "stable identifier framing requires usize to fit in u64"
);

fn length_frame(length: usize) -> [u8; size_of::<u64>()] {
    let source = length.to_be_bytes();
    let mut frame = [0; size_of::<u64>()];
    let offset = frame.len() - source.len();
    if let Some(target) = frame.get_mut(offset..) {
        target.copy_from_slice(&source);
    }
    frame
}

#[must_use]
pub(crate) fn artifact_id_for_attempt(attempt_id: &str) -> String {
    stable_id("analysis-artifact", &[attempt_id])
}

pub(super) fn duration_milliseconds(duration: Duration) -> Result<i64, ControlError> {
    i64::try_from(duration.as_millis()).map_err(ControlError::from)
}

pub(super) async fn bounded_transaction(
    client: &mut Client,
    timeout: Duration,
) -> Result<Transaction<'_>, ControlError> {
    let transaction = client.transaction().await?;
    let timeout = format!("{}ms", duration_milliseconds(timeout)?);
    transaction
        .query_typed_one(
            "SELECT set_config('statement_timeout', $1, true),\
                    set_config('lock_timeout', $1, true)",
            &[(&timeout, tokio_postgres::types::Type::TEXT)],
        )
        .await?;
    Ok(transaction)
}
