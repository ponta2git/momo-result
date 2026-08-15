use std::{mem::size_of, time::Duration};

use momo_analysis_core::{canonical, contract::ScopeRef};
use sha2::{Digest, Sha256};
use tokio_postgres::{Client, Transaction};

use crate::{
    execution_slot::{
        ExecutionSlotIdentity, ExecutionTaskKind, lock_owned as lock_owned_slot,
        release_owned as release_owned_slot,
    },
    series_analysis::config::AnalysisConsumerConfig,
};

use super::{
    AttemptMetrics, AttemptOutcome, ClaimedJob, ControlError, DeliveryReason, RequestOutcome,
    TransactionEffects,
};

pub(super) async fn lock_owned(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
) -> Result<(), ControlError> {
    lock_owned_by(transaction, claim, &config.worker_id).await
}

pub(super) async fn lock_owned_by(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    worker_id: &str,
) -> Result<(), ControlError> {
    let identity = ExecutionSlotIdentity {
        task_kind: ExecutionTaskKind::Analysis,
        owner: worker_id,
        job_id: &claim.job_id,
        attempt_id: &claim.attempt_id,
        fencing_token: claim.fencing_token,
    };
    if !lock_owned_slot(transaction, identity).await? {
        return Err(ControlError::OwnerLost);
    }
    let title = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE",
            &[&claim.game_title_id],
        )
        .await?;
    let job = transaction
        .query_opt(
            "SELECT id FROM series_analysis_jobs WHERE id = $1 AND status = 'running'\x20\
               AND lease_owner = $2 AND lease_attempt_id = $3 AND lease_fencing_token = $4\x20\
               AND lease_expires_at > clock_timestamp()\x20\
             FOR UPDATE",
            &[
                &claim.job_id,
                &worker_id,
                &claim.attempt_id,
                &claim.fencing_token,
            ],
        )
        .await?;
    let attempt = transaction
        .query_opt(
            "SELECT id FROM series_analysis_job_attempts\x20\
             WHERE id = $1 AND job_id = $2 AND attempt_no = $3 AND owner = $4\x20\
               AND fencing_token = $5 AND status = 'running' FOR UPDATE",
            &[
                &claim.attempt_id,
                &claim.job_id,
                &claim.attempt_no,
                &worker_id,
                &claim.fencing_token,
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
             WHERE id = $8 AND status = 'running' AND fencing_token = $9",
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
             WHERE status = 'assigned' AND assigned_attempt_id = $1",
            &[&claim.attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t\x20\
             SET status = $1, updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r\x20\
             WHERE t.job_request_id = r.id AND r.assigned_attempt_id = $2 AND r.status = 'fulfilled'",
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
    let pending = transaction
        .query_opt(
            "SELECT id, trigger FROM series_analysis_job_requests\x20\
             WHERE game_title_id = $1 AND status = 'pending'\x20\
             ORDER BY accepted_at, id LIMIT 1 FOR UPDATE",
            &[&claim.game_title_id],
        )
        .await?;
    let Some(pending) = pending else {
        return Ok(());
    };
    let request_id = pending.try_get::<_, String>(0)?;
    let trigger = pending.try_get::<_, String>(1)?;
    let desired = transaction
        .query_one(
            "SELECT input_revision, algorithm_version, artifact_schema_version\x20\
             FROM series_analysis_title_states WHERE game_title_id = $1",
            &[&claim.game_title_id],
        )
        .await?;
    let desired_revision = desired.try_get::<_, i64>(0)?;
    let desired_algorithm = desired.try_get::<_, String>(1)?;
    let desired_schema = desired.try_get::<_, i32>(2)?;
    let next_job_id = stable_id(
        "analysis-job-followup",
        &[&claim.game_title_id, &request_id],
    );
    transaction
        .execute(
            "INSERT INTO series_analysis_jobs (id, game_title_id, input_revision,\x20\
               algorithm_version, artifact_schema_version, status, trigger, requested_at, available_at)\x20\
             VALUES ($1,$2,$3,$4,$5,'queued',$6,clock_timestamp(),clock_timestamp())",
            &[
                &next_job_id,
                &claim.game_title_id,
                &desired_revision,
                &desired_algorithm,
                &desired_schema,
                &trigger,
            ],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_job_requests SET assigned_job_id = $1, assigned_attempt_id = NULL\x20\
             WHERE game_title_id = $2 AND status = 'pending'",
            &[&next_job_id, &claim.game_title_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_title_states SET pending_work = true,\x20\
               pending_forced_run_count = 0, updated_at = clock_timestamp()\x20\
             WHERE game_title_id = $1",
            &[&claim.game_title_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_campaign_targets t SET status = 'expanded', updated_at = clock_timestamp()\x20\
             FROM series_analysis_job_requests r\x20\
             WHERE t.job_request_id = r.id AND r.assigned_job_id = $1",
            &[&next_job_id],
        )
        .await?;
    enqueue_delivery(
        transaction,
        &next_job_id,
        DeliveryReason::FollowUp,
        0,
        effects,
    )
    .await
}

pub(super) async fn refresh_operation_projections(
    transaction: &Transaction<'_>,
    attempt_id: &str,
) -> Result<(), ControlError> {
    transaction
        .execute(
            "WITH affected_campaigns AS (\x20\
               SELECT DISTINCT campaign_id FROM series_analysis_job_requests\x20\
               WHERE assigned_attempt_id = $1 AND campaign_id IS NOT NULL\x20\
             ), counts AS (\x20\
               SELECT t.campaign_id,\x20\
                 COUNT(*) FILTER (WHERE t.status <> 'pending')::int AS expanded_count,\x20\
                 COUNT(*) FILTER (WHERE t.status IN ('succeeded','failed','skipped_title_deleted'))::int AS terminal_count,\x20\
                 COUNT(*) FILTER (WHERE t.status = 'failed')::int AS failed_count,\x20\
                 COUNT(*) FILTER (WHERE t.status = 'skipped_title_deleted')::int AS skipped_count\x20\
               FROM series_analysis_campaign_targets t\x20\
               JOIN affected_campaigns a ON a.campaign_id = t.campaign_id\x20\
               GROUP BY t.campaign_id\x20\
             )\x20\
             UPDATE series_analysis_campaigns c SET\x20\
               expanded_count = counts.expanded_count, terminal_count = counts.terminal_count,\x20\
               failed_count = counts.failed_count, skipped_count = counts.skipped_count,\x20\
               status = CASE\x20\
                 WHEN counts.terminal_count = c.target_count THEN 'terminal'\x20\
                 WHEN counts.expanded_count = c.target_count THEN 'running'\x20\
                 ELSE 'expanding'\x20\
               END,\x20\
               finished_at = CASE\x20\
                 WHEN counts.terminal_count = c.target_count\x20\
                   THEN COALESCE(c.finished_at, clock_timestamp())\x20\
                 ELSE NULL\x20\
               END\x20\
             FROM counts WHERE c.id = counts.campaign_id",
            &[&attempt_id],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_operation_requests o\x20\
             SET status = 'terminal', finished_at = COALESCE(o.finished_at, clock_timestamp())\x20\
             WHERE o.status <> 'terminal' AND (\x20\
               (o.scope = 'title' AND EXISTS (\x20\
                  SELECT 1 FROM series_analysis_job_requests changed\x20\
                  WHERE changed.operation_request_id = o.id AND changed.assigned_attempt_id = $1\x20\
                ) AND NOT EXISTS (\x20\
                  SELECT 1 FROM series_analysis_job_requests pending\x20\
                  WHERE pending.operation_request_id = o.id AND pending.status <> 'fulfilled'\x20\
                ))\x20\
               OR (o.scope = 'all_titles' AND EXISTS (\x20\
                  SELECT 1 FROM series_analysis_campaigns c\x20\
                  JOIN series_analysis_job_requests changed ON changed.campaign_id = c.id\x20\
                  WHERE c.operation_request_id = o.id AND c.status = 'terminal'\x20\
                    AND changed.assigned_attempt_id = $1\x20\
                ))\x20\
             )",
            &[&attempt_id],
        )
        .await?;
    Ok(())
}

pub(super) async fn release_slot(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
) -> Result<(), ControlError> {
    release_slot_by(transaction, claim, &config.worker_id).await
}

pub(super) async fn release_slot_by(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
    worker_id: &str,
) -> Result<(), ControlError> {
    let identity = ExecutionSlotIdentity {
        task_kind: ExecutionTaskKind::Analysis,
        owner: worker_id,
        job_id: &claim.job_id,
        attempt_id: &claim.attempt_id,
        fencing_token: claim.fencing_token,
    };
    if !release_owned_slot(transaction, identity).await? {
        return Err(ControlError::OwnerLost);
    }
    Ok(())
}

pub(super) async fn enqueue_delivery(
    transaction: &Transaction<'_>,
    job_id: &str,
    reason: DeliveryReason,
    sequence: i32,
    effects: &mut TransactionEffects,
) -> Result<(), ControlError> {
    let reason = reason.wire();
    let sequence = sequence.to_string();
    let id = stable_id("analysis-outbox", &[job_id, reason, &sequence]);
    let dedupe = format!("{job_id}:{reason}:{sequence}");
    transaction
        .execute(
            "INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key)\x20\
             VALUES ($1,$2,$3) ON CONFLICT (dedupe_key) DO NOTHING",
            &[&id, &job_id, &dedupe],
        )
        .await?;
    effects.record_series_analysis();
    Ok(())
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
        .query_one(
            "SELECT set_config('statement_timeout', $1, true),\
                    set_config('lock_timeout', $1, true)",
            &[&timeout],
        )
        .await?;
    Ok(transaction)
}
