//! Durable Series Analysis outbox delivery for the processing runtime.

use std::{
    future::Future,
    time::{Duration, SystemTime},
};

use momo_analysis_core::contract::QUEUE_SCHEMA_VERSION;
use redis::{AsyncCommands, RedisError, aio::ConnectionManager};
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
const RUNTIME_MAXIMUM_PUBLISH_BACKOFF: Duration = Duration::from_mins(1);
const RUNTIME_SEMANTIC_REDELIVERY_AFTER: Duration = Duration::from_mins(5);

/// Bounded policy required by the Series Analysis outbox state machine.
///
/// The stream is a delivery route, while `PostgreSQL` remains authoritative. Durations define
/// one-shot deadlines and never create a periodic worker-local sweep.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SeriesAnalysisOutboxConfig {
    stream: String,
    batch_size: usize,
    claim_ttl: Duration,
    maximum_publish_backoff: Duration,
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
            RUNTIME_MAXIMUM_PUBLISH_BACKOFF,
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
        maximum_publish_backoff: Duration,
        semantic_redelivery_after: Duration,
    ) -> Result<Self, SeriesAnalysisOutboxError> {
        if stream.trim().is_empty()
            || !(1..=MAXIMUM_BATCH_SIZE).contains(&batch_size)
            || claim_ttl.is_zero()
            || maximum_publish_backoff.is_zero()
            || semantic_redelivery_after.is_zero()
        {
            return Err(SeriesAnalysisOutboxError::InvalidConfiguration);
        }
        i64::try_from(semantic_redelivery_after.as_millis())
            .map_err(SeriesAnalysisOutboxError::DurationBound)?;
        Ok(Self {
            stream,
            batch_size,
            claim_ttl,
            maximum_publish_backoff,
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
        let wall_now = SystemTime::now();
        let monotonic_now = Instant::now();
        let redeliver_before = wall_now
            .checked_sub(self.config.semantic_redelivery_after)
            .ok_or(SeriesAnalysisOutboxError::TimeBound)?;
        let claim_until = wall_now
            .checked_add(self.config.claim_ttl)
            .ok_or(SeriesAnalysisOutboxError::TimeBound)?;
        let reconciled = self.reconcile_queued(wall_now, redeliver_before).await?;
        let claims = self.claim_due(wall_now, claim_until).await?;
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
        if reconciled > 0 || claimed > 0 {
            info!(
                event = "analysis_outbox_batch_progress",
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
            .next_deadline()
            .await?
            .map(|deadline| wall_deadline_to_monotonic(wall_now, monotonic_now, deadline));
        Ok(DrainBatch::idle(next.transpose()?))
    }

    async fn reconcile_queued(
        &mut self,
        now: SystemTime,
        redeliver_before: SystemTime,
    ) -> Result<u64, SeriesAnalysisOutboxError> {
        let limit =
            i64::try_from(self.config.batch_size).map_err(SeriesAnalysisOutboxError::BatchBound)?;
        let transaction = self.database.transaction().await?;
        let inserted = transaction
            .execute(
                r"
                WITH candidates AS (
                  SELECT j.id, j.input_revision
                  FROM series_analysis_jobs j
                  WHERE j.status = 'queued'
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
                          OR (q.status = 'delivered' AND q.delivered_at >= $2)
                        )
                    )
                  ORDER BY j.available_at, j.requested_at, j.id
                  LIMIT $3
                  FOR UPDATE SKIP LOCKED
                )
                INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key, next_attempt_at)
                SELECT
                  'analysis-reconcile-' || md5(
                    id || ':' || input_revision::text || ':' || ($1::timestamptz)::text
                  ),
                  id,
                  'reconcile:' || id || ':' || input_revision::text || ':'
                    || ($1::timestamptz)::text,
                  $1::timestamptz
                FROM candidates
                ON CONFLICT (dedupe_key) DO NOTHING
                ",
                &[&now, &redeliver_before, &limit],
            )
            .await?;
        transaction.commit().await?;
        Ok(inserted)
    }

    async fn claim_due(
        &mut self,
        now: SystemTime,
        claim_until: SystemTime,
    ) -> Result<Vec<OutboxClaim>, SeriesAnalysisOutboxError> {
        let limit =
            i64::try_from(self.config.batch_size).map_err(SeriesAnalysisOutboxError::BatchBound)?;
        let transaction = self.database.transaction().await?;
        let rows = transaction
            .query(
                r"
                WITH candidate AS (
                  SELECT id
                  FROM series_analysis_queue_outbox
                  WHERE (status = 'pending' AND next_attempt_at <= $1)
                     OR (status = 'in_flight' AND claim_expires_at < $1)
                  ORDER BY next_attempt_at, created_at, id
                  LIMIT $2
                  FOR UPDATE SKIP LOCKED
                )
                UPDATE series_analysis_queue_outbox q
                SET status = 'in_flight',
                    claim_expires_at = $3,
                    last_attempt_at = $1,
                    updated_at = $1
                FROM candidate
                WHERE q.id = candidate.id
                RETURNING q.id, q.job_id, q.attempt_count, q.claim_expires_at
                ",
                &[&now, &limit, &claim_until],
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
                let delivered = self
                    .mark_delivered(claim, &message_id, SystemTime::now())
                    .await?;
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
                let now = SystemTime::now();
                let retry_delay =
                    delivery_retry_delay(claim.attempt_count, self.config.maximum_publish_backoff)?;
                let next_attempt_at = now
                    .checked_add(retry_delay)
                    .ok_or(SeriesAnalysisOutboxError::TimeBound)?;
                let released = self.release_for_retry(claim, next_attempt_at, now).await?;
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
        now: SystemTime,
    ) -> Result<bool, SeriesAnalysisOutboxError> {
        let updated = self
            .database
            .execute(
                r"
                UPDATE series_analysis_queue_outbox
                SET status = 'delivered',
                    claim_expires_at = NULL,
                    redis_message_id = $3,
                    delivered_at = $4,
                    last_error = NULL,
                    updated_at = $4
                WHERE id = $1
                  AND status = 'in_flight'
                  AND claim_expires_at = $2
                ",
                &[&claim.id, &claim.claim_expires_at, &redis_message_id, &now],
            )
            .await?;
        Ok(updated == 1)
    }

    async fn release_for_retry(
        &mut self,
        claim: &OutboxClaim,
        next_attempt_at: SystemTime,
        now: SystemTime,
    ) -> Result<bool, SeriesAnalysisOutboxError> {
        let transaction = self.database.transaction().await?;
        let released = transaction
            .query_opt(
                r"
                UPDATE series_analysis_queue_outbox
                SET status = CASE WHEN attempt_count + 1 >= 3 THEN 'failed' ELSE 'pending' END,
                    attempt_count = attempt_count + 1,
                    claim_expires_at = NULL,
                    next_attempt_at = $3,
                    last_error = $4,
                    updated_at = $5
                WHERE id = $1
                  AND status = 'in_flight'
                  AND claim_expires_at = $2
                RETURNING job_id, status
                ",
                &[
                    &claim.id,
                    &claim.claim_expires_at,
                    &next_attempt_at,
                    &QUEUE_PUBLISH_ERROR_CLASS,
                    &now,
                ],
            )
            .await?
            .map(|row| decode_delivery_failure(&row))
            .transpose()?;
        if let Some(failure) = &released
            && failure.status == "failed"
        {
            fail_undeliverable_job(&transaction, &failure.job_id, now).await?;
        }
        transaction.commit().await?;
        Ok(released.is_some())
    }

    async fn next_deadline(&self) -> Result<Option<SystemTime>, SeriesAnalysisOutboxError> {
        let redelivery_millis = i64::try_from(self.config.semantic_redelivery_after.as_millis())
            .map_err(SeriesAnalysisOutboxError::DurationBound)?;
        let row = self
            .database
            .query_one(
                r"
                WITH semantic_deadlines AS (
                  SELECT CASE
                    WHEN COUNT(q.id) FILTER (WHERE q.status = 'delivered') = 0
                      THEN j.available_at
                    ELSE MAX(q.delivered_at) FILTER (WHERE q.status = 'delivered')
                      + ($1::bigint * interval '1 millisecond')
                  END AS wake_at
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
                  SELECT MIN(next_attempt_at) AS wake_at
                  FROM series_analysis_queue_outbox WHERE status = 'pending'
                  UNION ALL
                  SELECT MIN(claim_expires_at) AS wake_at
                  FROM series_analysis_queue_outbox WHERE status = 'in_flight'
                  UNION ALL
                  SELECT MIN(wake_at) AS wake_at FROM semantic_deadlines
                )
                SELECT MIN(wake_at) AS wake_at FROM deadlines
                ",
                &[&redelivery_millis],
            )
            .await?;
        row.try_get("wake_at")
            .map_err(SeriesAnalysisOutboxError::InvalidRecord)
    }
}

impl OutboxDriver for SeriesAnalysisOutboxDriver {
    type Error = SeriesAnalysisOutboxError;

    fn drain_batch(&mut self) -> impl Future<Output = Result<DrainBatch, Self::Error>> + Send {
        self.drain_once()
    }

    fn failure_kind(error: &Self::Error) -> DriverFailureKind {
        match error {
            SeriesAnalysisOutboxError::Postgres(_) => DriverFailureKind::Recoverable,
            SeriesAnalysisOutboxError::InvalidConfiguration
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

fn delivery_retry_delay(
    attempt_count: i32,
    maximum: Duration,
) -> Result<Duration, SeriesAnalysisOutboxError> {
    let index = usize::try_from(attempt_count)
        .map_err(|_invalid| SeriesAnalysisOutboxError::InvalidRecordValue)?;
    let seconds = DELIVERY_RETRY_SECONDS
        .get(index)
        .copied()
        .ok_or(SeriesAnalysisOutboxError::InvalidRecordValue)?;
    Ok(Duration::from_secs(seconds).min(maximum))
}

fn wall_deadline_to_monotonic(
    wall_now: SystemTime,
    monotonic_now: Instant,
    wall_deadline: SystemTime,
) -> Result<Instant, SeriesAnalysisOutboxError> {
    let delay = wall_deadline.duration_since(wall_now).unwrap_or_default();
    monotonic_now
        .checked_add(delay)
        .ok_or(SeriesAnalysisOutboxError::TimeBound)
}

async fn fail_undeliverable_job(
    transaction: &Transaction<'_>,
    job_id: &str,
    now: SystemTime,
) -> Result<(), SeriesAnalysisOutboxError> {
    let failed = transaction
        .query_opt(
            r"
            UPDATE series_analysis_jobs j
            SET status = 'failed',
                finished_at = $2,
                safe_failure_code = 'dependency_retry_exhausted',
                updated_at = $2
            WHERE j.id = $1
              AND j.status = 'queued'
              AND NOT EXISTS (
                SELECT 1 FROM series_analysis_queue_outbox q
                WHERE q.job_id = j.id AND q.status IN ('pending', 'in_flight', 'delivered')
              )
            RETURNING game_title_id
            ",
            &[&job_id, &now],
        )
        .await?;
    let Some(failed) = failed else {
        return Ok(());
    };
    let game_title_id: String = failed
        .try_get("game_title_id")
        .map_err(SeriesAnalysisOutboxError::InvalidRecord)?;
    transaction
        .execute(
            r"
            UPDATE series_analysis_title_states
            SET pending_work = true,
                last_failure_code = 'dependency_retry_exhausted',
                last_failure_at = $2,
                updated_at = $2
            WHERE game_title_id = $1
            ",
            &[&game_title_id, &now],
        )
        .await?;
    transaction
        .execute(
            r"
            UPDATE series_analysis_job_requests
            SET status = 'fulfilled', fulfilled_at = $2
            WHERE assigned_job_id = $1 AND status <> 'fulfilled'
            ",
            &[&job_id, &now],
        )
        .await?;
    let campaign_rows = transaction
        .query(
            r"
            UPDATE series_analysis_campaign_targets t
            SET status = 'failed', updated_at = $2
            FROM series_analysis_job_requests r
            WHERE t.job_request_id = r.id
              AND r.assigned_job_id = $1
              AND t.status NOT IN ('succeeded', 'failed', 'skipped_title_deleted')
            RETURNING t.campaign_id
            ",
            &[&job_id, &now],
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
        refresh_campaign(transaction, &campaign_id, now).await?;
    }
    transaction
        .execute(
            r"
            UPDATE series_analysis_operation_requests o
            SET status = 'terminal', finished_at = COALESCE(o.finished_at, $2)
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
            &[&job_id, &now],
        )
        .await?;
    Ok(())
}

async fn refresh_campaign(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    now: SystemTime,
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
                  WHEN counts.terminal_count = c.target_count THEN COALESCE(c.finished_at, $2)
                  ELSE NULL
                END
            FROM counts
            WHERE c.id = $1
            ",
            &[&campaign_id, &now],
        )
        .await?;
    transaction
        .execute(
            r"
            UPDATE series_analysis_operation_requests o
            SET status = CASE WHEN c.status = 'terminal' THEN 'terminal' ELSE 'running' END,
                finished_at = CASE
                  WHEN c.status = 'terminal' THEN COALESCE(o.finished_at, c.finished_at, $2)
                  ELSE NULL
                END
            FROM series_analysis_campaigns c
            WHERE c.id = $1
              AND o.id = c.operation_request_id
            ",
            &[&campaign_id, &now],
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::error::Error;

    use redis::{AsyncCommands, streams::StreamRangeReply};

    use super::*;

    type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

    const TITLE_ID: &str = "analysis-outbox-smoke-title";
    const JOB_ID: &str = "analysis-outbox-smoke-job";
    const OUTBOX_ID: &str = "analysis-outbox-smoke-delivery";
    const STREAM: &str = "analysis-outbox-smoke-stream";

    #[test]
    fn payload_and_durable_retry_schedule_preserve_the_existing_contract() {
        assert_eq!(
            queue_fields("analysis-job-1"),
            [
                ("schemaVersion", String::from("1")),
                ("jobId", String::from("analysis-job-1")),
            ]
        );
        assert_eq!(
            (0..=2)
                .map(|attempt| delivery_retry_delay(attempt, Duration::from_mins(1)))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string()),
            Ok(vec![
                Duration::from_secs(2),
                Duration::from_secs(4),
                Duration::from_secs(8),
            ])
        );
    }

    #[test]
    fn configuration_rejects_unbounded_or_immediate_work() {
        assert!(matches!(
            SeriesAnalysisOutboxConfig::new(
                String::new(),
                0,
                Duration::ZERO,
                Duration::ZERO,
                Duration::ZERO,
            ),
            Err(SeriesAnalysisOutboxError::InvalidConfiguration)
        ));
        assert!(
            SeriesAnalysisOutboxConfig::new(
                String::from("analysis-stream"),
                10,
                Duration::from_secs(30),
                Duration::from_mins(1),
                Duration::from_mins(5),
            )
            .is_ok()
        );
        assert!(SeriesAnalysisOutboxConfig::for_runtime(String::from("analysis-stream")).is_ok());
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_OUTBOX_SMOKE_DATABASE_URL and ANALYSIS_OUTBOX_SMOKE_REDIS_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the isolated database and Redis scenario keeps durable boundaries visible"
    )]
    async fn real_postgres_and_redis_preserve_claim_and_payload_contract() -> SmokeResult {
        let database_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_DATABASE_URL")?;
        let redis_url = std::env::var("ANALYSIS_OUTBOX_SMOKE_REDIS_URL")?;
        let database = crate::postgres::connect(&database_url).await?;
        let redis_client = redis::Client::open(redis_url)?;
        let mut observer = redis_client.get_connection_manager().await?;
        let _: usize = observer.del(STREAM).await?;
        database
            .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
            .await?;
        database
            .execute(
                "INSERT INTO game_titles (id, name, layout_family, display_order) VALUES ($1, $2, $3, $4)",
                &[&TITLE_ID, &"Analysis outbox smoke", &"momotetsu2", &9_999_i32],
            )
            .await?;
        database
            .execute(
                r"
                INSERT INTO series_analysis_jobs (
                  id, game_title_id, input_revision, algorithm_version,
                  artifact_schema_version, status, trigger, requested_at, available_at
                ) VALUES ($1, $2, 1, 'series-analysis-v1', 1, 'queued', 'manual', now(), now())
                ",
                &[&JOB_ID, &TITLE_ID],
            )
            .await?;
        database
            .execute(
                r"
                INSERT INTO series_analysis_queue_outbox (
                  id, job_id, dedupe_key, next_attempt_at, created_at, updated_at
                ) VALUES ($1, $2, $3, now(), now(), now())
                ",
                &[&OUTBOX_ID, &JOB_ID, &"analysis-outbox-smoke-dedupe"],
            )
            .await?;

        let config = SeriesAnalysisOutboxConfig::new(
            String::from(STREAM),
            10,
            Duration::from_secs(30),
            Duration::from_mins(1),
            Duration::from_mins(5),
        )?;
        let redis = redis_client.get_connection_manager().await?;
        let mut driver = SeriesAnalysisOutboxDriver::new(database, redis, config);

        let _: () = observer.set(STREAM, "force-wrong-type").await?;
        assert_eq!(driver.drain_once().await?, DrainBatch::progress());
        let retry_state = driver
            .database
            .query_one(
                "SELECT status, attempt_count, next_attempt_at > last_attempt_at AS delayed FROM series_analysis_queue_outbox WHERE id = $1",
                &[&OUTBOX_ID],
            )
            .await?;
        assert_eq!(retry_state.try_get::<_, String>("status")?, "pending");
        assert_eq!(retry_state.try_get::<_, i32>("attempt_count")?, 1);
        assert!(retry_state.try_get::<_, bool>("delayed")?);

        let _: usize = observer.del(STREAM).await?;
        driver
            .database
            .execute(
                "UPDATE series_analysis_queue_outbox SET next_attempt_at = now() WHERE id = $1",
                &[&OUTBOX_ID],
            )
            .await?;
        assert_eq!(driver.drain_once().await?, DrainBatch::progress());
        let state = driver
            .database
            .query_one(
                "SELECT status, redis_message_id FROM series_analysis_queue_outbox WHERE id = $1",
                &[&OUTBOX_ID],
            )
            .await?;
        let status: String = state.try_get("status")?;
        let message_id: Option<String> = state.try_get("redis_message_id")?;
        assert_eq!(status, "delivered");

        let entries: StreamRangeReply = observer.xrange_all(STREAM).await?;
        let entry = entries.ids.first().ok_or("Redis stream entry is missing")?;
        assert_eq!(message_id.as_deref(), Some(entry.id.as_str()));
        assert_eq!(entry.get::<String>("schemaVersion").as_deref(), Some("1"));
        assert_eq!(entry.get::<String>("jobId").as_deref(), Some(JOB_ID));

        let idle = driver.drain_once().await?;
        assert_ne!(idle, DrainBatch::progress());
        assert_ne!(idle, DrainBatch::idle(None));

        driver
            .database
            .execute(
                "UPDATE series_analysis_queue_outbox SET delivered_at = now() - interval '6 minutes' WHERE id = $1",
                &[&OUTBOX_ID],
            )
            .await?;
        assert_eq!(driver.drain_once().await?, DrainBatch::progress());
        let entries_after_redelivery: StreamRangeReply = observer.xrange_all(STREAM).await?;
        assert_eq!(entries_after_redelivery.ids.len(), 2);

        let _: usize = observer.del(STREAM).await?;
        driver
            .database
            .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
            .await?;
        Ok(())
    }
}
