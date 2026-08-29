//! Durable Series Analysis outbox delivery for the processing runtime.

use std::{
    future::Future,
    time::{Duration, SystemTime},
};

use momo_analysis_core::contract::QUEUE_SCHEMA_VERSION;
use redis::{AsyncCommands, RedisError, aio::ConnectionManager};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::time::Instant;
use tokio_postgres::{Client, Row, Transaction};
use tracing::{info, warn};

use crate::outbox::coordinator::{DrainBatch, DriverFailureKind, OutboxDriver};

const MAXIMUM_BATCH_SIZE: usize = 100;
const MAXIMUM_DELIVERY_ATTEMPTS: i32 = 3;
const QUEUE_PUBLISH_ERROR_CLASS: &str = "redis_operation";
const DELIVERY_RETRY_SECONDS: [u64; 3] = [2, 4, 8];
const RUNTIME_BATCH_SIZE: usize = 10;
const RUNTIME_CLAIM_TTL: Duration = Duration::from_secs(30);
const RUNTIME_SEMANTIC_REDELIVERY_AFTER: Duration = Duration::from_mins(5);
const LOCK_CONTENTION_RETRY_DELAY: Duration = Duration::from_millis(250);
const CAMPAIGN_STATEMENT_TIMEOUT: &str = "10000ms";
const CAMPAIGN_LOCK_TIMEOUT: &str = "5000ms";

/// Bounded policy required by the Series Analysis outbox state machine.
///
/// The stream is a delivery route, while `PostgreSQL` remains authoritative. Durations define
/// one-shot deadlines and never create a periodic worker-local sweep.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SeriesAnalysisOutboxConfig {
    stream: String,
    batch_size: usize,
    claim_ttl: Duration,
    semantic_redelivery_after: Duration,
}

impl SeriesAnalysisOutboxConfig {
    /// Builds the processing-runtime policy while keeping timing and batch choices inside the
    /// Analysis outbox adapter.
    ///
    /// # Errors
    ///
    /// Returns an error when the configured stream name violates the bounded driver contract.
    pub(crate) fn for_runtime(stream: String) -> Result<Self, SeriesAnalysisOutboxError> {
        Self::new(
            stream,
            RUNTIME_BATCH_SIZE,
            RUNTIME_CLAIM_TTL,
            RUNTIME_SEMANTIC_REDELIVERY_AFTER,
        )
    }

    /// Validates the bounded driver policy without opening either dependency.
    ///
    /// # Errors
    ///
    /// Returns an error when a value could create an empty route, unbounded batch, or immediate
    /// retry loop.
    pub(crate) fn new(
        stream: String,
        batch_size: usize,
        claim_ttl: Duration,
        semantic_redelivery_after: Duration,
    ) -> Result<Self, SeriesAnalysisOutboxError> {
        if stream.trim().is_empty()
            || !(1..=MAXIMUM_BATCH_SIZE).contains(&batch_size)
            || claim_ttl.is_zero()
            || semantic_redelivery_after.is_zero()
        {
            return Err(SeriesAnalysisOutboxError::InvalidConfiguration);
        }
        for duration in [claim_ttl, semantic_redelivery_after] {
            postgres_duration_milliseconds(duration)?;
        }
        Ok(Self {
            stream,
            batch_size,
            claim_ttl,
            semantic_redelivery_after,
        })
    }
}

/// Series Analysis adapter that owns outbox SQL, payload fields, and Redis publication state.
///
/// Construction receives already-open dependency handles so connection ownership and task
/// supervision remain outside this domain adapter.
pub(crate) struct SeriesAnalysisOutboxDriver {
    database: Client,
    redis: ConnectionManager,
    config: SeriesAnalysisOutboxConfig,
}

impl SeriesAnalysisOutboxDriver {
    #[must_use]
    pub(crate) const fn new(
        database: Client,
        redis: ConnectionManager,
        config: SeriesAnalysisOutboxConfig,
    ) -> Self {
        Self {
            database,
            redis,
            config,
        }
    }

    async fn drain_once(&mut self) -> Result<DrainBatch, SeriesAnalysisOutboxError> {
        let expanded = self.expand_pending_campaign_targets().await?;
        let reconciled = self.reconcile_queued().await?;
        let claims = self.claim_due().await?;
        let claimed = claims.len();
        let mut delivered = 0_usize;
        let mut retried = 0_usize;
        let mut stale = 0_usize;
        for claim in claims {
            match self.publish_claim(&claim).await? {
                PublishResult::Delivered => delivered = delivered.saturating_add(1),
                PublishResult::Retried => retried = retried.saturating_add(1),
                PublishResult::Stale => stale = stale.saturating_add(1),
            }
        }
        if expanded > 0 || reconciled > 0 || claimed > 0 {
            info!(
                event = "analysis_outbox_batch_progress",
                expanded,
                reconciled,
                claimed,
                delivered,
                retried,
                stale,
                "analysis outbox driver completed a bounded batch"
            );
            return Ok(DrainBatch::progress());
        }
        let next = self
            .next_delay()
            .await?
            .map(bounded_idle_delay)
            .map(monotonic_deadline)
            .transpose()?;
        Ok(DrainBatch::idle(next))
    }

    /// Expands a bounded campaign snapshot while keeping every target in its own transaction.
    ///
    /// The candidate read is deliberately separate from target mutation. Each target transaction
    /// then acquires title -> active job -> target, matching the control plane's shared lock order;
    /// a crash or a contending runtime can therefore leave only retryable `pending` targets.
    async fn expand_pending_campaign_targets(
        &mut self,
    ) -> Result<usize, SeriesAnalysisOutboxError> {
        let limit =
            i64::try_from(self.config.batch_size).map_err(SeriesAnalysisOutboxError::BatchBound)?;
        let transaction = self.database.transaction().await?;
        configure_campaign_transaction(&transaction).await?;
        let rows = transaction
            .query(
                r"
                SELECT campaign_id, game_title_id
                FROM series_analysis_campaign_targets
                WHERE status = 'pending'
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
            if self.expand_campaign_target(&target).await? {
                expanded = expanded.saturating_add(1);
            }
        }
        Ok(expanded)
    }

    async fn expand_campaign_target(
        &mut self,
        key: &CampaignTargetKey,
    ) -> Result<bool, SeriesAnalysisOutboxError> {
        let transaction = self.database.transaction().await?;
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
                materialize_campaign_target(&transaction, &target, &desired, active.as_ref())
                    .await?;
            }
            None => skip_deleted_campaign_title(&transaction, &target).await?,
        }
        transaction.commit().await?;
        Ok(true)
    }

    async fn reconcile_queued(&mut self) -> Result<u64, SeriesAnalysisOutboxError> {
        let limit =
            i64::try_from(self.config.batch_size).map_err(SeriesAnalysisOutboxError::BatchBound)?;
        let redelivery_milliseconds =
            postgres_duration_milliseconds(self.config.semantic_redelivery_after)?;
        let transaction = self.database.transaction().await?;
        let inserted = transaction
            .execute(
                r"
                WITH timing AS (
                  SELECT clock_timestamp() AS now
                ), candidates AS (
                  SELECT j.id, j.input_revision
                  FROM series_analysis_jobs j
                  CROSS JOIN timing
                  WHERE j.status = 'queued'
                    AND j.available_at <= timing.now
                    AND j.lease_owner IS NULL
                    AND j.lease_attempt_id IS NULL
                    AND j.lease_fencing_token IS NULL
                    AND j.lease_expires_at IS NULL
                    AND NOT EXISTS (
                      SELECT 1
                      FROM series_analysis_queue_outbox q
                      WHERE q.job_id = j.id
                        AND (
                          q.status IN ('pending', 'in_flight')
                          OR (
                            q.status = 'delivered'
                            AND q.delivered_at >= timing.now
                              - ($1::bigint * interval '1 millisecond')
                          )
                        )
                    )
                  ORDER BY j.available_at, j.requested_at, j.id
                  LIMIT $2
                  FOR UPDATE OF j SKIP LOCKED
                )
                INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key, next_attempt_at)
                SELECT
                  'analysis-reconcile-' || md5(
                    id || ':' || input_revision::text || ':' || timing.now::text
                  ),
                  id,
                  'reconcile:' || id || ':' || input_revision::text || ':'
                    || timing.now::text,
                  timing.now
                FROM candidates
                CROSS JOIN timing
                ON CONFLICT (dedupe_key) DO NOTHING
                ",
                &[&redelivery_milliseconds, &limit],
            )
            .await?;
        transaction.commit().await?;
        Ok(inserted)
    }

    async fn claim_due(&mut self) -> Result<Vec<OutboxClaim>, SeriesAnalysisOutboxError> {
        let limit =
            i64::try_from(self.config.batch_size).map_err(SeriesAnalysisOutboxError::BatchBound)?;
        let claim_ttl_milliseconds = postgres_duration_milliseconds(self.config.claim_ttl)?;
        let transaction = self.database.transaction().await?;
        let rows = transaction
            .query(
                r"
                WITH timing AS (
                  SELECT clock_timestamp() AS now
                ), candidate AS (
                  SELECT q.id
                  FROM series_analysis_queue_outbox q
                  JOIN series_analysis_jobs j ON j.id = q.job_id
                  CROSS JOIN timing
                  WHERE j.available_at <= timing.now
                    AND (
                      (q.status = 'pending' AND q.next_attempt_at <= timing.now)
                      OR (q.status = 'in_flight' AND q.claim_expires_at <= timing.now)
                    )
                  ORDER BY q.next_attempt_at, q.created_at, q.id
                  LIMIT $1
                  FOR UPDATE OF q SKIP LOCKED
                )
                UPDATE series_analysis_queue_outbox q
                SET status = 'in_flight',
                    claim_expires_at = timing.now
                      + ($2::bigint * interval '1 millisecond'),
                    last_attempt_at = timing.now,
                    updated_at = timing.now
                FROM candidate
                CROSS JOIN timing
                WHERE q.id = candidate.id
                RETURNING q.id, q.job_id, q.attempt_count, q.claim_expires_at
                ",
                &[&limit, &claim_ttl_milliseconds],
            )
            .await?;
        let claims = rows
            .iter()
            .map(decode_claim)
            .collect::<Result<Vec<_>, _>>()?;
        transaction.commit().await?;
        Ok(claims)
    }

    async fn publish_claim(
        &mut self,
        claim: &OutboxClaim,
    ) -> Result<PublishResult, SeriesAnalysisOutboxError> {
        let fields = queue_fields(&claim.job_id);
        let published: Result<String, RedisError> =
            self.redis.xadd(&self.config.stream, "*", &fields).await;
        match published {
            Ok(message_id) => {
                let delivered = self.mark_delivered(claim, &message_id).await?;
                if delivered {
                    Ok(PublishResult::Delivered)
                } else {
                    warn!(
                        event = "analysis_outbox_stale_delivery_mark",
                        "analysis outbox delivery mark lost its claim fence"
                    );
                    Ok(PublishResult::Stale)
                }
            }
            Err(_publish_error) => {
                let retry_delay = delivery_retry_delay(claim.attempt_count)?;
                let released = self.release_for_retry(claim, retry_delay).await?;
                if released {
                    warn!(
                        event = "analysis_outbox_publish_deferred",
                        attempt = claim.attempt_count.saturating_add(1),
                        error_kind = QUEUE_PUBLISH_ERROR_CLASS,
                        "analysis queue publication moved to its durable retry deadline"
                    );
                    Ok(PublishResult::Retried)
                } else {
                    warn!(
                        event = "analysis_outbox_stale_retry_release",
                        "analysis outbox retry release lost its claim fence"
                    );
                    Ok(PublishResult::Stale)
                }
            }
        }
    }

    async fn mark_delivered(
        &self,
        claim: &OutboxClaim,
        redis_message_id: &str,
    ) -> Result<bool, SeriesAnalysisOutboxError> {
        let updated = self
            .database
            .execute(
                r"
                UPDATE series_analysis_queue_outbox
                SET status = 'delivered',
                    claim_expires_at = NULL,
                    redis_message_id = $3,
                    delivered_at = clock_timestamp(),
                    last_error = NULL,
                    updated_at = clock_timestamp()
                WHERE id = $1
                  AND status = 'in_flight'
                  AND claim_expires_at = $2
                ",
                &[&claim.id, &claim.claim_expires_at, &redis_message_id],
            )
            .await?;
        Ok(updated == 1)
    }

    async fn release_for_retry(
        &mut self,
        claim: &OutboxClaim,
        retry_delay: Duration,
    ) -> Result<bool, SeriesAnalysisOutboxError> {
        let retry_milliseconds = postgres_duration_milliseconds(retry_delay)?;
        let semantic_redelivery_milliseconds =
            postgres_duration_milliseconds(self.config.semantic_redelivery_after)?;
        let transaction = self.database.transaction().await?;
        let boundary_exists = if claim.exhausts_delivery_attempts() {
            lock_terminal_retry_boundary(&transaction, claim).await?
        } else {
            lock_retry_job(&transaction, claim).await?
        };
        if !boundary_exists {
            transaction.rollback().await?;
            return Ok(false);
        }
        let released = transaction
            .query_opt(
                r"
                UPDATE series_analysis_queue_outbox
                SET status = CASE WHEN attempt_count + 1 >= $5 THEN 'failed' ELSE 'pending' END,
                    attempt_count = attempt_count + 1,
                    claim_expires_at = NULL,
                    next_attempt_at = GREATEST(
                      clock_timestamp() + ($3::bigint * interval '1 millisecond'),
                      (SELECT available_at FROM series_analysis_jobs WHERE id = $6)
                    ),
                    last_error = $4,
                    updated_at = clock_timestamp()
                WHERE id = $1
                  AND job_id = $6
                  AND status = 'in_flight'
                  AND claim_expires_at = $2
                RETURNING job_id, status
                ",
                &[
                    &claim.id,
                    &claim.claim_expires_at,
                    &retry_milliseconds,
                    &QUEUE_PUBLISH_ERROR_CLASS,
                    &MAXIMUM_DELIVERY_ATTEMPTS,
                    &claim.job_id,
                ],
            )
            .await?
            .map(|row| decode_delivery_failure(&row))
            .transpose()?;
        if let Some(failure) = &released
            && failure.status == "failed"
        {
            fail_undeliverable_job(
                &transaction,
                &failure.job_id,
                semantic_redelivery_milliseconds,
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(released.is_some())
    }

    async fn next_delay(&self) -> Result<Option<Duration>, SeriesAnalysisOutboxError> {
        let redelivery_millis =
            postgres_duration_milliseconds(self.config.semantic_redelivery_after)?;
        let row = self
            .database
            .query_one(
                r"
                WITH semantic_deadlines AS (
                  SELECT GREATEST(
                    j.available_at,
                    COALESCE(
                      MAX(q.delivered_at) FILTER (WHERE q.status = 'delivered')
                        + ($1::bigint * interval '1 millisecond'),
                      j.available_at
                    )
                  ) AS wake_at
                  FROM series_analysis_jobs j
                  LEFT JOIN series_analysis_queue_outbox q ON q.job_id = j.id
                  WHERE j.status = 'queued'
                    AND j.lease_owner IS NULL
                    AND j.lease_attempt_id IS NULL
                    AND j.lease_fencing_token IS NULL
                    AND j.lease_expires_at IS NULL
                    AND NOT EXISTS (
                      SELECT 1 FROM series_analysis_queue_outbox active
                      WHERE active.job_id = j.id
                        AND active.status IN ('pending', 'in_flight')
                    )
                  GROUP BY j.id, j.available_at
                ), deadlines AS (
                  SELECT MIN(GREATEST(q.next_attempt_at, j.available_at)) AS wake_at
                  FROM series_analysis_queue_outbox q
                  JOIN series_analysis_jobs j ON j.id = q.job_id
                  WHERE q.status = 'pending'
                  UNION ALL
                  SELECT MIN(GREATEST(q.claim_expires_at, j.available_at)) AS wake_at
                  FROM series_analysis_queue_outbox q
                  JOIN series_analysis_jobs j ON j.id = q.job_id
                  WHERE q.status = 'in_flight'
                  UNION ALL
                  SELECT MIN(wake_at) AS wake_at FROM semantic_deadlines
                )
                SELECT CASE WHEN MIN(wake_at) IS NULL THEN NULL ELSE GREATEST(
                    CEIL(EXTRACT(EPOCH FROM (MIN(wake_at) - clock_timestamp())) * 1000),
                    0
                  )::bigint END AS delay_milliseconds
                FROM deadlines
                ",
                &[&redelivery_millis],
            )
            .await?;
        let delay_milliseconds = row
            .try_get::<_, Option<i64>>("delay_milliseconds")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
        delay_milliseconds
            .map(|value| {
                u64::try_from(value)
                    .map(Duration::from_millis)
                    .map_err(|_error| SeriesAnalysisOutboxError::InvalidRecordValue)
            })
            .transpose()
    }
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
    enqueue_job_id: Option<String>,
}

async fn configure_campaign_transaction(
    transaction: &Transaction<'_>,
) -> Result<(), SeriesAnalysisOutboxError> {
    transaction
        .query_one(
            "SELECT set_config('statement_timeout', $1, true),\x20\
                    set_config('lock_timeout', $2, true)",
            &[&CAMPAIGN_STATEMENT_TIMEOUT, &CAMPAIGN_LOCK_TIMEOUT],
        )
        .await?;
    Ok(())
}

fn decode_campaign_target_key(row: &Row) -> Result<CampaignTargetKey, SeriesAnalysisOutboxError> {
    Ok(CampaignTargetKey {
        campaign_id: row
            .try_get("campaign_id")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
        game_title_id: row
            .try_get("game_title_id")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
    })
}

async fn lock_desired_analysis(
    transaction: &Transaction<'_>,
    game_title_id: &str,
) -> Result<Option<DesiredAnalysis>, SeriesAnalysisOutboxError> {
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
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                algorithm_version: row
                    .try_get("algorithm_version")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                artifact_schema_version: row
                    .try_get("artifact_schema_version")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                validation_contract_id: row
                    .try_get("validation_contract_id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
            })
        })
        .transpose()
}

async fn lock_active_analysis_job(
    transaction: &Transaction<'_>,
    game_title_id: &str,
) -> Result<Option<ActiveAnalysisJob>, SeriesAnalysisOutboxError> {
    transaction
        .query_opt(
            r"
            SELECT id, status, algorithm_version, artifact_schema_version,
                   validation_contract_id, started_at, lease_attempt_id
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
                id: row
                    .try_get("id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                status: row
                    .try_get("status")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                algorithm_version: row
                    .try_get("algorithm_version")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                artifact_schema_version: row
                    .try_get("artifact_schema_version")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                validation_contract_id: row
                    .try_get("validation_contract_id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                started_at: row
                    .try_get("started_at")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                attempt_id: row
                    .try_get("lease_attempt_id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
            })
        })
        .transpose()
}

async fn lock_pending_campaign_target(
    transaction: &Transaction<'_>,
    key: &CampaignTargetKey,
) -> Result<Option<CampaignTarget>, SeriesAnalysisOutboxError> {
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
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            let algorithm_version = row
                .try_get::<_, String>("algorithm_version")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            let artifact_schema_version = row
                .try_get::<_, i32>("artifact_schema_version")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            let validation_contract_id = row
                .try_get::<_, Option<String>>("validation_contract_id")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            let campaign_algorithm = row
                .try_get::<_, String>("campaign_algorithm_version")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            let campaign_schema = row
                .try_get::<_, i32>("campaign_artifact_schema_version")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            let campaign_validation_contract = row
                .try_get::<_, Option<String>>("campaign_validation_contract_id")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
            if campaign_requires_uniform_version(&trigger)?
                && (algorithm_version != campaign_algorithm
                    || artifact_schema_version != campaign_schema
                    || validation_contract_id != campaign_validation_contract)
            {
                return Err(SeriesAnalysisOutboxError::InvalidRecordValue);
            }
            Ok(CampaignTarget {
                campaign_id: row
                    .try_get("campaign_id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                game_title_id: row
                    .try_get("game_title_id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                input_revision: row
                    .try_get("input_revision")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                algorithm_version,
                artifact_schema_version,
                validation_contract_id,
                accepted_at: row
                    .try_get("accepted_at")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                operation_id: row
                    .try_get("operation_request_id")
                    .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
                trigger,
            })
        })
        .transpose()
}

fn campaign_requires_uniform_version(trigger: &str) -> Result<bool, SeriesAnalysisOutboxError> {
    match trigger {
        // A manual all-title campaign summarizes heterogeneous title snapshots as `mixed` plus
        // the maximum schema. Its targets, not the campaign summary, own the requested tuple.
        "manual" => Ok(false),
        "algorithm_update"
        | "artifact_schema_update"
        | "validation_contract_update"
        | "initial_backfill" => Ok(true),
        _ => Err(SeriesAnalysisOutboxError::InvalidRecordValue),
    }
}

fn campaign_assignment_decision<'a>(
    active: Option<&'a ActiveAnalysisJob>,
    target: &CampaignTarget,
) -> Result<CampaignAssignmentDecision<'a>, SeriesAnalysisOutboxError> {
    match active {
        None => Ok(CampaignAssignmentDecision::Create),
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
        Some(_) => Err(SeriesAnalysisOutboxError::InvalidRecordValue),
    }
}

async fn materialize_campaign_target(
    transaction: &Transaction<'_>,
    target: &CampaignTarget,
    desired: &DesiredAnalysis,
    active: Option<&ActiveAnalysisJob>,
) -> Result<(), SeriesAnalysisOutboxError> {
    let request_id = campaign_stable_id("analysis-request", target);
    let new_job_id = campaign_stable_id("analysis-job", target);
    let outbox_id = campaign_stable_id("analysis-outbox", target);
    let assignment =
        assign_campaign_target(transaction, target, desired, active, &new_job_id).await?;
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
    if let Some(job_id) = assignment.enqueue_job_id {
        let dedupe_key = format!("campaign:{}:{}", target.campaign_id, target.game_title_id);
        transaction
            .execute(
                r"
                INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key)
                VALUES ($1, $2, $3)
                ON CONFLICT (dedupe_key) DO NOTHING
                ",
                &[&outbox_id, &job_id, &dedupe_key],
            )
            .await?;
    }
    refresh_campaign(transaction, &target.campaign_id).await
}

async fn assign_campaign_target(
    transaction: &Transaction<'_>,
    target: &CampaignTarget,
    desired: &DesiredAnalysis,
    active: Option<&ActiveAnalysisJob>,
    new_job_id: &str,
) -> Result<CampaignAssignment, SeriesAnalysisOutboxError> {
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
                enqueue_job_id: Some(String::from(new_job_id)),
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
                enqueue_job_id: Some(String::from(job_id)),
            })
        }
        CampaignAssignmentDecision::JoinRunning { job_id, attempt_id } => Ok(CampaignAssignment {
            job_id: Some(String::from(job_id)),
            attempt_id: Some(String::from(attempt_id)),
            request_status: "assigned",
            target_status: "running",
            enqueue_job_id: None,
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
                enqueue_job_id: None,
            })
        }
    }
}

async fn skip_deleted_campaign_title(
    transaction: &Transaction<'_>,
    target: &CampaignTarget,
) -> Result<(), SeriesAnalysisOutboxError> {
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
    refresh_campaign(transaction, &target.campaign_id).await
}

fn campaign_stable_id(prefix: &str, target: &CampaignTarget) -> String {
    let source = format!("{prefix}\0{}\0{}", target.campaign_id, target.game_title_id);
    let digest: [u8; 32] = Sha256::digest(source.as_bytes()).into();
    let short_digest = digest.split_at(16).0;
    format!("{prefix}-{}", hex::encode(short_digest))
}

const fn bounded_idle_delay(delay: Duration) -> Duration {
    if delay.is_zero() {
        LOCK_CONTENTION_RETRY_DELAY
    } else {
        delay
    }
}

async fn lock_retry_job(
    transaction: &Transaction<'_>,
    claim: &OutboxClaim,
) -> Result<bool, SeriesAnalysisOutboxError> {
    // Non-terminal retries update only the authoritative job schedule and its outbox delivery, so
    // they retain the minimal job -> outbox lock prefix used by control-plane enqueue paths.
    Ok(transaction
        .query_opt(
            "SELECT id FROM series_analysis_jobs WHERE id = $1 FOR UPDATE",
            &[&claim.job_id],
        )
        .await?
        .is_some())
}

async fn lock_terminal_retry_boundary(
    transaction: &Transaction<'_>,
    claim: &OutboxClaim,
) -> Result<bool, SeriesAnalysisOutboxError> {
    let preview = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_jobs WHERE id = $1",
            &[&claim.job_id],
        )
        .await?;
    let Some(preview) = preview else {
        return Ok(false);
    };
    let game_title_id = preview
        .try_get::<_, String>(0)
        .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;

    // Exhaustion also updates title/request projections. Acquire the complete shared mutation
    // prefix before revalidating the job and touching its outbox row: slot -> title -> job -> q.
    let _locked_slot = crate::execution_slot::lock(transaction).await?;
    let title_exists = transaction
        .query_opt(
            "SELECT game_title_id FROM series_analysis_title_states\x20\
             WHERE game_title_id = $1 FOR UPDATE",
            &[&game_title_id],
        )
        .await?
        .is_some();
    let job_exists = transaction
        .query_opt(
            "SELECT id FROM series_analysis_jobs\x20\
             WHERE id = $1 AND game_title_id = $2 FOR UPDATE",
            &[&claim.job_id, &game_title_id],
        )
        .await?
        .is_some();
    if job_exists && !title_exists {
        return Err(SeriesAnalysisOutboxError::InvalidRecordValue);
    }
    Ok(job_exists)
}

impl OutboxDriver for SeriesAnalysisOutboxDriver {
    type Error = SeriesAnalysisOutboxError;

    fn drain_batch(&mut self) -> impl Future<Output = Result<DrainBatch, Self::Error>> + Send {
        self.drain_once()
    }

    fn failure_kind(error: &Self::Error) -> DriverFailureKind {
        match error {
            SeriesAnalysisOutboxError::Postgres(error)
            | SeriesAnalysisOutboxError::ExecutionSlot(
                crate::execution_slot::ExecutionSlotError::Postgres(error),
            ) if error.is_closed() => DriverFailureKind::Structural,
            SeriesAnalysisOutboxError::Postgres(_)
            | SeriesAnalysisOutboxError::ExecutionSlot(
                crate::execution_slot::ExecutionSlotError::Postgres(_),
            ) => DriverFailureKind::Recoverable,
            SeriesAnalysisOutboxError::InvalidConfiguration
            | SeriesAnalysisOutboxError::ExecutionSlot(
                crate::execution_slot::ExecutionSlotError::InvalidState,
            )
            | SeriesAnalysisOutboxError::InvalidRecord(_)
            | SeriesAnalysisOutboxError::InvalidRecordValue
            | SeriesAnalysisOutboxError::BatchBound(_)
            | SeriesAnalysisOutboxError::DurationBound(_)
            | SeriesAnalysisOutboxError::TimeBound => DriverFailureKind::Structural,
        }
    }

    fn safe_error_kind(error: &Self::Error) -> &'static str {
        match error {
            SeriesAnalysisOutboxError::Postgres(_) => "postgres_operation",
            SeriesAnalysisOutboxError::ExecutionSlot(error) => error.kind(),
            SeriesAnalysisOutboxError::InvalidConfiguration => "configuration",
            SeriesAnalysisOutboxError::InvalidRecord(_) => "invalid_record",
            SeriesAnalysisOutboxError::InvalidRecordValue => "invalid_record_value",
            SeriesAnalysisOutboxError::BatchBound(_) => "batch_bound",
            SeriesAnalysisOutboxError::DurationBound(_) => "duration_bound",
            SeriesAnalysisOutboxError::TimeBound => "time_bound",
        }
    }
}

#[derive(Debug, Error)]
pub(crate) enum SeriesAnalysisOutboxError {
    #[error("Series Analysis outbox PostgreSQL operation failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("Series Analysis outbox execution-slot lock failed")]
    ExecutionSlot(#[from] crate::execution_slot::ExecutionSlotError),
    #[error("Series Analysis outbox configuration is invalid")]
    InvalidConfiguration,
    #[error("Series Analysis outbox row violates its database contract")]
    InvalidRecord(#[source] tokio_postgres::Error),
    #[error("Series Analysis outbox row contains an invalid value")]
    InvalidRecordValue,
    #[error("Series Analysis outbox batch exceeds the PostgreSQL protocol bound")]
    BatchBound(#[source] std::num::TryFromIntError),
    #[error("Series Analysis outbox duration exceeds the PostgreSQL protocol bound")]
    DurationBound(#[source] std::num::TryFromIntError),
    #[error("Series Analysis outbox deadline exceeds a supported clock bound")]
    TimeBound,
}

#[derive(Debug)]
struct OutboxClaim {
    id: String,
    job_id: String,
    attempt_count: i32,
    claim_expires_at: SystemTime,
}

impl OutboxClaim {
    const fn exhausts_delivery_attempts(&self) -> bool {
        self.attempt_count >= MAXIMUM_DELIVERY_ATTEMPTS - 1
    }
}

#[derive(Debug)]
struct DeliveryFailure {
    job_id: String,
    status: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PublishResult {
    Delivered,
    Retried,
    Stale,
}

fn decode_claim(row: &Row) -> Result<OutboxClaim, SeriesAnalysisOutboxError> {
    let claim = OutboxClaim {
        id: row
            .try_get("id")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
        job_id: row
            .try_get("job_id")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
        attempt_count: row
            .try_get("attempt_count")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
        claim_expires_at: row
            .try_get("claim_expires_at")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
    };
    if !(0..MAXIMUM_DELIVERY_ATTEMPTS).contains(&claim.attempt_count) {
        return Err(SeriesAnalysisOutboxError::InvalidRecordValue);
    }
    Ok(claim)
}

fn decode_delivery_failure(row: &Row) -> Result<DeliveryFailure, SeriesAnalysisOutboxError> {
    Ok(DeliveryFailure {
        job_id: row
            .try_get("job_id")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
        status: row
            .try_get("status")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)?,
    })
}

fn queue_fields(job_id: &str) -> [(&'static str, String); 2] {
    [
        ("schemaVersion", QUEUE_SCHEMA_VERSION.to_string()),
        ("jobId", String::from(job_id)),
    ]
}

fn delivery_retry_delay(attempt_count: i32) -> Result<Duration, SeriesAnalysisOutboxError> {
    let index = usize::try_from(attempt_count)
        .map_err(|_invalid| SeriesAnalysisOutboxError::InvalidRecordValue)?;
    let seconds = DELIVERY_RETRY_SECONDS
        .get(index)
        .copied()
        .ok_or(SeriesAnalysisOutboxError::InvalidRecordValue)?;
    Ok(Duration::from_secs(seconds))
}

fn postgres_duration_milliseconds(duration: Duration) -> Result<i64, SeriesAnalysisOutboxError> {
    i64::try_from(duration.as_millis()).map_err(SeriesAnalysisOutboxError::DurationBound)
}

fn monotonic_deadline(delay: Duration) -> Result<Instant, SeriesAnalysisOutboxError> {
    Instant::now()
        .checked_add(delay)
        .ok_or(SeriesAnalysisOutboxError::TimeBound)
}

async fn fail_undeliverable_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    semantic_redelivery_milliseconds: i64,
) -> Result<(), SeriesAnalysisOutboxError> {
    let Some(game_title_id) =
        mark_undeliverable_job(transaction, job_id, semantic_redelivery_milliseconds).await?
    else {
        return Ok(());
    };
    transaction
        .execute(
            r"
            UPDATE series_analysis_title_states
            SET pending_work = true,
                last_failure_code = 'dependency_retry_exhausted',
                last_failure_at = clock_timestamp(),
                updated_at = clock_timestamp()
            WHERE game_title_id = $1
            ",
            &[&game_title_id],
        )
        .await?;
    transaction
        .execute(
            r"
            UPDATE series_analysis_job_requests
            SET status = 'fulfilled', fulfilled_at = clock_timestamp()
            WHERE assigned_job_id = $1 AND status <> 'fulfilled'
            ",
            &[&job_id],
        )
        .await?;
    let campaign_rows = transaction
        .query(
            r"
            UPDATE series_analysis_campaign_targets t
            SET status = 'failed', updated_at = clock_timestamp()
            FROM series_analysis_job_requests r
            WHERE t.job_request_id = r.id
              AND r.assigned_job_id = $1
              AND t.status NOT IN ('succeeded', 'failed', 'skipped_title_deleted')
            RETURNING t.campaign_id
            ",
            &[&job_id],
        )
        .await?;
    let mut campaign_ids = campaign_rows
        .iter()
        .map(|row| {
            row.try_get("campaign_id")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)
        })
        .collect::<Result<Vec<String>, _>>()?;
    campaign_ids.sort();
    campaign_ids.dedup();
    for campaign_id in campaign_ids {
        refresh_campaign(transaction, &campaign_id).await?;
    }
    transaction
        .execute(
            r"
            UPDATE series_analysis_operation_requests o
            SET status = 'terminal',
                finished_at = COALESCE(o.finished_at, clock_timestamp())
            WHERE o.scope = 'title'
              AND o.status <> 'terminal'
              AND EXISTS (
                SELECT 1 FROM series_analysis_job_requests changed
                WHERE changed.operation_request_id = o.id
                  AND changed.assigned_job_id = $1
              )
              AND NOT EXISTS (
                SELECT 1 FROM series_analysis_job_requests pending
                WHERE pending.operation_request_id = o.id
                  AND pending.status <> 'fulfilled'
              )
            ",
            &[&job_id],
        )
        .await?;
    Ok(())
}

async fn mark_undeliverable_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    semantic_redelivery_milliseconds: i64,
) -> Result<Option<String>, SeriesAnalysisOutboxError> {
    transaction
        .query_opt(
            r"
            UPDATE series_analysis_jobs j
            SET status = 'failed',
                finished_at = clock_timestamp(),
                safe_failure_code = 'dependency_retry_exhausted',
                updated_at = clock_timestamp()
            WHERE j.id = $1
              AND j.status = 'queued'
              -- A delivery remains a viable transport path only for the same bounded semantic
              -- redelivery window used by reconciliation. Historical deliveries must not reset
              -- the failed row's durable retry budget and keep the job queued forever.
              AND NOT EXISTS (
                SELECT 1 FROM series_analysis_queue_outbox q
                WHERE q.job_id = j.id
                  AND (
                    q.status IN ('pending', 'in_flight')
                    OR (
                      q.status = 'delivered'
                      AND q.delivered_at >= clock_timestamp()
                        - ($2::bigint * interval '1 millisecond')
                    )
                  )
              )
            RETURNING game_title_id
            ",
            &[&job_id, &semantic_redelivery_milliseconds],
        )
        .await?
        .map(|row| {
            row.try_get("game_title_id")
                .map_err(SeriesAnalysisOutboxError::InvalidRecord)
        })
        .transpose()
}

async fn refresh_campaign(
    transaction: &Transaction<'_>,
    campaign_id: &str,
) -> Result<(), SeriesAnalysisOutboxError> {
    transaction
        .execute(
            r"
            WITH counts AS (
              SELECT
                COUNT(*) FILTER (WHERE status <> 'pending')::int AS expanded_count,
                COUNT(*) FILTER (
                  WHERE status IN ('succeeded', 'failed', 'skipped_title_deleted')
                )::int AS terminal_count,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
                COUNT(*) FILTER (WHERE status = 'skipped_title_deleted')::int AS skipped_count
              FROM series_analysis_campaign_targets
              WHERE campaign_id = $1
            )
            UPDATE series_analysis_campaigns c
            SET expanded_count = counts.expanded_count,
                terminal_count = counts.terminal_count,
                failed_count = counts.failed_count,
                skipped_count = counts.skipped_count,
                status = CASE
                  WHEN counts.terminal_count = c.target_count THEN 'terminal'
                  WHEN counts.expanded_count = c.target_count THEN 'running'
                  ELSE 'expanding'
                END,
                finished_at = CASE
                  WHEN counts.terminal_count = c.target_count
                    THEN COALESCE(c.finished_at, clock_timestamp())
                  ELSE NULL
                END
            FROM counts
            WHERE c.id = $1
            ",
            &[&campaign_id],
        )
        .await?;
    transaction
        .execute(
            r"
            UPDATE series_analysis_operation_requests o
            SET status = CASE WHEN c.status = 'terminal' THEN 'terminal' ELSE 'running' END,
                finished_at = CASE
                  WHEN c.status = 'terminal'
                    THEN COALESCE(o.finished_at, c.finished_at, clock_timestamp())
                  ELSE NULL
                END
            FROM series_analysis_campaigns c
            WHERE c.id = $1
              AND o.id = c.operation_request_id
            ",
            &[&campaign_id],
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
