use std::env;

use clap::ValueEnum;
use momo_analysis_core::{canonical, contract::ARTIFACT_SCHEMA_VERSION};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio_postgres::{Client, Row, Transaction};

use crate::postgres::{PostgresError, connect};

use super::control::ALGORITHM_VERSION;

const CAPABILITY_FRESH_SECONDS: i64 = 60;
const RELEASE_TRANSACTION_LIMITS: &str = "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; \
     SET LOCAL idle_in_transaction_session_timeout = '30s'";
const RELEASE_READ_LIMITS: &str = "SET lock_timeout = '5s'; SET statement_timeout = '30s'; \
     SET idle_in_transaction_session_timeout = '30s'";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum PromotionTrigger {
    AlgorithmUpdate,
    ArtifactSchemaUpdate,
    InitialBackfill,
}

impl PromotionTrigger {
    const fn wire(self) -> &'static str {
        match self {
            Self::AlgorithmUpdate => "algorithm_update",
            Self::ArtifactSchemaUpdate => "artifact_schema_update",
            Self::InitialBackfill => "initial_backfill",
        }
    }
}

#[derive(Clone, Debug)]
pub struct PromotionRequest<'a> {
    pub trigger: PromotionTrigger,
    pub operation_key: &'a str,
    pub apply: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionReport {
    pub mode: &'static str,
    pub trigger: PromotionTrigger,
    pub operation_id: String,
    pub campaign_id: String,
    pub target_count: usize,
    pub compatible_reader_count: i64,
    pub compatible_worker_count: i64,
    pub idempotent_replay: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletenessReport {
    pub passed: bool,
    pub require_current: bool,
    pub require_quiescent: bool,
    pub title_count: usize,
    pub current_artifact_count: usize,
    pub active_job_count: i64,
    pub failed_outbox_count: i64,
    pub compatible_reader_count: i64,
    pub compatible_worker_count: i64,
    pub violations: Vec<CompletenessViolation>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletenessViolation {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_title_id: Option<String>,
}

#[derive(Debug, Error)]
pub enum ReleaseError {
    #[error("DATABASE_URL must be set for release inspection")]
    MissingDatabaseUrl,
    #[error("release operation key must be 8 to 128 visible characters")]
    InvalidOperationKey,
    #[error("analysis database connection failed")]
    Database(#[from] PostgresError),
    #[error("analysis release database operation failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("analysis release database operation failed phase={phase}")]
    PostgresPhase {
        phase: &'static str,
        #[source]
        source: tokio_postgres::Error,
    },
    #[error("no eligible game title exists for this release operation")]
    NoEligibleTitle,
    #[error("no fresh compatible API reader is registered")]
    ReaderNotReady,
    #[error("a fresh API reader does not support the target artifact schema")]
    ReaderIncompatible,
    #[error("no fresh compatible analysis worker is registered")]
    WorkerNotReady,
    #[error("a fresh analysis worker does not support the target version")]
    WorkerIncompatible,
    #[error("the release operation key is already bound to different parameters")]
    IdempotencyConflict,
    #[error("release metadata exceeds a supported numeric bound")]
    NumericBound(#[from] std::num::TryFromIntError),
}

#[derive(Clone, Copy, Debug)]
struct CapabilityCounts {
    compatible: i64,
    incompatible: i64,
}

#[derive(Clone, Debug)]
struct TargetRow {
    game_title_id: String,
}

#[derive(Clone, Debug)]
struct ExistingOperation {
    endpoint: String,
    key_hash: String,
    target_count: i32,
    campaign_id: String,
    trigger: String,
    algorithm_version: String,
    artifact_schema_version: i32,
}

#[derive(Clone, Debug)]
struct TitleAuditRow {
    game_title_id: String,
    confirmed_match_count: i64,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    pending_work: bool,
    current_artifact_id: Option<String>,
    current_status: Option<String>,
    current_input_revision: Option<i64>,
    current_algorithm_version: Option<String>,
    current_artifact_schema_version: Option<i32>,
    declared_aggregate_count: Option<i32>,
    declared_review_count: Option<i32>,
    declared_drilldown_count: Option<i32>,
    declared_context_count: Option<i32>,
    actual_aggregate_count: i64,
    actual_review_count: i64,
    actual_drilldown_count: i64,
    actual_context_count: i64,
    invalid_chunk_count: i64,
}

/// Creates a version/backfill campaign only when all fresh readers and workers support it.
///
/// The operation is a rollback-only dry run unless `request.apply` is true. Stable identifiers
/// make re-running an applied operation key return the existing campaign without duplication.
///
/// # Errors
///
/// Returns a safe error for unavailable capabilities, conflicting idempotency, or database failure.
pub async fn promote(request: &PromotionRequest<'_>) -> Result<PromotionReport, ReleaseError> {
    validate_operation_key(request.operation_key)?;
    let database_url = database_url()?;
    let mut client = connect(&database_url).await?;
    let transaction = client
        .transaction()
        .await
        .map_err(|source| postgres_phase("begin", source))?;
    transaction
        .batch_execute(RELEASE_TRANSACTION_LIMITS)
        .await
        .map_err(|source| postgres_phase("transaction_limits", source))?;
    transaction
        .query_one(
            "SELECT pg_advisory_xact_lock(hashtext('momo-series-analysis-release'))",
            &[],
        )
        .await
        .map_err(|source| postgres_phase("advisory_lock", source))?;

    let key_hash = sha256_prefixed(request.operation_key.as_bytes());
    let operation_id = stable_id("analysis-release-operation", &key_hash, "all");
    let campaign_id = stable_id("analysis-release-campaign", &key_hash, "all");
    let endpoint = format!("release:{}", request.trigger.wire());
    if let Some(existing) = existing_operation(&transaction, &operation_id)
        .await
        .map_err(|source| postgres_phase("existing_operation", source))?
    {
        validate_existing(&existing, &endpoint, &key_hash, request.trigger)?;
        let readers = reader_capabilities(&transaction)
            .await
            .map_err(|source| postgres_phase("replay_reader_capabilities", source))?;
        let workers = worker_capabilities(&transaction)
            .await
            .map_err(|source| postgres_phase("replay_worker_capabilities", source))?;
        let report = PromotionReport {
            mode: if request.apply { "apply" } else { "dry_run" },
            trigger: request.trigger,
            operation_id,
            campaign_id: existing.campaign_id,
            target_count: usize::try_from(existing.target_count)?,
            compatible_reader_count: readers.compatible,
            compatible_worker_count: workers.compatible,
            idempotent_replay: true,
        };
        transaction
            .rollback()
            .await
            .map_err(|source| postgres_phase("replay_rollback", source))?;
        return Ok(report);
    }

    let readers = reader_capabilities(&transaction)
        .await
        .map_err(|source| postgres_phase("reader_capabilities", source))?;
    validate_readers(readers)?;
    let workers = worker_capabilities(&transaction)
        .await
        .map_err(|source| postgres_phase("worker_capabilities", source))?;
    validate_workers(workers)?;
    let targets = lock_targets(&transaction, request.trigger)
        .await
        .map_err(|source| postgres_phase("lock_targets", source))?;
    if targets.is_empty() {
        return Err(ReleaseError::NoEligibleTitle);
    }
    if request.apply {
        let identity = PromotionIdentity {
            operation_id: &operation_id,
            campaign_id: &campaign_id,
            endpoint: &endpoint,
            key_hash: &key_hash,
        };
        apply_promotion(&transaction, request, &targets, &identity).await?;
        transaction
            .commit()
            .await
            .map_err(|source| postgres_phase("commit", source))?;
    } else {
        transaction
            .rollback()
            .await
            .map_err(|source| postgres_phase("dry_run_rollback", source))?;
    }

    Ok(PromotionReport {
        mode: if request.apply { "apply" } else { "dry_run" },
        trigger: request.trigger,
        operation_id,
        campaign_id,
        target_count: targets.len(),
        compatible_reader_count: readers.compatible,
        compatible_worker_count: workers.compatible,
        idempotent_replay: false,
    })
}

/// Inspects desired/current versions, chunk counts, pending work, and live capabilities.
///
/// # Errors
///
/// Returns a safe error only when the inspection itself cannot complete. An inconsistent system is
/// represented by `passed = false` and deterministic violation codes.
pub async fn audit_completeness(
    require_current: bool,
    require_quiescent: bool,
) -> Result<CompletenessReport, ReleaseError> {
    let database_url = database_url()?;
    let client = connect(&database_url).await?;
    client.batch_execute(RELEASE_READ_LIMITS).await?;
    let readers = reader_capabilities(&client).await?;
    let workers = worker_capabilities(&client).await?;
    let rows = title_audit_rows(&client).await?;
    let active_job_count = client
        .query_one(
            "SELECT COUNT(*)::bigint FROM series_analysis_jobs WHERE status IN ('queued','running')",
            &[],
        )
        .await?
        .try_get(0)?;
    let failed_outbox_count = client
        .query_one(
            "SELECT COUNT(*)::bigint FROM series_analysis_queue_outbox WHERE status = 'failed'",
            &[],
        )
        .await?
        .try_get(0)?;
    let mut violations = Vec::new();
    if readers.compatible == 0 {
        violations.push(global_violation("reader_not_ready"));
    }
    if readers.incompatible > 0 {
        violations.push(global_violation("reader_incompatible"));
    }
    if workers.compatible == 0 {
        violations.push(global_violation("worker_not_ready"));
    }
    if workers.incompatible > 0 {
        violations.push(global_violation("worker_incompatible"));
    }
    if failed_outbox_count > 0 {
        violations.push(global_violation("failed_outbox"));
    }
    if require_quiescent && active_job_count > 0 {
        violations.push(global_violation("active_jobs"));
    }
    for row in &rows {
        inspect_title(row, require_current, require_quiescent, &mut violations);
    }
    Ok(CompletenessReport {
        passed: violations.is_empty(),
        require_current,
        require_quiescent,
        title_count: rows.len(),
        current_artifact_count: rows
            .iter()
            .filter(|row| row.current_artifact_id.is_some())
            .count(),
        active_job_count,
        failed_outbox_count,
        compatible_reader_count: readers.compatible,
        compatible_worker_count: workers.compatible,
        violations,
    })
}

async fn reader_capabilities<C>(client: &C) -> Result<CapabilityCounts, tokio_postgres::Error>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let supported_schemas = json!([ARTIFACT_SCHEMA_VERSION]);
    let row = client
        .query_one(
            "SELECT \
               COUNT(*) FILTER (WHERE artifact_schema_versions @> $1::jsonb)::bigint, \
               COUNT(*) FILTER (WHERE NOT artifact_schema_versions @> $1::jsonb)::bigint \
             FROM series_analysis_reader_capabilities \
             WHERE draining = false \
               AND heartbeat_at >= clock_timestamp() - ($2::bigint * interval '1 second')",
            &[&supported_schemas, &CAPABILITY_FRESH_SECONDS],
        )
        .await?;
    Ok(CapabilityCounts {
        compatible: row.try_get(0)?,
        incompatible: row.try_get(1)?,
    })
}

async fn worker_capabilities<C>(client: &C) -> Result<CapabilityCounts, tokio_postgres::Error>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let supported_algorithms = json!([ALGORITHM_VERSION]);
    let supported_schemas = json!([ARTIFACT_SCHEMA_VERSION]);
    let row = client
        .query_one(
            "SELECT \
               COUNT(*) FILTER (WHERE algorithm_versions @> $1::jsonb \
                 AND artifact_schema_versions @> $2::jsonb)::bigint, \
               COUNT(*) FILTER (WHERE NOT (algorithm_versions @> $1::jsonb \
                 AND artifact_schema_versions @> $2::jsonb))::bigint \
             FROM series_analysis_worker_capabilities \
             WHERE draining = false \
               AND heartbeat_at >= clock_timestamp() - ($3::bigint * interval '1 second')",
            &[
                &supported_algorithms,
                &supported_schemas,
                &CAPABILITY_FRESH_SECONDS,
            ],
        )
        .await?;
    Ok(CapabilityCounts {
        compatible: row.try_get(0)?,
        incompatible: row.try_get(1)?,
    })
}

const fn validate_readers(counts: CapabilityCounts) -> Result<(), ReleaseError> {
    if counts.incompatible > 0 {
        Err(ReleaseError::ReaderIncompatible)
    } else if counts.compatible == 0 {
        Err(ReleaseError::ReaderNotReady)
    } else {
        Ok(())
    }
}

const fn validate_workers(counts: CapabilityCounts) -> Result<(), ReleaseError> {
    if counts.incompatible > 0 {
        Err(ReleaseError::WorkerIncompatible)
    } else if counts.compatible == 0 {
        Err(ReleaseError::WorkerNotReady)
    } else {
        Ok(())
    }
}

async fn existing_operation(
    transaction: &Transaction<'_>,
    operation_id: &str,
) -> Result<Option<ExistingOperation>, tokio_postgres::Error> {
    let row = transaction
        .query_opt(
            "SELECT o.endpoint, o.idempotency_key_hash, o.target_count, c.id, c.trigger, \
               c.algorithm_version, c.artifact_schema_version \
             FROM series_analysis_operation_requests o \
             JOIN series_analysis_campaigns c ON c.operation_request_id = o.id \
             WHERE o.id = $1",
            &[&operation_id],
        )
        .await?;
    row.map(|value| {
        Ok(ExistingOperation {
            endpoint: value.try_get(0)?,
            key_hash: value.try_get(1)?,
            target_count: value.try_get(2)?,
            campaign_id: value.try_get(3)?,
            trigger: value.try_get(4)?,
            algorithm_version: value.try_get(5)?,
            artifact_schema_version: value.try_get(6)?,
        })
    })
    .transpose()
}

fn validate_existing(
    existing: &ExistingOperation,
    endpoint: &str,
    key_hash: &str,
    trigger: PromotionTrigger,
) -> Result<(), ReleaseError> {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    if existing.endpoint == endpoint
        && existing.key_hash == key_hash
        && existing.trigger == trigger.wire()
        && existing.algorithm_version == ALGORITHM_VERSION
        && existing.artifact_schema_version == schema
    {
        Ok(())
    } else {
        Err(ReleaseError::IdempotencyConflict)
    }
}

async fn lock_targets(
    transaction: &Transaction<'_>,
    trigger: PromotionTrigger,
) -> Result<Vec<TargetRow>, tokio_postgres::Error> {
    let predicate = if trigger == PromotionTrigger::InitialBackfill {
        "WHERE EXISTS (SELECT 1 FROM matches m WHERE m.game_title_id = s.game_title_id)"
    } else {
        ""
    };
    let query = format!(
        "SELECT s.game_title_id \
         FROM series_analysis_title_states s {predicate} \
         ORDER BY s.game_title_id FOR UPDATE"
    );
    let rows = transaction.query(&query, &[]).await?;
    rows.into_iter()
        .map(|row| {
            Ok(TargetRow {
                game_title_id: row.try_get(0)?,
            })
        })
        .collect()
}

struct PromotionIdentity<'a> {
    operation_id: &'a str,
    campaign_id: &'a str,
    endpoint: &'a str,
    key_hash: &'a str,
}

async fn apply_promotion(
    transaction: &Transaction<'_>,
    request: &PromotionRequest<'_>,
    targets: &[TargetRow],
    identity: &PromotionIdentity<'_>,
) -> Result<(), ReleaseError> {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    let target_count = i32::try_from(targets.len())?;
    let title_ids = targets
        .iter()
        .map(|target| target.game_title_id.as_str())
        .collect::<Vec<_>>();
    transaction
        .execute(
            "UPDATE series_analysis_title_states \
             SET algorithm_version = $1, artifact_schema_version = $2, pending_work = true, \
                 updated_at = clock_timestamp() \
             WHERE game_title_id = ANY($3)",
            &[&ALGORITHM_VERSION, &schema, &title_ids],
        )
        .await?;
    transaction
        .execute(
            "INSERT INTO series_analysis_operation_requests ( \
               id, scope, requested_by_account_id, idempotency_key_hash, endpoint, status, \
               target_count, accepted_at \
             ) VALUES ($1, 'all_titles', NULL, $2, $3, 'running', $4, clock_timestamp())",
            &[
                &identity.operation_id,
                &identity.key_hash,
                &identity.endpoint,
                &target_count,
            ],
        )
        .await?;
    transaction
        .execute(
            "INSERT INTO series_analysis_campaigns ( \
               id, operation_request_id, trigger, algorithm_version, artifact_schema_version, \
               status, target_count, accepted_at \
             ) VALUES ($1, $2, $3, $4, $5, 'expanding', $6, clock_timestamp())",
            &[
                &identity.campaign_id,
                &identity.operation_id,
                &request.trigger.wire(),
                &ALGORITHM_VERSION,
                &schema,
                &target_count,
            ],
        )
        .await?;
    transaction
        .execute(
            "INSERT INTO series_analysis_campaign_targets ( \
               campaign_id, game_title_id, input_revision, algorithm_version, \
               artifact_schema_version, status, job_request_id, accepted_at \
             ) SELECT $1, s.game_title_id, s.input_revision, s.algorithm_version, \
                      s.artifact_schema_version, 'pending', NULL, c.accepted_at \
               FROM series_analysis_title_states s \
               CROSS JOIN series_analysis_campaigns c \
              WHERE c.id = $1 AND s.game_title_id = ANY($2) \
              ORDER BY s.game_title_id",
            &[&identity.campaign_id, &title_ids],
        )
        .await?;
    Ok(())
}

async fn title_audit_rows(client: &Client) -> Result<Vec<TitleAuditRow>, tokio_postgres::Error> {
    let rows = client
        .query(
            "SELECT s.game_title_id, \
               (SELECT COUNT(*)::bigint FROM matches m WHERE m.game_title_id = s.game_title_id), \
               s.input_revision, s.algorithm_version, s.artifact_schema_version, s.pending_work, \
               s.current_artifact_id, a.status, a.input_revision, a.algorithm_version, \
               a.artifact_schema_version, a.aggregate_chunk_count, a.review_chunk_count, \
               a.drilldown_chunk_count, a.match_context_chunk_count, \
               (SELECT COUNT(*)::bigint FROM series_analysis_scope_aggregate_artifacts c \
                 WHERE c.artifact_id = a.id), \
               (SELECT COUNT(*)::bigint FROM series_analysis_scope_review_artifacts c \
                 WHERE c.artifact_id = a.id), \
               (SELECT COUNT(*)::bigint FROM series_analysis_drilldown_artifacts c \
                 WHERE c.artifact_id = a.id), \
               (SELECT COUNT(*)::bigint FROM series_analysis_match_context_artifacts c \
                 WHERE c.artifact_id = a.id), \
               (SELECT COUNT(*)::bigint FROM ( \
                 SELECT encoded_bytes, decoded_bytes, payload FROM series_analysis_scope_aggregate_artifacts WHERE artifact_id = a.id \
                 UNION ALL SELECT encoded_bytes, decoded_bytes, payload FROM series_analysis_scope_review_artifacts WHERE artifact_id = a.id \
                 UNION ALL SELECT encoded_bytes, decoded_bytes, payload FROM series_analysis_drilldown_artifacts WHERE artifact_id = a.id \
                 UNION ALL SELECT encoded_bytes, decoded_bytes, payload FROM series_analysis_match_context_artifacts WHERE artifact_id = a.id \
               ) chunks WHERE chunks.encoded_bytes <> chunks.decoded_bytes \
                 OR chunks.encoded_bytes <> octet_length(chunks.payload)) \
             FROM series_analysis_title_states s \
             LEFT JOIN series_analysis_artifacts a ON a.id = s.current_artifact_id \
             ORDER BY s.game_title_id",
            &[],
        )
        .await?;
    rows.iter().map(decode_title_audit_row).collect()
}

fn decode_title_audit_row(row: &Row) -> Result<TitleAuditRow, tokio_postgres::Error> {
    Ok(TitleAuditRow {
        game_title_id: row.try_get(0)?,
        confirmed_match_count: row.try_get(1)?,
        input_revision: row.try_get(2)?,
        algorithm_version: row.try_get(3)?,
        artifact_schema_version: row.try_get(4)?,
        pending_work: row.try_get(5)?,
        current_artifact_id: row.try_get(6)?,
        current_status: row.try_get(7)?,
        current_input_revision: row.try_get(8)?,
        current_algorithm_version: row.try_get(9)?,
        current_artifact_schema_version: row.try_get(10)?,
        declared_aggregate_count: row.try_get(11)?,
        declared_review_count: row.try_get(12)?,
        declared_drilldown_count: row.try_get(13)?,
        declared_context_count: row.try_get(14)?,
        actual_aggregate_count: row.try_get(15)?,
        actual_review_count: row.try_get(16)?,
        actual_drilldown_count: row.try_get(17)?,
        actual_context_count: row.try_get(18)?,
        invalid_chunk_count: row.try_get(19)?,
    })
}

fn inspect_title(
    row: &TitleAuditRow,
    require_current: bool,
    require_quiescent: bool,
    violations: &mut Vec<CompletenessViolation>,
) {
    let title = || Some(row.game_title_id.clone());
    if require_current && row.confirmed_match_count > 0 && row.current_artifact_id.is_none() {
        violations.push(CompletenessViolation {
            code: "current_artifact_missing",
            game_title_id: title(),
        });
    }
    if require_quiescent && row.pending_work {
        violations.push(CompletenessViolation {
            code: "pending_work",
            game_title_id: title(),
        });
    }
    if row.current_artifact_id.is_some()
        && (row.current_status.as_deref() != Some("published")
            || row.current_input_revision != Some(row.input_revision)
            || row.current_algorithm_version.as_deref() != Some(row.algorithm_version.as_str())
            || row.current_artifact_schema_version != Some(row.artifact_schema_version))
    {
        violations.push(CompletenessViolation {
            code: "current_version_mismatch",
            game_title_id: title(),
        });
    }
    let counts_match = row
        .declared_aggregate_count
        .is_none_or(|value| i64::from(value) == row.actual_aggregate_count)
        && row
            .declared_review_count
            .is_none_or(|value| i64::from(value) == row.actual_review_count)
        && row
            .declared_drilldown_count
            .is_none_or(|value| i64::from(value) == row.actual_drilldown_count)
        && row
            .declared_context_count
            .is_none_or(|value| i64::from(value) == row.actual_context_count);
    if row.current_artifact_id.is_some() && !counts_match {
        violations.push(CompletenessViolation {
            code: "chunk_count_mismatch",
            game_title_id: title(),
        });
    }
    if row.current_artifact_id.is_some()
        && (row.actual_aggregate_count < 1 || row.invalid_chunk_count > 0)
    {
        violations.push(CompletenessViolation {
            code: "chunk_metadata_invalid",
            game_title_id: title(),
        });
    }
}

fn database_url() -> Result<String, ReleaseError> {
    env::var("DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ReleaseError::MissingDatabaseUrl)
}

fn validate_operation_key(value: &str) -> Result<(), ReleaseError> {
    if (8..=128).contains(&value.len())
        && value
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
    {
        Ok(())
    } else {
        Err(ReleaseError::InvalidOperationKey)
    }
}

fn stable_id(prefix: &str, left: &str, right: &str) -> String {
    let digest = Sha256::digest(format!("{prefix}\0{left}\0{right}").as_bytes());
    let digest_prefix = canonical::lower_hex_prefix(&digest, 16);
    format!("{prefix}-{digest_prefix}")
}

fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{}", canonical::lower_hex(&Sha256::digest(bytes)))
}

const fn postgres_phase(phase: &'static str, source: tokio_postgres::Error) -> ReleaseError {
    ReleaseError::PostgresPhase { phase, source }
}

const fn global_violation(code: &'static str) -> CompletenessViolation {
    CompletenessViolation {
        code,
        game_title_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_release_ids_do_not_expose_the_operation_key() {
        let first = stable_id("analysis-release", "sensitive-key", "all");
        let second = stable_id("analysis-release", "sensitive-key", "all");
        assert_eq!(first, second);
        assert!(first.starts_with("analysis-release-"));
        assert_eq!(first.len(), "analysis-release-".len() + 32);
        assert!(!first.contains("sensitive-key"));
        assert_ne!(first, stable_id("analysis-release", "different-key", "all"));
        assert_ne!(
            first,
            stable_id("analysis-release", "sensitive-key", "one-title")
        );
    }

    #[test]
    fn operation_keys_require_a_bounded_single_token() {
        assert!(validate_operation_key("12345678").is_ok());
        assert!(validate_operation_key(&"x".repeat(128)).is_ok());
        assert!(validate_operation_key("1234567").is_err());
        assert!(validate_operation_key(&"x".repeat(129)).is_err());
        assert!(validate_operation_key("contains whitespace").is_err());
        assert!(validate_operation_key("contains\ncontrol").is_err());
    }
}
