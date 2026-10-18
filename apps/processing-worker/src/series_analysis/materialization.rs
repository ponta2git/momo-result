//! Materializes accepted campaign work; job rows are the durable execution queue.
use sha2::{Digest, Sha256};
use std::time::SystemTime;
use thiserror::Error;
use tokio_postgres::{Row, Transaction};

const CAMPAIGN_STATEMENT_TIMEOUT: &str = "10000ms";
const CAMPAIGN_LOCK_TIMEOUT: &str = "10ms";
/// Expands a bounded campaign snapshot while keeping every target in its own transaction.
///
/// The candidate read is deliberately separate from target mutation. Each target transaction
/// then acquires title -> active job -> target, matching the control plane's shared lock order;
/// a crash or a contending runtime can therefore leave only retryable `pending` targets.
pub(crate) async fn expand_pending_campaign_targets(
    database: &mut tokio_postgres::Client,
    limit: i64,
) -> Result<usize, MaterializationError> {
    let transaction = database.transaction().await?;
    configure_campaign_transaction(&transaction).await?;
    let rows = transaction
        .query(
            r"
                SELECT campaign_id, game_title_id
                FROM series_analysis_campaign_targets
                WHERE status = 'pending'
                  AND (NOT EXISTS (SELECT 1 FROM series_analysis_title_states s WHERE s.game_title_id=series_analysis_campaign_targets.game_title_id)
                    OR EXISTS (SELECT 1 FROM series_analysis_title_states s WHERE s.game_title_id=series_analysis_campaign_targets.game_title_id FOR UPDATE SKIP LOCKED))
                ORDER BY accepted_at, campaign_id, game_title_id
                LIMIT $1
                ",
            &[&limit],
        )
        .await?;
    let targets = rows
        .iter()
        .map(decode_campaign_target_key)
        .collect::<Result<Vec<_>, _>>()?;
    transaction.commit().await?;

    let mut expanded = 0_usize;
    for target in targets {
        match expand_campaign_target(database, &target).await {
            Ok(true) => expanded = expanded.saturating_add(1),
            Ok(false) => {}
            Err(MaterializationError::Postgres(error))
                if crate::postgres::is_lock_contention(&error) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(expanded)
}

async fn expand_campaign_target(
    database: &mut tokio_postgres::Client,
    key: &CampaignTargetKey,
) -> Result<bool, MaterializationError> {
    let transaction = database.transaction().await?;
    configure_campaign_transaction(&transaction).await?;
    let desired = lock_desired_analysis(&transaction, &key.game_title_id).await?;
    let active = if desired.is_some() {
        lock_active_analysis_job(&transaction, &key.game_title_id).await?
    } else {
        None
    };
    let target = lock_pending_campaign_target(&transaction, key).await?;
    let Some(target) = target else {
        transaction.commit().await?;
        return Ok(false);
    };
    match desired {
        Some(desired) => {
            materialize_campaign_target(&transaction, &target, &desired, active.as_ref()).await?;
        }
        None => skip_deleted_campaign_title(&transaction, &target).await?,
    }
    transaction.commit().await?;
    Ok(true)
}

/// A frozen operation may materialize only its approved target, without joining foreign jobs.
pub(crate) async fn expand_scoped_campaign_target(
    database: &mut tokio_postgres::Client,
    scope: &crate::maintenance::analysis::BoundScope,
    game_title_id: &str,
) -> Result<(), MaterializationError> {
    let key = CampaignTargetKey {
        campaign_id: scope.request.campaign_id.clone(),
        game_title_id: String::from(game_title_id),
    };
    let transaction = database.transaction().await?;
    configure_campaign_transaction(&transaction).await?;
    let desired = lock_desired_analysis(&transaction, game_title_id).await?;
    let active = lock_active_analysis_job(&transaction, game_title_id).await?;
    let target = lock_pending_campaign_target(&transaction, &key).await?;
    crate::maintenance::analysis::scope::validate(&transaction, scope).await?;
    if active.is_some() {
        return Err(crate::maintenance::analysis::ScopeError::Scope.into());
    }
    if let Some(target) = target {
        match desired {
            Some(desired) => {
                materialize_campaign_target(&transaction, &target, &desired, None).await?;
            }
            None => skip_deleted_campaign_title(&transaction, &target).await?,
        }
    }
    transaction.commit().await?;
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CampaignTargetKey {
    campaign_id: String,
    game_title_id: String,
}

#[derive(Debug)]
struct CampaignTarget {
    campaign_id: String,
    game_title_id: String,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
    accepted_at: SystemTime,
    operation_id: String,
    trigger: String,
}

#[derive(Debug)]
struct DesiredAnalysis {
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
}

#[derive(Debug)]
struct ActiveAnalysisJob {
    work_kind: String,
    id: String,
    status: String,
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
    started_at: Option<SystemTime>,
    attempt_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CampaignAssignmentDecision<'a> {
    Create,
    RefreshQueued {
        job_id: &'a str,
    },
    JoinRunning {
        job_id: &'a str,
        attempt_id: &'a str,
    },
    DeferForcedRun,
}

#[derive(Debug)]
struct CampaignAssignment {
    job_id: Option<String>,
    attempt_id: Option<String>,
    request_status: &'static str,
    target_status: &'static str,
}

async fn configure_campaign_transaction(
    transaction: &Transaction<'_>,
) -> Result<(), MaterializationError> {
    transaction
        .query_one(
            "SELECT set_config('statement_timeout', $1, true),\x20\
                    set_config('lock_timeout', $2, true)",
            &[&CAMPAIGN_STATEMENT_TIMEOUT, &CAMPAIGN_LOCK_TIMEOUT],
        )
        .await?;
    Ok(())
}

fn decode_campaign_target_key(row: &Row) -> Result<CampaignTargetKey, MaterializationError> {
    Ok(CampaignTargetKey {
        campaign_id: row
            .try_get("campaign_id")
            .map_err(MaterializationError::InvalidRecord)?,
        game_title_id: row
            .try_get("game_title_id")
            .map_err(MaterializationError::InvalidRecord)?,
    })
}

async fn lock_desired_analysis(
    transaction: &Transaction<'_>,
    game_title_id: &str,
) -> Result<Option<DesiredAnalysis>, MaterializationError> {
    transaction
        .query_opt(
            r"
            SELECT input_revision, algorithm_version, artifact_schema_version,
                   validation_contract_id
            FROM series_analysis_title_states
            WHERE game_title_id = $1
            FOR UPDATE
            ",
            &[&game_title_id],
        )
        .await?
        .map(|row| {
            Ok(DesiredAnalysis {
                input_revision: row
                    .try_get("input_revision")
                    .map_err(MaterializationError::InvalidRecord)?,
                algorithm_version: row
                    .try_get("algorithm_version")
                    .map_err(MaterializationError::InvalidRecord)?,
                artifact_schema_version: row
                    .try_get("artifact_schema_version")
                    .map_err(MaterializationError::InvalidRecord)?,
                validation_contract_id: row
                    .try_get("validation_contract_id")
                    .map_err(MaterializationError::InvalidRecord)?,
            })
        })
        .transpose()
}

async fn lock_active_analysis_job(
    transaction: &Transaction<'_>,
    game_title_id: &str,
) -> Result<Option<ActiveAnalysisJob>, MaterializationError> {
    transaction
        .query_opt(
            r"
            SELECT id, status, algorithm_version, artifact_schema_version,
                   validation_contract_id, started_at, lease_attempt_id, work_kind
            FROM series_analysis_jobs
            WHERE game_title_id = $1
              AND status IN ('queued', 'running')
            FOR UPDATE
            ",
            &[&game_title_id],
        )
        .await?
        .map(|row| {
            Ok(ActiveAnalysisJob {
                work_kind: row
                    .try_get("work_kind")
                    .map_err(MaterializationError::InvalidRecord)?,
                id: row
                    .try_get("id")
                    .map_err(MaterializationError::InvalidRecord)?,
                status: row
                    .try_get("status")
                    .map_err(MaterializationError::InvalidRecord)?,
                algorithm_version: row
                    .try_get("algorithm_version")
                    .map_err(MaterializationError::InvalidRecord)?,
                artifact_schema_version: row
                    .try_get("artifact_schema_version")
                    .map_err(MaterializationError::InvalidRecord)?,
                validation_contract_id: row
                    .try_get("validation_contract_id")
                    .map_err(MaterializationError::InvalidRecord)?,
                started_at: row
                    .try_get("started_at")
                    .map_err(MaterializationError::InvalidRecord)?,
                attempt_id: row
                    .try_get("lease_attempt_id")
                    .map_err(MaterializationError::InvalidRecord)?,
            })
        })
        .transpose()
}

async fn lock_pending_campaign_target(
    transaction: &Transaction<'_>,
    key: &CampaignTargetKey,
) -> Result<Option<CampaignTarget>, MaterializationError> {
    transaction
        .query_opt(
            r"
            SELECT t.campaign_id, t.game_title_id, t.input_revision,
                   t.algorithm_version, t.artifact_schema_version,
                   t.validation_contract_id, t.accepted_at,
                   c.operation_request_id, c.trigger,
                   c.algorithm_version AS campaign_algorithm_version,
                   c.artifact_schema_version AS campaign_artifact_schema_version,
                   c.validation_contract_id AS campaign_validation_contract_id
            FROM series_analysis_campaign_targets t
            JOIN series_analysis_campaigns c ON c.id = t.campaign_id
            WHERE t.campaign_id = $1
              AND t.game_title_id = $2
              AND t.status = 'pending'
            FOR UPDATE OF t
            ",
            &[&key.campaign_id, &key.game_title_id],
        )
        .await?
        .map(|row| {
            let trigger = row
                .try_get::<_, String>("trigger")
                .map_err(MaterializationError::InvalidRecord)?;
            let algorithm_version = row
                .try_get::<_, String>("algorithm_version")
                .map_err(MaterializationError::InvalidRecord)?;
            let artifact_schema_version = row
                .try_get::<_, i32>("artifact_schema_version")
                .map_err(MaterializationError::InvalidRecord)?;
            let validation_contract_id = row
                .try_get::<_, Option<String>>("validation_contract_id")
                .map_err(MaterializationError::InvalidRecord)?;
            let campaign_algorithm = row
                .try_get::<_, String>("campaign_algorithm_version")
                .map_err(MaterializationError::InvalidRecord)?;
            let campaign_schema = row
                .try_get::<_, i32>("campaign_artifact_schema_version")
                .map_err(MaterializationError::InvalidRecord)?;
            let campaign_validation_contract = row
                .try_get::<_, Option<String>>("campaign_validation_contract_id")
                .map_err(MaterializationError::InvalidRecord)?;
            if campaign_requires_uniform_version(&trigger)?
                && (algorithm_version != campaign_algorithm
                    || artifact_schema_version != campaign_schema
                    || validation_contract_id != campaign_validation_contract)
            {
                return Err(MaterializationError::InvalidRecordValue);
            }
            Ok(CampaignTarget {
                campaign_id: row
                    .try_get("campaign_id")
                    .map_err(MaterializationError::InvalidRecord)?,
                game_title_id: row
                    .try_get("game_title_id")
                    .map_err(MaterializationError::InvalidRecord)?,
                input_revision: row
                    .try_get("input_revision")
                    .map_err(MaterializationError::InvalidRecord)?,
                algorithm_version,
                artifact_schema_version,
                validation_contract_id,
                accepted_at: row
                    .try_get("accepted_at")
                    .map_err(MaterializationError::InvalidRecord)?,
                operation_id: row
                    .try_get("operation_request_id")
                    .map_err(MaterializationError::InvalidRecord)?,
                trigger,
            })
        })
        .transpose()
}

fn campaign_requires_uniform_version(trigger: &str) -> Result<bool, MaterializationError> {
    match trigger {
        // A manual all-title campaign summarizes heterogeneous title snapshots as `mixed` plus
        // the maximum schema. Its targets, not the campaign summary, own the requested tuple.
        "manual" => Ok(false),
        "algorithm_update"
        | "artifact_schema_update"
        | "validation_contract_update"
        | "initial_backfill" => Ok(true),
        _ => Err(MaterializationError::InvalidRecordValue),
    }
}

fn campaign_assignment_decision<'a>(
    active: Option<&'a ActiveAnalysisJob>,
    target: &CampaignTarget,
) -> Result<CampaignAssignmentDecision<'a>, MaterializationError> {
    match active {
        None => Ok(CampaignAssignmentDecision::Create),
        Some(job) if job.work_kind == "radar_prepare" => {
            Ok(CampaignAssignmentDecision::DeferForcedRun)
        }
        Some(job) if job.status == "queued" => {
            Ok(CampaignAssignmentDecision::RefreshQueued { job_id: &job.id })
        }
        Some(job) if job.status == "running" => match (
            job.started_at
                .is_some_and(|started_at| started_at >= target.accepted_at)
                && job.algorithm_version == target.algorithm_version
                && job.artifact_schema_version == target.artifact_schema_version
                && job.validation_contract_id == target.validation_contract_id,
            job.attempt_id.as_deref(),
        ) {
            (true, Some(attempt_id)) => Ok(CampaignAssignmentDecision::JoinRunning {
                job_id: &job.id,
                attempt_id,
            }),
            _ => Ok(CampaignAssignmentDecision::DeferForcedRun),
        },
        Some(_) => Err(MaterializationError::InvalidRecordValue),
    }
}

async fn materialize_campaign_target(
    transaction: &Transaction<'_>,
    target: &CampaignTarget,
    desired: &DesiredAnalysis,
    active: Option<&ActiveAnalysisJob>,
) -> Result<(), MaterializationError> {
    let request_id = campaign_stable_id("analysis-request", target);
    let new_job_id = campaign_stable_id("analysis-job", target);
    let assignment =
        assign_campaign_target(transaction, target, desired, active, &new_job_id).await?;
    super::job_transitions::bind_queued_radar(transaction, &[&target.game_title_id]).await?;
    transaction
        .execute(
            r"
            INSERT INTO series_analysis_job_requests (
              id, game_title_id, operation_request_id, campaign_id,
              input_revision, algorithm_version, artifact_schema_version,
              validation_contract_id,
              trigger, force_run, status, assigned_job_id, assigned_attempt_id, accepted_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, true, $10, $11, $12, $13
            )
            ",
            &[
                &request_id,
                &target.game_title_id,
                &target.operation_id,
                &target.campaign_id,
                &target.input_revision,
                &target.algorithm_version,
                &target.artifact_schema_version,
                &target.validation_contract_id,
                &target.trigger,
                &assignment.request_status,
                &assignment.job_id,
                &assignment.attempt_id,
                &target.accepted_at,
            ],
        )
        .await?;
    transaction
        .execute(
            r"
            UPDATE series_analysis_campaign_targets
            SET status = $3,
                job_request_id = $4,
                updated_at = clock_timestamp()
            WHERE campaign_id = $1
              AND game_title_id = $2
              AND status = 'pending'
            ",
            &[
                &target.campaign_id,
                &target.game_title_id,
                &assignment.target_status,
                &request_id,
            ],
        )
        .await?;
    super::campaign::refresh(transaction, std::slice::from_ref(&target.campaign_id))
        .await
        .map_err(Into::into)
}

async fn assign_campaign_target(
    transaction: &Transaction<'_>,
    target: &CampaignTarget,
    desired: &DesiredAnalysis,
    active: Option<&ActiveAnalysisJob>,
    new_job_id: &str,
) -> Result<CampaignAssignment, MaterializationError> {
    match campaign_assignment_decision(active, target)? {
        CampaignAssignmentDecision::Create => {
            transaction
                .execute(
                    r"
                    INSERT INTO series_analysis_jobs (
                      id, game_title_id, input_revision, algorithm_version,
                      artifact_schema_version, validation_contract_id, status, trigger,
                      requested_at, available_at
                    ) VALUES (
                      $1, $2, $3, $4, $5, $6, 'queued', $7, $8, $8
                    )
                    ",
                    &[
                        &new_job_id,
                        &target.game_title_id,
                        &desired.input_revision,
                        &desired.algorithm_version,
                        &desired.artifact_schema_version,
                        &desired.validation_contract_id,
                        &target.trigger,
                        &target.accepted_at,
                    ],
                )
                .await?;
            Ok(CampaignAssignment {
                job_id: Some(String::from(new_job_id)),
                attempt_id: None,
                request_status: "pending",
                target_status: "expanded",
            })
        }
        CampaignAssignmentDecision::RefreshQueued { job_id } => {
            transaction
                .execute(
                    r"
                    UPDATE series_analysis_jobs
                    SET input_revision = $2,
                        algorithm_version = $3,
                        artifact_schema_version = $4,
                        validation_contract_id = $5,
                        updated_at = clock_timestamp()
                    WHERE id = $1 AND status = 'queued'
                    ",
                    &[
                        &job_id,
                        &desired.input_revision,
                        &desired.algorithm_version,
                        &desired.artifact_schema_version,
                        &desired.validation_contract_id,
                    ],
                )
                .await?;
            Ok(CampaignAssignment {
                job_id: Some(String::from(job_id)),
                attempt_id: None,
                request_status: "pending",
                target_status: "expanded",
            })
        }
        CampaignAssignmentDecision::JoinRunning { job_id, attempt_id } => Ok(CampaignAssignment {
            job_id: Some(String::from(job_id)),
            attempt_id: Some(String::from(attempt_id)),
            request_status: "assigned",
            target_status: "running",
        }),
        CampaignAssignmentDecision::DeferForcedRun => {
            transaction
                .execute(
                    r"
                    UPDATE series_analysis_title_states
                    SET pending_work = true,
                        pending_forced_run_count = pending_forced_run_count + 1,
                        updated_at = clock_timestamp()
                    WHERE game_title_id = $1
                    ",
                    &[&target.game_title_id],
                )
                .await?;
            Ok(CampaignAssignment {
                job_id: None,
                attempt_id: None,
                request_status: "pending",
                target_status: "expanded",
            })
        }
    }
}

async fn skip_deleted_campaign_title(
    transaction: &Transaction<'_>,
    target: &CampaignTarget,
) -> Result<(), MaterializationError> {
    transaction
        .execute(
            r"
            UPDATE series_analysis_campaign_targets
            SET status = 'skipped_title_deleted', updated_at = clock_timestamp()
            WHERE campaign_id = $1
              AND game_title_id = $2
              AND status = 'pending'
            ",
            &[&target.campaign_id, &target.game_title_id],
        )
        .await?;
    super::campaign::refresh(transaction, std::slice::from_ref(&target.campaign_id))
        .await
        .map_err(Into::into)
}

fn campaign_stable_id(prefix: &str, target: &CampaignTarget) -> String {
    let source = format!("{prefix}\0{}\0{}", target.campaign_id, target.game_title_id);
    let digest: [u8; 32] = Sha256::digest(source.as_bytes()).into();
    let short_digest = digest.split_at(16).0;
    format!("{prefix}-{}", hex::encode(short_digest))
}

#[derive(Debug, Error)]
pub(crate) enum MaterializationError {
    #[error(transparent)]
    MaintenanceScope(#[from] crate::maintenance::analysis::ScopeError),
    #[error("analysis materialization PostgreSQL operation failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("analysis materialization row violates its database contract")]
    InvalidRecord(#[source] tokio_postgres::Error),
    #[error("analysis materialization row contains an invalid value")]
    InvalidRecordValue,
}
#[cfg(test)]
mod tests;
