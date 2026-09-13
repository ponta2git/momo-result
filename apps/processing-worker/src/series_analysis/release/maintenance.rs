//! The automatic release hook and manual operation share one state transition.
//! Planning and applying use the same release/capability locks as promotion.

use clap::ValueEnum;
use serde::Serialize;
use serde_json::json;
use tokio_postgres::Transaction;

use super::{
    ALGORITHM_VERSION, ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID, PromotionRequest,
    PromotionTrigger, ReleaseError, begin_promotion_transaction, canonical, connect, database_url,
    enqueue_dispatcher_wake, existing_operation, inspect_completeness, lock_targets,
    promote_transaction, reader_capabilities, stable_id, title_audit_rows, validate_existing,
    validate_readers, validate_workers, worker_capabilities,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum MaintenanceOperation {
    Auto,
    Promote,
    Backfill,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseVersion {
    algorithm_version: String,
    artifact_schema_version: i32,
    validation_contract_id: Option<String>,
}

impl ReleaseVersion {
    fn target() -> Result<Self, ReleaseError> {
        Ok(Self {
            algorithm_version: ALGORITHM_VERSION.to_owned(),
            artifact_schema_version: i32::try_from(ARTIFACT_SCHEMA_VERSION)?,
            validation_contract_id: Some(ARTIFACT_VALIDATION_CONTRACT_ID.to_owned()),
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaintenanceReport {
    schema_version: u8,
    pub(crate) status: &'static str,
    action: &'static str,
    reason: &'static str,
    current: ReleaseVersion,
    target: ReleaseVersion,
    plan_digest: String,
    target_count: i64,
    completed_count: i64,
    failed_count: i64,
}

#[derive(Default)]
struct Progress {
    targets: i64,
    completed: i64,
    failed: i64,
}

/// Reconcile only the requested release generation. A preview is the default;
/// apply requires the digest returned by that preview and rechecks it under lock.
/// No operation/campaign identifiers or connection details leave this boundary.
pub(crate) async fn reconcile(
    operation: MaintenanceOperation,
    release_id: &str,
    apply: bool,
    expected_plan: Option<&str>,
) -> Result<MaintenanceReport, ReleaseError> {
    if release_id.len() != 40
        || !release_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ReleaseError::InvalidOperationKey);
    }
    let database_url = database_url()?;
    let mut client = connect(&database_url).await?;
    let transaction = begin_promotion_transaction(&mut client).await?;
    let report =
        reconcile_transaction(transaction, operation, release_id, apply, expected_plan).await?;
    Ok(report)
}

async fn current_version(transaction: &Transaction<'_>) -> Result<ReleaseVersion, ReleaseError> {
    let row = transaction
        .query_one(
            "SELECT algorithm_version, artifact_schema_version, validation_contract_id \
         FROM series_analysis_release_state WHERE singleton_key = 'current' FOR UPDATE",
            &[],
        )
        .await?;
    Ok(ReleaseVersion {
        algorithm_version: row.try_get(0)?,
        artifact_schema_version: row.try_get(1)?,
        validation_contract_id: row.try_get(2)?,
    })
}

fn changed_trigger(current: &ReleaseVersion, target: &ReleaseVersion) -> Option<PromotionTrigger> {
    if current.validation_contract_id != target.validation_contract_id {
        Some(PromotionTrigger::ValidationContractUpdate)
    } else if current.artifact_schema_version != target.artifact_schema_version {
        Some(PromotionTrigger::ArtifactSchemaUpdate)
    } else if current.algorithm_version != target.algorithm_version {
        Some(PromotionTrigger::AlgorithmUpdate)
    } else {
        None
    }
}

fn operation_key(release_id: &str, operation: MaintenanceOperation) -> String {
    // A manual promotion resumes an automatic promotion. Attempts are deliberately
    // excluded, and initial backfill has its own identity within the generation.
    let purpose = if operation == MaintenanceOperation::Backfill {
        "backfill"
    } else {
        "update"
    };
    format!("analysis-{purpose}-{release_id}")
}

#[expect(
    clippy::too_many_lines,
    reason = "planning, replay, and application share one locked release snapshot"
)]
async fn reconcile_transaction(
    transaction: Transaction<'_>,
    operation: MaintenanceOperation,
    release_id: &str,
    apply: bool,
    expected_plan: Option<&str>,
) -> Result<MaintenanceReport, ReleaseError> {
    let current = current_version(&transaction).await?;
    let target = ReleaseVersion::target()?;
    let key = operation_key(release_id, operation);
    let key_hash = canonical::sha256_prefixed(key.as_bytes());
    let operation_id = stable_id("analysis-release-operation", &key_hash, "all");
    let existing = existing_operation(&transaction, &operation_id).await?;
    let mut report = MaintenanceReport {
        schema_version: 1,
        status: "not_needed",
        action: "none",
        reason: "already_current",
        current,
        target,
        plan_digest: String::new(),
        target_count: 0,
        completed_count: 0,
        failed_count: 0,
    };

    if let Some(existing) = existing {
        let trigger = match existing.trigger.as_str() {
            "algorithm_update" => PromotionTrigger::AlgorithmUpdate,
            "artifact_schema_update" => PromotionTrigger::ArtifactSchemaUpdate,
            "validation_contract_update" => PromotionTrigger::ValidationContractUpdate,
            "initial_backfill" => PromotionTrigger::InitialBackfill,
            _ => return Err(ReleaseError::IdempotencyConflict),
        };
        validate_existing(
            &existing,
            &format!("release:{}", trigger.wire()),
            &key_hash,
            trigger,
        )?;
        if report.current == report.target {
            let progress = campaign_progress(&transaction, &existing.campaign_id).await?;
            report.action = "resume";
            report.target_count = progress.targets;
            report.completed_count = progress.completed;
            report.failed_count = progress.failed;
            report.status = progress_status(&progress);
            report.reason = "existing_operation";
            if report.status == "running"
                && (validate_readers(reader_capabilities(&transaction).await?).is_err()
                    || validate_workers(worker_capabilities(&transaction).await?).is_err())
            {
                report.status = "attention_required";
                report.reason = "reader_or_worker_incompatible";
            }
            if report.status == "complete" && !maintenance_integrity(&transaction).await? {
                report.status = "attention_required";
                report.reason = "release_integrity_audit_failed";
            }
            // The ordinary dispatcher also recovers lost hints. An explicit apply
            // replay supplies an immediate wake without creating another campaign.
            if apply && report.status == "running" {
                validate_readers(reader_capabilities(&transaction).await?)?;
                validate_workers(worker_capabilities(&transaction).await?)?;
                enqueue_dispatcher_wake(&transaction).await?;
                transaction.commit().await?;
                return Ok(report);
            }
        } else {
            report.status = "attention_required";
            report.reason = "applied_operation_has_a_different_current_release";
        }
        transaction.rollback().await?;
        return Ok(report);
    }

    let trigger = changed_trigger(&report.current, &report.target);
    if operation == MaintenanceOperation::Backfill && trigger.is_some() {
        report.status = "attention_required";
        report.reason = "promote_before_backfill";
    } else if trigger.is_some()
        && target_was_previously_released(&transaction, &report.target).await?
    {
        report.status = "attention_required";
        report.reason = "previous_generation_requires_explicit_recovery";
    } else {
        let trigger = match trigger {
            Some(value) => Some(value),
            None if operation == MaintenanceOperation::Promote => None,
            None => initial_backfill_trigger(&transaction, &report.target, operation).await?,
        };
        if let Some(trigger) = trigger {
            report.action = trigger.wire();
            report.reason = "release_update_required";
            let readers = reader_capabilities(&transaction).await?;
            let workers = worker_capabilities(&transaction).await?;
            if validate_readers(readers).is_err() || validate_workers(workers).is_err() {
                report.status = "attention_required";
                report.reason = "reader_or_worker_incompatible";
            } else {
                let titles = lock_targets(&transaction, trigger).await?;
                report.target_count =
                    i64::try_from(titles.iter().filter(|title| title.eligible).count())?;
                report.plan_digest = plan_digest(
                    &report,
                    release_id,
                    &titles
                        .iter()
                        .filter(|title| title.eligible)
                        .map(|title| json!([title.game_title_id, title.input_revision]))
                        .collect::<Vec<_>>(),
                );
                report.status = "planned";
                if apply && expected_plan != Some(report.plan_digest.as_str()) {
                    report.status = "attention_required";
                    report.reason = "plan_changed_run_check_again";
                } else if apply {
                    let promotion = promote_transaction(
                        transaction,
                        &PromotionRequest {
                            trigger,
                            operation_key: &key,
                            apply: true,
                        },
                    )
                    .await?;
                    report.status = if promotion.target_count == 0 {
                        "complete"
                    } else {
                        "running"
                    };
                    report.reason = "operation_accepted";
                    return Ok(report);
                }
            }
        } else {
            // A later application release can observe a campaign started by an
            // earlier release. Never call it not-needed while that work is pending.
            let progress = generation_progress(&transaction, &report.target).await?;
            report.target_count = progress.targets;
            report.completed_count = progress.completed;
            report.failed_count = progress.failed;
            if progress.targets > 0 {
                report.status = progress_status(&progress);
                report.reason = "current_generation_operations";
            }
        }
    }
    if report.status == "running" {
        if validate_readers(reader_capabilities(&transaction).await?).is_err()
            || validate_workers(worker_capabilities(&transaction).await?).is_err()
        {
            report.status = "attention_required";
            report.reason = "reader_or_worker_incompatible";
        } else if apply {
            enqueue_dispatcher_wake(&transaction).await?;
            transaction.commit().await?;
            return Ok(report);
        }
    }
    if matches!(report.status, "complete" | "not_needed")
        && !maintenance_integrity(&transaction).await?
    {
        report.status = "attention_required";
        report.reason = "release_integrity_audit_failed";
    }
    transaction.rollback().await?;
    Ok(report)
}

fn plan_digest(
    report: &MaintenanceReport,
    release_id: &str,
    targets: &[serde_json::Value],
) -> String {
    let input = json!({
        "release": release_id,
        "current": report.current,
        "target": report.target,
        "action": report.action,
        "targets": targets,
    });
    canonical::sha256_prefixed(input.to_string().as_bytes())
}

const fn progress_status(progress: &Progress) -> &'static str {
    if progress.failed > 0 {
        "attention_required"
    } else if progress.targets == progress.completed {
        "complete"
    } else {
        "running"
    }
}

async fn maintenance_integrity(transaction: &Transaction<'_>) -> Result<bool, ReleaseError> {
    let audit = inspect_completeness(transaction, false, false).await?;
    let rows = title_audit_rows(transaction).await?;
    // Normal input updates can arrive after this operation's accepted snapshot.
    // Preserve all structural checks; only allow that expected input freshness lag.
    let stranded: bool = transaction
        .query_one(
            "SELECT EXISTS (SELECT 1 FROM series_analysis_title_states s \
         WHERE s.current_artifact_id IS NULL AND NOT s.pending_work \
           AND EXISTS (SELECT 1 FROM matches m WHERE m.game_title_id = s.game_title_id))",
            &[],
        )
        .await?
        .try_get(0)?;
    Ok(!stranded
        && audit.violations.iter().all(|violation| {
            violation.code == "current_version_mismatch"
                && rows.iter().any(|row| {
                    violation.game_title_id.as_deref() == Some(row.game_title_id.as_str())
                        && is_pending_input_update(row)
                })
        }))
}

fn is_pending_input_update(row: &super::TitleAuditRow) -> bool {
    row.pending_work
        && row.current_status.as_deref() == Some("published")
        && row.current_algorithm_version.as_deref() == Some(row.algorithm_version.as_str())
        && row.current_artifact_schema_version == Some(row.artifact_schema_version)
        && row.current_validation_contract_id == row.validation_contract_id
        && row
            .current_input_revision
            .is_some_and(|revision| revision < row.input_revision)
}

async fn target_was_previously_released(
    transaction: &Transaction<'_>,
    target: &ReleaseVersion,
) -> Result<bool, ReleaseError> {
    Ok(transaction.query_one(
        "SELECT EXISTS (SELECT 1 FROM series_analysis_campaigns \
         WHERE trigger IN ('algorithm_update','artifact_schema_update','validation_contract_update','initial_backfill') \
           AND algorithm_version = $1 AND artifact_schema_version = $2 \
           AND validation_contract_id IS NOT DISTINCT FROM $3)",
        &[&target.algorithm_version, &target.artifact_schema_version, &target.validation_contract_id],
    ).await?.try_get(0)?)
}

async fn initial_backfill_trigger(
    transaction: &Transaction<'_>,
    target: &ReleaseVersion,
    operation: MaintenanceOperation,
) -> Result<Option<PromotionTrigger>, ReleaseError> {
    if target_was_previously_released(transaction, target).await? {
        return Ok(None);
    }
    if operation == MaintenanceOperation::Backfill {
        return Ok(Some(PromotionTrigger::InitialBackfill));
    }
    let needed: bool = transaction.query_one(
        "SELECT EXISTS (SELECT 1 FROM series_analysis_title_states s \
         WHERE s.current_artifact_id IS NULL AND s.pending_work = false \
           AND EXISTS (SELECT 1 FROM matches m WHERE m.game_title_id = s.game_title_id) \
           AND NOT EXISTS (SELECT 1 FROM series_analysis_jobs j WHERE j.game_title_id = s.game_title_id))",
        &[],
    ).await?.try_get(0)?;
    Ok(needed.then_some(PromotionTrigger::InitialBackfill))
}

async fn campaign_progress(
    transaction: &Transaction<'_>,
    campaign_id: &str,
) -> Result<Progress, ReleaseError> {
    progress_query(transaction, Some(campaign_id), &ReleaseVersion::target()?).await
}

async fn generation_progress(
    transaction: &Transaction<'_>,
    target: &ReleaseVersion,
) -> Result<Progress, ReleaseError> {
    progress_query(transaction, None, target).await
}

async fn progress_query(
    transaction: &Transaction<'_>,
    campaign_id: Option<&str>,
    target: &ReleaseVersion,
) -> Result<Progress, ReleaseError> {
    // Observe durable target results, not global queue quiescence. New user work
    // must not prevent this release's accepted snapshot from completing.
    let row = transaction.query_one(
        "WITH campaigns AS (SELECT * FROM series_analysis_campaigns c \
           WHERE ($1::text IS NULL OR c.id = $1) \
             AND c.trigger IN ('algorithm_update','artifact_schema_update','validation_contract_update','initial_backfill') \
             AND c.algorithm_version = $2 AND c.artifact_schema_version = $3 \
             AND c.validation_contract_id IS NOT DISTINCT FROM $4), \
         targets AS (SELECT t.status, EXISTS (SELECT 1 FROM series_analysis_title_states s \
             JOIN series_analysis_artifacts a ON a.id = s.current_artifact_id \
             WHERE s.game_title_id = t.game_title_id AND a.status = 'published' \
               AND a.algorithm_version = t.algorithm_version \
               AND a.artifact_schema_version = t.artifact_schema_version \
               AND a.validation_contract_id IS NOT DISTINCT FROM t.validation_contract_id \
               AND a.input_revision >= t.input_revision) AS published \
           FROM series_analysis_campaign_targets t JOIN campaigns c ON c.id = t.campaign_id) \
         SELECT (SELECT COALESCE(SUM(target_count), 0)::bigint FROM campaigns), \
           COUNT(*) FILTER (WHERE status = 'skipped_title_deleted' OR (status = 'succeeded' AND published))::bigint, \
           COUNT(*) FILTER (WHERE status = 'failed' OR (status = 'succeeded' AND NOT published))::bigint \
         FROM targets",
        &[&campaign_id, &target.algorithm_version, &target.artifact_schema_version, &target.validation_contract_id],
    ).await?;
    Ok(Progress {
        targets: row.try_get(0)?,
        completed: row.try_get(1)?,
        failed: row.try_get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_compared_as_a_contract_not_sorted_as_strings() {
        let target = ReleaseVersion {
            algorithm_version: "version-9".to_owned(),
            artifact_schema_version: 3,
            validation_contract_id: Some("contract-1".to_owned()),
        };
        assert_eq!(changed_trigger(&target, &target), None);
        let mut current = target.clone();
        current.algorithm_version = "a-version-that-sorts-after-the-target".to_owned();
        assert_eq!(
            changed_trigger(&current, &target),
            Some(PromotionTrigger::AlgorithmUpdate)
        );
        current.artifact_schema_version += 1;
        assert_eq!(
            changed_trigger(&current, &target),
            Some(PromotionTrigger::ArtifactSchemaUpdate)
        );
        current.validation_contract_id = None;
        assert_eq!(
            changed_trigger(&current, &target),
            Some(PromotionTrigger::ValidationContractUpdate)
        );
    }

    #[test]
    fn manual_promotion_and_automatic_retry_share_an_operation() {
        let release = "a".repeat(40);
        assert_eq!(
            operation_key(&release, MaintenanceOperation::Auto),
            operation_key(&release, MaintenanceOperation::Promote)
        );
        assert_ne!(
            operation_key(&release, MaintenanceOperation::Auto),
            operation_key(&release, MaintenanceOperation::Backfill)
        );
        assert_eq!(
            progress_status(&Progress {
                targets: 2,
                completed: 1,
                failed: 0
            }),
            "running"
        );
        assert_eq!(
            progress_status(&Progress {
                targets: 2,
                completed: 1,
                failed: 1
            }),
            "attention_required"
        );
        assert_eq!(progress_status(&Progress::default()), "complete");
    }

    #[test]
    fn normal_input_lag_does_not_hide_an_incompatible_artifact() {
        let mut row = super::super::tests::valid_title_audit_row();
        row.input_revision += 1;
        row.pending_work = true;
        assert!(is_pending_input_update(&row));
        row.current_validation_contract_id = None;
        assert!(!is_pending_input_update(&row));
        row.current_validation_contract_id = row.validation_contract_id.clone();
        row.pending_work = false;
        assert!(!is_pending_input_update(&row));
    }

    #[tokio::test]
    #[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::too_many_lines,
        reason = "exercise preview, changed plans, apply, and retry against the same disposable PostgreSQL state"
    )]
    async fn real_postgres_reconcile_preserves_preview_and_replays_an_applied_operation()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let mut client = connect(&database_url).await?;
        let release_id = "d".repeat(40);
        let operation = MaintenanceOperation::Auto;
        let target = ReleaseVersion::target()?;
        let setup = client.transaction().await?;
        // This ignored test has the same explicit disposable-database requirement
        // as the existing release smoke. Restore all durable fixture changes below.
        setup.batch_execute(
            "CREATE TEMP TABLE maintenance_titles AS SELECT * FROM series_analysis_title_states; \
             CREATE TEMP TABLE maintenance_readers AS SELECT reader_id, draining FROM series_analysis_reader_capabilities; \
             CREATE TEMP TABLE maintenance_workers AS SELECT worker_id, draining FROM series_analysis_worker_capabilities; \
             INSERT INTO game_titles (id, name, layout_family, display_order) \
               VALUES ('maintenance-title', 'maintenance test', 'momotetsu2', 9998);"
        ).await?;
        setup
            .batch_execute(
                "UPDATE series_analysis_worker_capabilities SET draining = true; \
             UPDATE series_analysis_reader_capabilities SET draining = true; \
             INSERT INTO series_analysis_reader_capabilities \
               (reader_id, artifact_schema_versions, validation_contract_ids) \
               VALUES ('maintenance-reader', '[]', '[]'); \
             INSERT INTO series_analysis_worker_capabilities \
               (worker_id, algorithm_versions, artifact_schema_versions, validation_contract_ids) \
               VALUES ('maintenance-worker', '[]', '[]', '[]');",
            )
            .await?;
        let snapshot = current_version(&setup).await?;
        setup.execute("UPDATE series_analysis_release_state SET algorithm_version = 'maintenance-before' WHERE singleton_key = 'current'", &[]).await?;
        setup.commit().await?;

        let incompatible_tx = begin_promotion_transaction(&mut client).await?;
        let incompatible =
            reconcile_transaction(incompatible_tx, operation, &release_id, false, None).await?;
        assert_eq!(incompatible.reason, "reader_or_worker_incompatible");
        client.execute("UPDATE series_analysis_reader_capabilities SET artifact_schema_versions = $1, validation_contract_ids = $2 WHERE reader_id = 'maintenance-reader'", &[&json!([target.artifact_schema_version]), &json!([target.validation_contract_id])]).await?;
        client.execute("UPDATE series_analysis_worker_capabilities SET algorithm_versions = $1, artifact_schema_versions = $2, validation_contract_ids = $3 WHERE worker_id = 'maintenance-worker'", &[&json!([target.algorithm_version]), &json!([target.artifact_schema_version]), &json!([target.validation_contract_id])]).await?;

        let backfill_tx = begin_promotion_transaction(&mut client).await?;
        let backfill = reconcile_transaction(
            backfill_tx,
            MaintenanceOperation::Backfill,
            &release_id,
            false,
            None,
        )
        .await?;
        assert_eq!(backfill.reason, "promote_before_backfill");
        let plan_tx = begin_promotion_transaction(&mut client).await?;
        let plan = reconcile_transaction(plan_tx, operation, &release_id, false, None).await?;
        assert_eq!(plan.status, "planned");
        assert!(plan.target_count > 0);
        let unchanged: String = client.query_one("SELECT algorithm_version FROM series_analysis_release_state WHERE singleton_key = 'current'", &[]).await?.try_get(0)?;
        assert_eq!(unchanged, "maintenance-before");
        client.execute("UPDATE series_analysis_title_states SET input_revision = input_revision + 1 WHERE game_title_id = 'maintenance-title'", &[]).await?;
        let stale_tx = begin_promotion_transaction(&mut client).await?;
        let stale = reconcile_transaction(
            stale_tx,
            operation,
            &release_id,
            true,
            Some(&plan.plan_digest),
        )
        .await?;
        assert_eq!(stale.reason, "plan_changed_run_check_again");
        let refreshed_tx = begin_promotion_transaction(&mut client).await?;
        let refreshed =
            reconcile_transaction(refreshed_tx, operation, &release_id, false, None).await?;
        assert_eq!(plan.target_count, refreshed.target_count);
        assert_ne!(plan.plan_digest, refreshed.plan_digest);
        let apply_tx = begin_promotion_transaction(&mut client).await?;
        let applied = reconcile_transaction(
            apply_tx,
            operation,
            &release_id,
            true,
            Some(&refreshed.plan_digest),
        )
        .await?;
        assert_eq!(applied.status, "running");
        let replay_tx = begin_promotion_transaction(&mut client).await?;
        let replay = reconcile_transaction(
            replay_tx,
            MaintenanceOperation::Promote,
            &release_id,
            true,
            None,
        )
        .await?;
        assert_eq!(replay.action, "resume");
        assert_eq!(replay.target_count, plan.target_count);
        let key_hash = canonical::sha256_prefixed(operation_key(&release_id, operation).as_bytes());
        let operation_id = stable_id("analysis-release-operation", &key_hash, "all");
        let count: i64 = client.query_one("SELECT COUNT(*)::bigint FROM series_analysis_campaigns WHERE operation_request_id = $1", &[&operation_id]).await?.try_get(0)?;
        assert_eq!(count, 1);
        client.execute("UPDATE series_analysis_campaign_targets SET status = 'failed' WHERE campaign_id IN (SELECT id FROM series_analysis_campaigns WHERE operation_request_id = $1)", &[&operation_id]).await?;
        let failed_tx = begin_promotion_transaction(&mut client).await?;
        let failed = reconcile_transaction(failed_tx, operation, &release_id, false, None).await?;
        assert_eq!(failed.status, "attention_required");
        assert!(failed.failed_count > 0);

        client
            .execute(
                "DELETE FROM series_analysis_operation_requests WHERE id = $1",
                &[&operation_id],
            )
            .await?;
        client.execute("UPDATE series_analysis_release_state SET algorithm_version = $1, artifact_schema_version = $2, validation_contract_id = $3 WHERE singleton_key = 'current'", &[&snapshot.algorithm_version, &snapshot.artifact_schema_version, &snapshot.validation_contract_id]).await?;
        client.batch_execute("DELETE FROM game_titles WHERE id = 'maintenance-title'; \
          UPDATE series_analysis_title_states s SET algorithm_version = m.algorithm_version, \
            artifact_schema_version = m.artifact_schema_version, validation_contract_id = m.validation_contract_id, \
            pending_work = m.pending_work, updated_at = m.updated_at FROM maintenance_titles m WHERE s.game_title_id = m.game_title_id; \
          UPDATE series_analysis_reader_capabilities s SET draining = m.draining FROM maintenance_readers m WHERE s.reader_id = m.reader_id; \
          UPDATE series_analysis_worker_capabilities s SET draining = m.draining FROM maintenance_workers m WHERE s.worker_id = m.worker_id; \
          DELETE FROM series_analysis_reader_capabilities WHERE reader_id = 'maintenance-reader'; DELETE FROM series_analysis_worker_capabilities WHERE worker_id = 'maintenance-worker';").await?;
        Ok(())
    }
}
