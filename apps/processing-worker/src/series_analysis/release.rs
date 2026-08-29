use std::env;

use clap::ValueEnum;
use momo_analysis_core::{
    canonical,
    contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID},
};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio_postgres::{Client, Row, Transaction};

use crate::postgres::{PostgresError, connect};

use super::control::{ALGORITHM_VERSION, CAPABILITY_FRESH_SECONDS};

const RELEASE_TRANSACTION_LIMITS: &str = "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; \
     SET LOCAL idle_in_transaction_session_timeout = '30s'";
const RELEASE_AUDIT_TRANSACTION: &str = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY; \
     SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; \
     SET LOCAL idle_in_transaction_session_timeout = '30s'";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PromotionTrigger {
    AlgorithmUpdate,
    ArtifactSchemaUpdate,
    ValidationContractUpdate,
    InitialBackfill,
}

impl PromotionTrigger {
    const fn wire(self) -> &'static str {
        match self {
            Self::AlgorithmUpdate => "algorithm_update",
            Self::ArtifactSchemaUpdate => "artifact_schema_update",
            Self::ValidationContractUpdate => "validation_contract_update",
            Self::InitialBackfill => "initial_backfill",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PromotionRequest<'a> {
    pub(crate) trigger: PromotionTrigger,
    pub(crate) operation_key: &'a str,
    pub(crate) apply: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromotionReport {
    pub(crate) mode: &'static str,
    pub(crate) trigger: PromotionTrigger,
    pub(crate) operation_id: String,
    pub(crate) campaign_id: String,
    pub(crate) target_count: usize,
    pub(crate) compatible_reader_count: i64,
    pub(crate) compatible_worker_count: i64,
    pub(crate) idempotent_replay: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompletenessReport {
    pub(crate) passed: bool,
    pub(crate) require_current: bool,
    pub(crate) require_quiescent: bool,
    pub(crate) title_count: usize,
    pub(crate) current_artifact_count: usize,
    pub(crate) active_job_count: i64,
    pub(crate) failed_outbox_count: i64,
    pub(crate) compatible_reader_count: i64,
    pub(crate) compatible_worker_count: i64,
    pub(crate) violations: Vec<CompletenessViolation>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompletenessViolation {
    pub(crate) code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) game_title_id: Option<String>,
}

#[derive(Debug, Error)]
pub(crate) enum ReleaseError {
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
    #[error("no fresh compatible API reader is registered")]
    ReaderNotReady,
    #[error("a fresh API reader does not support the target artifact schema")]
    ReaderIncompatible,
    #[error("no fresh compatible analysis worker is registered")]
    WorkerNotReady,
    #[error("a fresh analysis worker does not support the target analysis contract")]
    WorkerIncompatible,
    #[error("the release operation key is already bound to different parameters")]
    IdempotencyConflict,
    #[error("the active series analysis release state does not match this release")]
    ReleaseStateMismatch,
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
    eligible: bool,
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
    validation_contract_id: Option<String>,
}

#[derive(Clone, Debug)]
struct TitleAuditRow {
    game_title_id: String,
    confirmed_match_count: i64,
    input_revision: i64,
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
    pending_work: bool,
    current_artifact_id: Option<String>,
    current_status: Option<String>,
    current_input_revision: Option<i64>,
    current_algorithm_version: Option<String>,
    current_artifact_schema_version: Option<i32>,
    current_validation_contract_id: Option<String>,
    previous_artifact_id: Option<String>,
    previous_status: Option<String>,
    previous_artifact_schema_version: Option<i32>,
    previous_validation_contract_id: Option<String>,
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
pub(crate) async fn promote(
    request: &PromotionRequest<'_>,
) -> Result<PromotionReport, ReleaseError> {
    validate_operation_key(request.operation_key)?;
    let database_url = database_url()?;
    let mut client = connect(&database_url).await?;
    let transaction = begin_promotion_transaction(&mut client).await?;

    let key_hash = canonical::sha256_prefixed(request.operation_key.as_bytes());
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
        validate_readers(readers)?;
        let workers = worker_capabilities(&transaction)
            .await
            .map_err(|source| postgres_phase("replay_worker_capabilities", source))?;
        validate_workers(workers)?;
        if !release_state_matches(&transaction)
            .await
            .map_err(|source| postgres_phase("replay_release_state", source))?
        {
            return Err(ReleaseError::ReleaseStateMismatch);
        }
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
    lock_release_state(&transaction)
        .await
        .map_err(|source| postgres_phase("lock_release_state", source))?;
    let titles = lock_targets(&transaction, request.trigger)
        .await
        .map_err(|source| postgres_phase("lock_targets", source))?;
    let target_count = titles.iter().filter(|title| title.eligible).count();
    if request.apply {
        let identity = PromotionIdentity {
            operation_id: &operation_id,
            campaign_id: &campaign_id,
            endpoint: &endpoint,
            key_hash: &key_hash,
        };
        apply_promotion(&transaction, request, &titles, &identity).await?;
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
        target_count,
        compatible_reader_count: readers.compatible,
        compatible_worker_count: workers.compatible,
        idempotent_replay: false,
    })
}

async fn begin_promotion_transaction(client: &mut Client) -> Result<Transaction<'_>, ReleaseError> {
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
    lock_capability_registries(&transaction)
        .await
        .map_err(|source| postgres_phase("capability_registry_lock", source))?;
    Ok(transaction)
}

/// Inspects desired/current versions, publication attestations, chunk counts, pending work, and
/// live capabilities.
///
/// # Errors
///
/// Returns a safe error only when the inspection itself cannot complete. An inconsistent system is
/// represented by `passed = false` and deterministic violation codes. Every current/previous
/// pointer is always required to reference an artifact carrying the exact Rust validator contract;
/// this invariant is intentionally not optional release-audit policy.
pub(crate) async fn audit_completeness(
    require_current: bool,
    require_quiescent: bool,
) -> Result<CompletenessReport, ReleaseError> {
    let database_url = database_url()?;
    audit_completeness_at(&database_url, require_current, require_quiescent).await
}

async fn audit_completeness_at(
    database_url: &str,
    require_current: bool,
    require_quiescent: bool,
) -> Result<CompletenessReport, ReleaseError> {
    let mut client = connect(database_url).await?;
    let transaction = client.transaction().await?;
    transaction.batch_execute(RELEASE_AUDIT_TRANSACTION).await?;
    let report = inspect_completeness(&transaction, require_current, require_quiescent).await?;
    transaction.rollback().await?;
    Ok(report)
}

async fn inspect_completeness<C>(
    client: &C,
    require_current: bool,
    require_quiescent: bool,
) -> Result<CompletenessReport, ReleaseError>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let readers = reader_capabilities(client).await?;
    let workers = worker_capabilities(client).await?;
    let release_state_matches = release_state_matches(client).await?;
    let rows = title_audit_rows(client).await?;
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
    if !release_state_matches {
        violations.push(global_violation("release_state_mismatch"));
    }
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
    let report = CompletenessReport {
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
    };
    Ok(report)
}

async fn reader_capabilities<C>(client: &C) -> Result<CapabilityCounts, tokio_postgres::Error>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let supported_schemas = json!([ARTIFACT_SCHEMA_VERSION]);
    let supported_validation_contracts = json!([ARTIFACT_VALIDATION_CONTRACT_ID]);
    let row = client
        .query_one(
            "SELECT \
               COUNT(*) FILTER (WHERE artifact_schema_versions = $1::jsonb \
                 AND validation_contract_ids = $2::jsonb)::bigint, \
               COUNT(*) FILTER (WHERE NOT (artifact_schema_versions = $1::jsonb \
                 AND validation_contract_ids = $2::jsonb))::bigint \
             FROM series_analysis_reader_capabilities \
             WHERE draining = false \
               AND heartbeat_at >= clock_timestamp() - ($3::bigint * interval '1 second')",
            &[
                &supported_schemas,
                &supported_validation_contracts,
                &CAPABILITY_FRESH_SECONDS,
            ],
        )
        .await?;
    Ok(CapabilityCounts {
        compatible: row.try_get(0)?,
        incompatible: row.try_get(1)?,
    })
}

/// Freezes both runtime registries for the compatibility decision and the desired-state cutover.
///
/// `SHARE` still permits inspection, but conflicts with the `ROW EXCLUSIVE` lock taken by every
/// capability INSERT/UPDATE. Keeping the reader -> worker order here makes the cross-runtime lock
/// order explicit and prevents a newly started rollback generation from entering after validation
/// but before the promotion commits.
async fn lock_capability_registries(
    transaction: &Transaction<'_>,
) -> Result<(), tokio_postgres::Error> {
    transaction
        .batch_execute(
            "LOCK TABLE public.series_analysis_reader_capabilities IN SHARE MODE; \
             LOCK TABLE public.series_analysis_worker_capabilities IN SHARE MODE",
        )
        .await
}

async fn worker_capabilities<C>(client: &C) -> Result<CapabilityCounts, tokio_postgres::Error>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let supported_algorithms = json!([ALGORITHM_VERSION]);
    let supported_schemas = json!([ARTIFACT_SCHEMA_VERSION]);
    let supported_validation_contracts = json!([ARTIFACT_VALIDATION_CONTRACT_ID]);
    let row = client
        .query_one(
            "SELECT \
               COUNT(*) FILTER (WHERE algorithm_versions = $1::jsonb \
                 AND artifact_schema_versions = $2::jsonb \
                 AND validation_contract_ids = $3::jsonb)::bigint, \
               COUNT(*) FILTER (WHERE NOT (algorithm_versions = $1::jsonb \
                 AND artifact_schema_versions = $2::jsonb \
                 AND validation_contract_ids = $3::jsonb))::bigint \
             FROM series_analysis_worker_capabilities \
             WHERE draining = false \
               AND heartbeat_at >= clock_timestamp() - ($4::bigint * interval '1 second')",
            &[
                &supported_algorithms,
                &supported_schemas,
                &supported_validation_contracts,
                &CAPABILITY_FRESH_SECONDS,
            ],
        )
        .await?;
    Ok(CapabilityCounts {
        compatible: row.try_get(0)?,
        incompatible: row.try_get(1)?,
    })
}

async fn lock_release_state(transaction: &Transaction<'_>) -> Result<(), tokio_postgres::Error> {
    transaction
        .query_one(
            "SELECT singleton_key FROM series_analysis_release_state \
             WHERE singleton_key = 'current' FOR UPDATE",
            &[],
        )
        .await?;
    Ok(())
}

async fn release_state_matches<C>(client: &C) -> Result<bool, tokio_postgres::Error>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let expected_schema = i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or(i32::MAX);
    let row = client
        .query_opt(
            "SELECT algorithm_version = $1 \
                    AND artifact_schema_version = $2 \
                    AND validation_contract_id IS NOT DISTINCT FROM $3 \
             FROM series_analysis_release_state WHERE singleton_key = 'current'",
            &[
                &ALGORITHM_VERSION,
                &expected_schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?;
    row.map_or_else(|| Ok(false), |value| value.try_get(0))
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
               c.algorithm_version, c.artifact_schema_version, c.validation_contract_id \
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
            validation_contract_id: value.try_get(7)?,
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
        && existing.validation_contract_id.as_deref() == Some(ARTIFACT_VALIDATION_CONTRACT_ID)
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
    let rows = transaction
        .query(
            "SELECT s.game_title_id, \
                    $1::text <> 'initial_backfill' OR EXISTS (\
                      SELECT 1 FROM matches m WHERE m.game_title_id = s.game_title_id\
                    ) \
             FROM series_analysis_title_states s \
             ORDER BY s.game_title_id FOR UPDATE",
            &[&trigger.wire()],
        )
        .await?;
    rows.into_iter()
        .map(|row| {
            Ok(TargetRow {
                game_title_id: row.try_get(0)?,
                eligible: row.try_get(1)?,
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

#[expect(
    clippy::too_many_lines,
    reason = "the atomic promotion transaction keeps its ordered durable state transitions visible together"
)]
async fn apply_promotion(
    transaction: &Transaction<'_>,
    request: &PromotionRequest<'_>,
    titles: &[TargetRow],
    identity: &PromotionIdentity<'_>,
) -> Result<(), ReleaseError> {
    let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
    let title_ids = titles
        .iter()
        .map(|target| target.game_title_id.as_str())
        .collect::<Vec<_>>();
    let target_ids = titles
        .iter()
        .filter(|target| target.eligible)
        .map(|target| target.game_title_id.as_str())
        .collect::<Vec<_>>();
    let target_count = i32::try_from(target_ids.len())?;
    transaction
        .execute(
            "UPDATE series_analysis_release_state \
             SET algorithm_version = $1, artifact_schema_version = $2, \
                 validation_contract_id = $3, updated_at = clock_timestamp() \
             WHERE singleton_key = 'current'",
            &[
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
            ],
        )
        .await?;
    transaction
        .execute(
            "UPDATE series_analysis_title_states \
             SET algorithm_version = $1, artifact_schema_version = $2, \
                 validation_contract_id = $3, \
                 pending_work = pending_work OR game_title_id = ANY($5), \
                 updated_at = clock_timestamp() \
             WHERE game_title_id = ANY($4)",
            &[
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
                &title_ids,
                &target_ids,
            ],
        )
        .await?;
    // Close the promotion-to-expansion window for jobs accepted under the previous tuple. The
    // transitional API remains the rollback floor after promotion; this update only advances work
    // that was already queued before the atomic desired-state cutover.
    transaction
        .execute(
            "UPDATE series_analysis_jobs j \
             SET input_revision = s.input_revision, algorithm_version = s.algorithm_version, \
                 artifact_schema_version = s.artifact_schema_version, \
                 validation_contract_id = s.validation_contract_id, \
                 updated_at = clock_timestamp() \
             FROM series_analysis_title_states s \
             WHERE j.game_title_id = s.game_title_id AND j.status = 'queued' \
               AND s.game_title_id = ANY($1)",
            &[&title_ids],
        )
        .await?;
    transaction
        .execute(
            "INSERT INTO series_analysis_operation_requests ( \
               id, scope, requested_by_account_id, idempotency_key_hash, endpoint, status, \
               target_count, accepted_at, finished_at \
             ) VALUES (\
               $1, 'all_titles', NULL, $2, $3, \
               CASE WHEN $4 = 0 THEN 'terminal' ELSE 'running' END, \
               $4, clock_timestamp(), \
               CASE WHEN $4 = 0 THEN clock_timestamp() ELSE NULL END\
             )",
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
               validation_contract_id, status, target_count, accepted_at, finished_at \
             ) VALUES (\
               $1, $2, $3, $4, $5, $6, \
               CASE WHEN $7 = 0 THEN 'terminal' ELSE 'expanding' END, \
               $7, clock_timestamp(), \
               CASE WHEN $7 = 0 THEN clock_timestamp() ELSE NULL END\
             )",
            &[
                &identity.campaign_id,
                &identity.operation_id,
                &request.trigger.wire(),
                &ALGORITHM_VERSION,
                &schema,
                &ARTIFACT_VALIDATION_CONTRACT_ID,
                &target_count,
            ],
        )
        .await?;
    transaction
        .execute(
            "INSERT INTO series_analysis_campaign_targets ( \
               campaign_id, game_title_id, input_revision, algorithm_version, \
               artifact_schema_version, validation_contract_id, status, job_request_id, accepted_at \
             ) SELECT $1, s.game_title_id, s.input_revision, s.algorithm_version, \
                      s.artifact_schema_version, s.validation_contract_id, \
                      'pending', NULL, c.accepted_at \
               FROM series_analysis_title_states s \
               CROSS JOIN series_analysis_campaigns c \
              WHERE c.id = $1 AND s.game_title_id = ANY($2) \
              ORDER BY s.game_title_id",
            &[&identity.campaign_id, &target_ids],
        )
        .await?;
    Ok(())
}

async fn title_audit_rows<C>(client: &C) -> Result<Vec<TitleAuditRow>, tokio_postgres::Error>
where
    C: tokio_postgres::GenericClient + Sync,
{
    let rows = client
        .query(
            "SELECT s.game_title_id, \
               (SELECT COUNT(*)::bigint FROM matches m WHERE m.game_title_id = s.game_title_id), \
               s.input_revision, s.algorithm_version, s.artifact_schema_version, \
               s.validation_contract_id, s.pending_work, \
               s.current_artifact_id, a.status, a.input_revision, a.algorithm_version, \
               a.artifact_schema_version, a.validation_contract_id, \
               s.previous_artifact_id, p.status, p.artifact_schema_version, \
               p.validation_contract_id, \
               a.aggregate_chunk_count, a.review_chunk_count, a.drilldown_chunk_count, \
               a.match_context_chunk_count, \
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
             LEFT JOIN series_analysis_artifacts p ON p.id = s.previous_artifact_id \
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
        validation_contract_id: row.try_get(5)?,
        pending_work: row.try_get(6)?,
        current_artifact_id: row.try_get(7)?,
        current_status: row.try_get(8)?,
        current_input_revision: row.try_get(9)?,
        current_algorithm_version: row.try_get(10)?,
        current_artifact_schema_version: row.try_get(11)?,
        current_validation_contract_id: row.try_get(12)?,
        previous_artifact_id: row.try_get(13)?,
        previous_status: row.try_get(14)?,
        previous_artifact_schema_version: row.try_get(15)?,
        previous_validation_contract_id: row.try_get(16)?,
        declared_aggregate_count: row.try_get(17)?,
        declared_review_count: row.try_get(18)?,
        declared_drilldown_count: row.try_get(19)?,
        declared_context_count: row.try_get(20)?,
        actual_aggregate_count: row.try_get(21)?,
        actual_review_count: row.try_get(22)?,
        actual_drilldown_count: row.try_get(23)?,
        actual_context_count: row.try_get(24)?,
        invalid_chunk_count: row.try_get(25)?,
    })
}

fn inspect_title(
    row: &TitleAuditRow,
    require_current: bool,
    require_quiescent: bool,
    violations: &mut Vec<CompletenessViolation>,
) {
    let title = || Some(row.game_title_id.clone());
    if row.algorithm_version != ALGORITHM_VERSION
        || i32::try_from(ARTIFACT_SCHEMA_VERSION).ok() != Some(row.artifact_schema_version)
    {
        violations.push(CompletenessViolation {
            code: "desired_version_mismatch",
            game_title_id: title(),
        });
    }
    if row.validation_contract_id.as_deref() != Some(ARTIFACT_VALIDATION_CONTRACT_ID) {
        violations.push(CompletenessViolation {
            code: "desired_validation_contract_mismatch",
            game_title_id: title(),
        });
    }
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
        && row.current_validation_contract_id.as_deref() != Some(ARTIFACT_VALIDATION_CONTRACT_ID)
    {
        violations.push(CompletenessViolation {
            code: "current_validation_contract_mismatch",
            game_title_id: title(),
        });
    }
    if row.previous_artifact_id.is_some()
        && row.previous_validation_contract_id.as_deref() != Some(ARTIFACT_VALIDATION_CONTRACT_ID)
    {
        violations.push(CompletenessViolation {
            code: "previous_validation_contract_mismatch",
            game_title_id: title(),
        });
    }
    if row.previous_artifact_id.is_some()
        && (row.previous_status.as_deref() != Some("published")
            || row.previous_artifact_schema_version != i32::try_from(ARTIFACT_SCHEMA_VERSION).ok())
    {
        violations.push(CompletenessViolation {
            code: "previous_publication_invalid",
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

    fn valid_title_audit_row() -> TitleAuditRow {
        TitleAuditRow {
            game_title_id: String::from("title-release-audit"),
            confirmed_match_count: 1,
            input_revision: 4,
            algorithm_version: String::from(ALGORITHM_VERSION),
            artifact_schema_version: 2,
            validation_contract_id: Some(String::from(ARTIFACT_VALIDATION_CONTRACT_ID)),
            pending_work: false,
            current_artifact_id: Some(String::from("artifact-current")),
            current_status: Some(String::from("published")),
            current_input_revision: Some(4),
            current_algorithm_version: Some(String::from(ALGORITHM_VERSION)),
            current_artifact_schema_version: Some(2),
            current_validation_contract_id: Some(String::from(ARTIFACT_VALIDATION_CONTRACT_ID)),
            previous_artifact_id: Some(String::from("artifact-previous")),
            previous_status: Some(String::from("published")),
            previous_artifact_schema_version: Some(2),
            previous_validation_contract_id: Some(String::from(ARTIFACT_VALIDATION_CONTRACT_ID)),
            declared_aggregate_count: Some(1),
            declared_review_count: Some(0),
            declared_drilldown_count: Some(0),
            declared_context_count: Some(0),
            actual_aggregate_count: 1,
            actual_review_count: 0,
            actual_drilldown_count: 0,
            actual_context_count: 0,
            invalid_chunk_count: 0,
        }
    }

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

    #[test]
    fn idempotent_replay_is_bound_to_the_validation_contract() {
        let mut existing = ExistingOperation {
            endpoint: String::from("release:validation_contract_update"),
            key_hash: String::from("sha256:test"),
            target_count: 1,
            campaign_id: String::from("campaign-1"),
            trigger: String::from("validation_contract_update"),
            algorithm_version: String::from(ALGORITHM_VERSION),
            artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION).unwrap_or(i32::MAX),
            validation_contract_id: Some(String::from(ARTIFACT_VALIDATION_CONTRACT_ID)),
        };

        assert!(
            validate_existing(
                &existing,
                "release:validation_contract_update",
                "sha256:test",
                PromotionTrigger::ValidationContractUpdate,
            )
            .is_ok()
        );
        existing.validation_contract_id = None;
        assert!(matches!(
            validate_existing(
                &existing,
                "release:validation_contract_update",
                "sha256:test",
                PromotionTrigger::ValidationContractUpdate,
            ),
            Err(ReleaseError::IdempotencyConflict)
        ));
    }

    #[test]
    fn release_audit_requires_the_exact_desired_validation_contract() {
        let mut row = valid_title_audit_row();
        row.validation_contract_id = None;
        let mut violations = Vec::new();

        inspect_title(&row, false, false, &mut violations);

        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations.first().map(|violation| violation.code),
            Some("desired_validation_contract_mismatch")
        );
    }

    #[test]
    fn release_audit_requires_the_current_desired_algorithm_and_schema_without_a_pointer() {
        let mut row = valid_title_audit_row();
        row.algorithm_version = String::from("legacy-algorithm");
        row.artifact_schema_version = 1;
        row.current_artifact_id = None;
        row.current_status = None;
        row.current_input_revision = None;
        row.current_algorithm_version = None;
        row.current_artifact_schema_version = None;
        row.current_validation_contract_id = None;
        let mut violations = Vec::new();

        inspect_title(&row, false, false, &mut violations);

        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations.first().map(|violation| violation.code),
            Some("desired_version_mismatch")
        );
    }

    #[test]
    fn release_audit_accepts_exact_attestations_for_both_public_pointers() {
        let mut violations = Vec::new();

        inspect_title(&valid_title_audit_row(), false, false, &mut violations);

        assert!(violations.is_empty());
    }

    #[test]
    fn release_audit_always_rejects_missing_or_unknown_public_pointer_attestations() {
        let mut row = valid_title_audit_row();
        row.current_validation_contract_id = None;
        row.previous_validation_contract_id = Some(String::from("unknown-validator"));
        let mut violations = Vec::new();

        // Attestation is independent of the optional current-existence and quiescence policies.
        inspect_title(&row, false, false, &mut violations);

        assert_eq!(
            violations
                .iter()
                .map(|violation| violation.code)
                .collect::<Vec<_>>(),
            vec![
                "current_validation_contract_mismatch",
                "previous_validation_contract_mismatch"
            ]
        );
    }

    #[test]
    fn release_audit_rejects_a_non_published_or_unsupported_previous_artifact() {
        let mut row = valid_title_audit_row();
        row.previous_status = Some(String::from("staging"));
        row.previous_artifact_schema_version = Some(999);
        let mut violations = Vec::new();

        inspect_title(&row, false, false, &mut violations);

        assert_eq!(
            violations
                .iter()
                .map(|violation| violation.code)
                .collect::<Vec<_>>(),
            vec!["previous_publication_invalid"]
        );
    }

    #[test]
    fn release_audit_does_not_require_attestation_without_a_public_pointer() {
        let mut row = valid_title_audit_row();
        row.current_artifact_id = None;
        row.current_status = None;
        row.current_input_revision = None;
        row.current_algorithm_version = None;
        row.current_artifact_schema_version = None;
        row.current_validation_contract_id = None;
        row.previous_artifact_id = None;
        row.previous_status = None;
        row.previous_artifact_schema_version = None;
        row.previous_validation_contract_id = None;
        row.confirmed_match_count = 0;
        row.declared_aggregate_count = None;
        row.declared_review_count = None;
        row.declared_drilldown_count = None;
        row.declared_context_count = None;
        row.actual_aggregate_count = 0;
        let mut violations = Vec::new();

        inspect_title(&row, false, false, &mut violations);

        assert!(violations.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::too_many_lines,
        reason = "the isolated database query contract test keeps both capability projections and their exact array partitions together"
    )]
    async fn real_postgres_release_capabilities_require_exact_singleton_arrays()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let database_url = env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let mut client = connect(&database_url).await?;
        let transaction = client.transaction().await?;
        transaction
            .execute(
                "UPDATE series_analysis_worker_capabilities SET draining = true",
                &[],
            )
            .await?;
        transaction
            .execute(
                "UPDATE series_analysis_reader_capabilities SET draining = true",
                &[],
            )
            .await?;
        transaction
            .execute(
                "DELETE FROM series_analysis_worker_capabilities \
                 WHERE worker_id LIKE 'analysis-release-capability-smoke-%'",
                &[],
            )
            .await?;
        transaction
            .execute(
                "DELETE FROM series_analysis_reader_capabilities \
                 WHERE reader_id LIKE 'analysis-release-capability-smoke-%'",
                &[],
            )
            .await?;
        let algorithms = json!([ALGORITHM_VERSION]);
        let schemas = json!([ARTIFACT_SCHEMA_VERSION]);
        let validation_contracts = json!([ARTIFACT_VALIDATION_CONTRACT_ID]);
        let unknown_algorithms = json!(["unknown-algorithm"]);
        let unknown_schemas = json!([999]);
        let unknown_validation_contracts = json!(["unknown-validation-contract"]);
        let extra_algorithms = json!([ALGORITHM_VERSION, "unknown-algorithm"]);
        let extra_schemas = json!([ARTIFACT_SCHEMA_VERSION, 999]);
        let extra_validation_contracts = json!([
            ARTIFACT_VALIDATION_CONTRACT_ID,
            "unknown-validation-contract"
        ]);
        transaction
            .execute(
                "INSERT INTO series_analysis_worker_capabilities (\x20\
                   worker_id, algorithm_versions, artifact_schema_versions, validation_contract_ids,\x20\
                   draining, started_at, heartbeat_at\x20\
                 ) VALUES\x20\
                   ('analysis-release-capability-smoke-compatible', $1, $2, $3, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-no-contract', $1, $2, '[]'::jsonb, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-unknown-contract', $1, $2, $4, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-unknown-algorithm', $5, $2, $3, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-unknown-schema', $1, $6, $3, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-extra-algorithm', $7, $2, $3, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-extra-schema', $1, $8, $3, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-extra-contract', $1, $2, $9, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-draining', $1, $2, $3, true, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-stale', $1, $2, $3, false, clock_timestamp(), clock_timestamp() - interval '10 minutes')",
                &[
                    &algorithms,
                    &schemas,
                    &validation_contracts,
                    &unknown_validation_contracts,
                    &unknown_algorithms,
                    &unknown_schemas,
                    &extra_algorithms,
                    &extra_schemas,
                    &extra_validation_contracts,
                ],
            )
            .await?;
        transaction
            .execute(
                "INSERT INTO series_analysis_reader_capabilities (\x20\
                   reader_id, artifact_schema_versions, validation_contract_ids, draining,\x20\
                   started_at, heartbeat_at\x20\
                 ) VALUES\x20\
                   ('analysis-release-capability-smoke-reader-compatible', $1, $2, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-no-contract', $1, '[]'::jsonb, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-unknown-contract', $1, $3, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-unknown-schema', $4, $2, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-extra-schema', $5, $2, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-extra-contract', $1, $6, false, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-draining', $1, $2, true, clock_timestamp(), clock_timestamp()),\x20\
                   ('analysis-release-capability-smoke-reader-stale', $1, $2, false, clock_timestamp(), clock_timestamp() - interval '10 minutes')",
                &[
                    &schemas,
                    &validation_contracts,
                    &unknown_validation_contracts,
                    &unknown_schemas,
                    &extra_schemas,
                    &extra_validation_contracts,
                ],
            )
            .await?;

        let worker_counts = worker_capabilities(&transaction).await?;
        let reader_counts = reader_capabilities(&transaction).await?;

        assert_eq!(worker_counts.compatible, 1);
        assert_eq!(worker_counts.incompatible, 7);
        assert_eq!(reader_counts.compatible, 1);
        assert_eq!(reader_counts.incompatible, 5);
        transaction.rollback().await?;
        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the two-connection database test asserts that registration waits at the transaction boundary"
    )]
    async fn real_postgres_promotion_freezes_capability_registration_after_inspection()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const READER_ID: &str = "analysis-release-capability-lock-smoke-reader";
        let database_url = env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let mut promoter = connect(&database_url).await?;
        let contender = connect(&database_url).await?;
        let contender_pid = contender
            .query_one("SELECT pg_backend_pid()", &[])
            .await?
            .try_get::<_, i32>(0)?;
        let transaction = promoter.transaction().await?;

        lock_capability_registries(&transaction).await?;
        let held_registry_locks = transaction
            .query_one(
                "SELECT COUNT(*)::bigint FROM pg_locks l \
                 JOIN pg_class c ON c.oid = l.relation \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE l.pid = pg_backend_pid() AND l.granted AND l.mode = 'ShareLock' \
                   AND n.nspname = 'public' \
                   AND c.relname IN ('series_analysis_reader_capabilities', \
                                     'series_analysis_worker_capabilities')",
                &[],
            )
            .await?
            .try_get::<_, i64>(0)?;
        assert_eq!(held_registry_locks, 2);
        let _inspected_readers = reader_capabilities(&transaction).await?;
        let _inspected_workers = worker_capabilities(&transaction).await?;

        let schemas = json!([ARTIFACT_SCHEMA_VERSION]);
        let incompatible_contracts = json!(["unknown-validation-contract"]);
        let registration = tokio::spawn(async move {
            contender.batch_execute("BEGIN").await?;
            let inserted = contender
                .execute(
                    "INSERT INTO series_analysis_reader_capabilities (\x20\
                       reader_id, artifact_schema_versions, validation_contract_ids, draining,\x20\
                       started_at, heartbeat_at\x20\
                     ) VALUES ($1, $2, $3, false, clock_timestamp(), clock_timestamp())",
                    &[&READER_ID, &schemas, &incompatible_contracts],
                )
                .await?;
            let visible_inside_registration = contender
                .query_one(
                    "SELECT EXISTS (SELECT 1 FROM series_analysis_reader_capabilities \
                     WHERE reader_id = $1)",
                    &[&READER_ID],
                )
                .await?
                .try_get::<_, bool>(0)?;
            contender.batch_execute("ROLLBACK").await?;
            Ok::<(u64, bool), tokio_postgres::Error>((inserted, visible_inside_registration))
        });

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let is_blocked = transaction
                    .query_one(
                        "SELECT cardinality(pg_blocking_pids($1)) > 0",
                        &[&contender_pid],
                    )
                    .await?
                    .try_get::<_, bool>(0)?;
                if is_blocked {
                    return Ok::<(), tokio_postgres::Error>(());
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_elapsed| {
            std::io::Error::other("capability registration did not wait for promotion")
        })??;
        assert!(!registration.is_finished());

        transaction.commit().await?;
        let registration = tokio::time::timeout(std::time::Duration::from_secs(2), registration)
            .await
            .map_err(|_elapsed| {
                std::io::Error::other("capability registration did not resume after promotion")
            })?
            .map_err(|join_error| {
                std::io::Error::other(format!("capability registration task failed: {join_error}"))
            })?;
        let (inserted, visible_inside_registration) = registration?;
        assert_eq!(inserted, 1);
        assert!(visible_inside_registration);
        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the isolated database test keeps zero-title promotion and subsequent title inheritance in one rollback-scoped transaction"
    )]
    async fn real_postgres_zero_title_backfill_is_terminal_and_updates_the_release_generation()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const OPERATION_ID: &str = "analysis-release-zero-title-operation-smoke";
        const CAMPAIGN_ID: &str = "analysis-release-zero-title-campaign-smoke";
        const NEW_TITLE_ID: &str = "analysis-release-post-promotion-title-smoke";
        let database_url = env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let schema = i32::try_from(ARTIFACT_SCHEMA_VERSION)?;
        let mut client = connect(&database_url).await?;
        let transaction = client.transaction().await?;
        transaction
            .batch_execute("TRUNCATE TABLE game_titles CASCADE")
            .await?;
        transaction
            .execute(
                "DELETE FROM series_analysis_operation_requests WHERE id = $1",
                &[&OPERATION_ID],
            )
            .await?;
        transaction
            .execute(
                "UPDATE series_analysis_release_state \
                 SET algorithm_version = 'series-analysis-v1', artifact_schema_version = 1, \
                     validation_contract_id = NULL, updated_at = clock_timestamp() \
                 WHERE singleton_key = 'current'",
                &[],
            )
            .await?;
        lock_release_state(&transaction).await?;
        let titles = lock_targets(&transaction, PromotionTrigger::InitialBackfill).await?;
        assert!(titles.is_empty());

        let request = PromotionRequest {
            trigger: PromotionTrigger::InitialBackfill,
            operation_key: "zero-title-smoke",
            apply: true,
        };
        let identity = PromotionIdentity {
            operation_id: OPERATION_ID,
            campaign_id: CAMPAIGN_ID,
            endpoint: "release:initial_backfill",
            key_hash: "sha256:zero-title-smoke",
        };
        apply_promotion(&transaction, &request, &titles, &identity).await?;

        let terminal = transaction
            .query_one(
                "SELECT o.status, o.target_count, o.finished_at IS NOT NULL, \
                        c.status, c.target_count, c.finished_at IS NOT NULL, \
                        (SELECT COUNT(*)::bigint FROM series_analysis_campaign_targets t \
                         WHERE t.campaign_id = c.id) \
                 FROM series_analysis_operation_requests o \
                 JOIN series_analysis_campaigns c ON c.operation_request_id = o.id \
                 WHERE o.id = $1 AND c.id = $2",
                &[&OPERATION_ID, &CAMPAIGN_ID],
            )
            .await?;
        assert_eq!(terminal.try_get::<_, String>(0)?, "terminal");
        assert_eq!(terminal.try_get::<_, i32>(1)?, 0);
        assert!(terminal.try_get::<_, bool>(2)?);
        assert_eq!(terminal.try_get::<_, String>(3)?, "terminal");
        assert_eq!(terminal.try_get::<_, i32>(4)?, 0);
        assert!(terminal.try_get::<_, bool>(5)?);
        assert_eq!(terminal.try_get::<_, i64>(6)?, 0);
        assert!(release_state_matches(&transaction).await?);

        transaction
            .execute(
                "INSERT INTO game_titles (id, name, layout_family, display_order) \
                 VALUES ($1, 'post-promotion title smoke', 'momotetsu2', 9997)",
                &[&NEW_TITLE_ID],
            )
            .await?;
        let inherited = transaction
            .query_one(
                "SELECT algorithm_version, artifact_schema_version, validation_contract_id, \
                        pending_work \
                 FROM series_analysis_title_states WHERE game_title_id = $1",
                &[&NEW_TITLE_ID],
            )
            .await?;
        assert_eq!(inherited.try_get::<_, String>(0)?, ALGORITHM_VERSION);
        assert_eq!(inherited.try_get::<_, i32>(1)?, schema);
        assert_eq!(
            inherited.try_get::<_, Option<String>>(2)?.as_deref(),
            Some(ARTIFACT_VALIDATION_CONTRACT_ID)
        );
        assert!(!inherited.try_get::<_, bool>(3)?);

        transaction.rollback().await?;
        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the isolated database audit test rolls back the singleton mismatch before asserting its report"
    )]
    async fn real_postgres_audit_reports_a_release_state_mismatch()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let database_url = env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let mut client = connect(&database_url).await?;
        let transaction = client.transaction().await?;
        transaction
            .batch_execute(RELEASE_TRANSACTION_LIMITS)
            .await?;
        transaction
            .query_one(
                "SELECT pg_advisory_xact_lock(hashtext('momo-series-analysis-release'))",
                &[],
            )
            .await?;
        transaction
            .execute(
                "UPDATE series_analysis_release_state \
                 SET algorithm_version = 'series-analysis-v1', artifact_schema_version = 1, \
                     validation_contract_id = NULL, updated_at = clock_timestamp() \
                 WHERE singleton_key = 'current'",
                &[],
            )
            .await?;

        let audit_result = inspect_completeness(&transaction, false, false).await;
        transaction.rollback().await?;
        let report = audit_result?;
        assert!(report.violations.iter().any(|violation| {
            violation.code == "release_state_mismatch" && violation.game_title_id.is_none()
        }));
        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the two-connection database test uses exact SQLSTATE and rollback-scoped state assertions"
    )]
    async fn real_postgres_release_lock_serializes_new_title_state_inheritance()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const TITLE_ID: &str = "analysis-release-lock-title-smoke";
        let database_url = env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let mut blocker = connect(&database_url).await?;
        let mut contender = connect(&database_url).await?;
        let contender_transaction = contender.transaction().await?;
        contender_transaction
            .execute("DELETE FROM game_titles WHERE id = $1", &[&TITLE_ID])
            .await?;

        let blocker_transaction = blocker.transaction().await?;
        lock_release_state(&blocker_transaction).await?;
        contender_transaction
            .batch_execute("SET LOCAL lock_timeout = '250ms'; SAVEPOINT blocked_insert")
            .await?;
        let blocked_insert = contender_transaction
            .execute(
                "INSERT INTO game_titles (id, name, layout_family, display_order) \
                 VALUES ($1, 'release lock title smoke', 'momotetsu2', 9996)",
                &[&TITLE_ID],
            )
            .await;
        blocker_transaction.rollback().await?;
        contender_transaction
            .batch_execute("ROLLBACK TO SAVEPOINT blocked_insert; SET LOCAL lock_timeout = '5s'")
            .await?;

        let Err(blocked_error) = blocked_insert else {
            return Err(std::io::Error::other(
                "the game-title trigger did not wait for the release singleton",
            )
            .into());
        };
        assert_eq!(
            blocked_error.code(),
            Some(&tokio_postgres::error::SqlState::LOCK_NOT_AVAILABLE)
        );
        contender_transaction
            .execute(
                "INSERT INTO game_titles (id, name, layout_family, display_order) \
                 VALUES ($1, 'release lock title smoke', 'momotetsu2', 9996)",
                &[&TITLE_ID],
            )
            .await?;
        let inherits_current_release = contender_transaction
            .query_one(
                "SELECT s.algorithm_version = r.algorithm_version \
                        AND s.artifact_schema_version = r.artifact_schema_version \
                        AND s.validation_contract_id IS NOT DISTINCT FROM r.validation_contract_id \
                 FROM series_analysis_title_states s \
                 CROSS JOIN series_analysis_release_state r \
                 WHERE s.game_title_id = $1 AND r.singleton_key = 'current'",
                &[&TITLE_ID],
            )
            .await?
            .try_get::<_, bool>(0)?;
        contender_transaction.rollback().await?;
        assert!(inherits_current_release);
        Ok(())
    }
}
